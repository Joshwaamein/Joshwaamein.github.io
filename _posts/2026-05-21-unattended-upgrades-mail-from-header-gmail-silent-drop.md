---
title: "Unattended-Upgrades Was Sending Mail to Gmail for Six Weeks. Gmail Was Silently Dropping All of It."
description: "How a one-line apt config default left every host on my fleet sending email with From: root, why Brevo accepted those messages but Gmail dropped them on DMARC alignment, and the live A/B test that nailed it down to a single missing directive."
date: 2026-05-21 22:00:00 +0100
categories: [Homelab, DevOps]
tags: [unattended-upgrades, ubuntu, debian, msmtp, brevo, smtp, dmarc, dkim, ansible, linux]
---

Six weeks ago I rolled out `unattended-upgrades` across every Linux host in my homelab. 34 servers, one Ansible playbook, msmtp pointed at Brevo as the relay. The deploy went green. Every host's `/var/log/msmtp.log` showed `smtpstatus=250 ... exitcode=EX_OK` for every send. Job done.

To be clear up front: the actual *patching* worked perfectly the whole time. Zabbix was scraping `apt` package counts and the systemd timers on every host, so I could see the daily 05:00 / 06:00 runs firing, packages getting upgraded, and reboots happening on schedule. That part was never in doubt. The bit that quietly didn't work was the **mail report on change**, which was supposed to land in my Gmail every time a host actually upgraded something so I'd see what changed. "Confirm those reports actually arrive" sat as a backlog item for six weeks, because the rest of the chain was so visibly healthy that it was easy to keep deferring.

When I finally got around to it today, I went looking for one of those reports in Gmail. There were none. Not in Inbox. Not in Spam. Not in All Mail. Not one, ever, since the day of the deploy.

This is the story of how a single missing line of config managed to look perfectly healthy at every layer except the one that actually mattered.

## The Setup

For context: the SMTP backbone here is the same one I wrote about in [Why I Switched From Gmail to Brevo for All My Homelab Email Alerts](/posts/why-i-switched-from-gmail-to-brevo-for-homelab-email-alerts/). Every host has `msmtp-mta` installed with a 600-permission `/etc/msmtprc` pointing at `smtp-relay.brevo.com:587`. UU's `Mail` directive sends to a Gmail address. The path is:

```
unattended-upgrades  -->  /usr/sbin/sendmail (msmtp symlink)  -->  Brevo SMTP  -->  Gmail
```

The audit started as "are these even working?" and ended somewhere different. The first pass was easy: SSH to every host, send a tagged test email through that host's own msmtp, confirm `smtpstatus=250` post-send, write a per-group results file. 32 of 34 reachable hosts passed. One host was missing the `msmtp-mta` package entirely (a separate problem, fix queued). One was offline (a laptop PBS, expected).

The 32-pass result was correct as far as it went. **Brevo was happily accepting every single message.**

What I didn't think to test was the actual delivery. None of those test mails were ever opened by a human. They were just signals that Brevo's SMTP server was returning 250.

Good question to ask: are these even arriving?

## DNS First, Because That's the Easy Box to Tick

If Brevo is queuing messages but Gmail isn't delivering them, the first place to look is whether the sending domain is even in good standing.

```bash
dig +short TXT yourdomain.example
dig +short TXT _dmarc.yourdomain.example
dig +short TXT selector1._domainkey.yourdomain.example
```

What I found:

| Record | Value |
|---|---|
| SPF | none |
| DMARC | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |
| DKIM (`selector1._domainkey`) | present |
| MX | none |

So:

- **No SPF.** Means SPF alignment can't help us. Whatever Gmail makes of authenticity has to come from DKIM.
- **DMARC is `p=none`.** Gmail won't bounce a misaligned message; it'll either send it to spam or drop it on the floor and tell `rua@dmarc.brevo.com` about it. No NDR comes back to me.
- **DKIM is set up correctly** by Brevo. They sign with their own keys for `d=yourdomain.example` because I delegated the selector to them when I switched.

That mostly absolves DNS. Brevo's DKIM signing was working. So why doesn't Gmail like the messages?

## The A/B That Settled It

I sent two emails from the same host, through the same msmtp config, to the same Gmail address, about a second apart. The only difference was the message-level `From:` header.

```bash
# Test 1: From: root
{
  echo "From: root"
  echo "To: you@gmail.example"
  echo "Subject: [TEST] From: root"
  echo ""
  echo "This is what unattended-upgrades sends by default."
} | /usr/sbin/sendmail -t -oi

# Test 2: From: a real address on the sending domain
{
  echo "From: unattended-upgrades@yourdomain.example"
  echo "To: you@gmail.example"
  echo "Subject: [TEST] From: real-address"
  echo ""
  echo "This is what UU sends with Sender configured."
} | /usr/sbin/sendmail -t -oi
```

Both came back from msmtp with `smtpstatus=250 ... exitcode=EX_OK`. Brevo accepted both.

Only the second one arrived in Gmail.

The first one, with `From: root`, just disappeared.

## So Where Was the `From: root` Coming From?

I had to actually open `/usr/bin/unattended-upgrade` (a Python script despite the name) and grep around. The relevant code is on or near line 1506 of unattended-upgrades 2.9.x:

```python
from_email = apt_pkg.config.find("Unattended-Upgrade::Sender", "root")
```

Read it once and the bug is right there. UU calls `apt_pkg.config.find` with the directive name and a default. The default is the string `"root"`. Literal `root`. No `@`, no domain.

When `Unattended-Upgrade::Sender` is unconfigured, UU writes `From: root` into the message body before piping the whole thing into `/usr/sbin/sendmail`. msmtp picks it up, hands it to Brevo. Brevo doesn't care about the message-level `From:`; it cares about the SMTP envelope `MAIL FROM:` (`unattended-upgrades@yourdomain.example`, from msmtprc), DKIM-signs the message for `d=yourdomain.example`, and queues it.

Gmail then receives a message that says, in the header:

```
From: root
```

And starts asking awkward questions:

1. RFC-5322 says the `From:` header must contain at least one mailbox address with a domain. Bare `root` is not a valid mailbox. That alone is a strong negative signal.
2. DMARC alignment compares the **header `From:` domain** against the DKIM-signed `d=` domain. Header domain is empty (or whatever Gmail decides to do with `root`). DKIM `d=` is `yourdomain.example`. Alignment fails.
3. With DMARC `p=none`, Gmail's policy is "don't bounce, just decide". Gmail decided. The message is gone.

This is also why the dropped messages don't appear in Spam. Spam-foldering is a deliberate "this is suspicious but we'll show it to you anyway" decision. A malformed `From:` that fails DMARC under `p=none` can be dropped before it ever gets to a folder.

## Why Did the 2026-04-07 Deploy Validation Miss This?

The validation criteria for the deploy were:

- `apt-daily-upgrade.timer` enabled and active
- `/etc/msmtprc` correct, mode 600
- `/etc/apt/apt.conf.d/50unattended-upgrades` present with `Mail` and `MailReport`
- A test send from each host returns msmtp exit 0 with Brevo `smtpstatus=250`

Every one of those was true on every host. Zabbix on top of that was telling me that the patches were actually landing. So at every monitoring layer, the deploy looked fine.

The thing nobody validated was the very last hop: "open the destination inbox and confirm the on-change report is actually there." That step sat as a backlog item because the surrounding signal was so good. Hosts were patching themselves, Zabbix was happy, msmtp was returning 250. Why bother eyeballing Gmail?

UU's `MailReport "on-change"` semantics make this worse, not better. On a quiet day with no upgrades, an empty inbox is the *correct* state. So the inbox looks identical whether the pipeline is healthy or completely broken. You only notice the gap on a day where you *expect* a report (because something upgraded) and one doesn't show up. And if you're not checking, you don't notice.

The lesson is the same one in the blog post on the Proxmox SSL renewal flow: every automated email path needs a "did it actually arrive" check, not just a "did the sender return 0" check. I now have a small audit script that sends a tagged test email from each host with a unique X-Audit-Id, then I grep the destination inbox for the IDs. That's the test the 2026-04-07 deploy didn't have.

## The Fix

One line. Add `Unattended-Upgrade::Sender` to your `50unattended-upgrades` config:

```
Unattended-Upgrade::Sender "unattended-upgrades@yourdomain.example";
```

That value should match whatever address your relay actually DKIM-signs. In my case, that's `unattended-upgrades@yourdomain.example` because Brevo signs everything from `d=yourdomain.example`. With it set, UU writes:

```
From: unattended-upgrades@yourdomain.example
```

Brevo signs for `d=yourdomain.example`. Gmail compares the header `From:` domain (`yourdomain.example`) against DKIM `d=` (`yourdomain.example`). Aligned. Accepted. Delivered.

In the Ansible playbook that drives my fleet, the change is two lines per role block (one for VM hosts, one for Proxmox hypervisors):

```diff
           Unattended-Upgrade::MailReport "{{ unattended_upgrades_mail_report }}";
+          // Sender added: UU defaults the From: header to the literal "root" if
+          // this is unset, which Gmail drops because DMARC alignment fails.
+          Unattended-Upgrade::Sender "{{ unattended_upgrades_smtp_from }}";
           Unattended-Upgrade::SyslogEnable "true";
```

I templated it off the existing `unattended_upgrades_smtp_from` variable that's already in `group_vars/all/vars.yml`, since that's the same value msmtp uses for the SMTP envelope `MAIL FROM:`. One source of truth, no drift between header and envelope.

## Rolling It Out

The playbook handles VM hosts and Proxmox hypervisors with two `when:` blocks (one for each, because the schedule offsets differ). I ran it with `--tags config` to only touch the apt config, no package re-installs:

```bash
ansible-playbook configure-unattended-upgrades.yml --tags config
```

Three hosts failed on the first run with:

```
Failed to get information on remote file (/etc/apt/apt.conf.d/50unattended-upgrades):
  /bin/sh: 1: sudo: not found
```

Those were the three Proxmox Backup Server VMs. The PBS appliance image runs as `root` and doesn't ship `sudo`. Easy fix: re-run scoped to your `[pbs]` inventory group with `become` disabled.

```bash
ansible-playbook configure-unattended-upgrades.yml --tags config \
  --limit pbs \
  -e ansible_become=false
```

Worth fixing in inventory long-term so the override isn't needed each time, but for a one-shot patch the `-e` works.

After both runs, the live config on a representative sample showed the new directive everywhere:

```bash
$ ssh root@host grep '^Unattended-Upgrade::' /etc/apt/apt.conf.d/50unattended-upgrades
Unattended-Upgrade::Origins-Pattern { ... };
Unattended-Upgrade::Mail "you@gmail.example";
Unattended-Upgrade::MailReport "on-change";
Unattended-Upgrade::Sender "unattended-upgrades@yourdomain.example";
Unattended-Upgrade::SyslogEnable "true";
```

A re-run after the patch is the cleanest way to confirm idempotency. All hosts came back `changed=0`, so the templated value renders to the same bytes as the previous version (which I'd briefly hardcoded during the diagnosis).

## Validation, Properly This Time

The first time around, "did the deploy work" stopped at "msmtp exit 0". That was wrong. Here's what the new validation actually checks, end to end:

1. **Config file shows the new directive.** On a sample host:

   ```bash
   grep '^Unattended-Upgrade::Sender' /etc/apt/apt.conf.d/50unattended-upgrades
   ```

   Expect the configured address back. Empty result means the playbook didn't touch this host.

2. **A real UU run produces a real email.** UU only sends mail when packages were actually upgraded (because `MailReport "on-change"`). To force a send for testing, either wait for the next quiet upgrade day, or trigger it manually with a tagged message that goes through the same `/usr/sbin/sendmail` symlink:

   ```bash
   {
     echo "From: unattended-upgrades@yourdomain.example"
     echo "To: you@gmail.example"
     echo "Subject: [post-deploy verify] $(hostname) $(date -Is)"
     echo ""
     echo "This is the same SMTP path UU uses."
   } | /usr/sbin/sendmail -t -oi
   ```

   Then open Gmail. Not "check the msmtp log". *Open Gmail*.

3. **Confirm the headers.** When the next real on-change report arrives in your inbox, expand the headers and look for:

   - `From: unattended-upgrades@yourdomain.example` (not `From: root`)
   - `Authentication-Results:` showing `dkim=pass header.i=@yourdomain.example`
   - `Authentication-Results:` showing `dmarc=pass`

   If any of those are off, you've got a different problem than the one in this post. (The most likely candidate is that your relay isn't DKIM-signing for the domain in your `From:` header. Check the relay's domain authentication panel.)

## A Sub-Issue: `recipients=root` 501 Errors

Wholly separate but worth a side note for anyone running the same audit. Several hosts on my fleet had repeating entries in `/var/log/msmtp.log` like:

```
recipients=root smtpstatus=501 errormsg='recipient address root not accepted by the server'
```

These are *not* from UU. UU explicitly addresses your configured `Mail` recipient. The `recipients=root` ones come from something else on the host (commonly cron's default `MAILTO=root`, smartd, or apt-listchanges) handing mail to msmtp with envelope `RCPT TO: root`. Brevo rejects bare-username recipients at SMTP time with 501.

Two ways to fix it cleanly:

1. Set `aliases /etc/aliases` in `/etc/msmtprc` and add a `root: someone@somewhere.example` line to `/etc/aliases`. msmtp will rewrite the recipient before handing it to Brevo.
2. Track down whatever is hardcoding `root` as a destination and point it at a real address.

On one host the noise was so heavy (every 30 minutes) that the msmtp log had grown to 651 KB of error-only entries since the deploy. I'd missed it the first time around because nothing further downstream was complaining. Worth a fleet-wide grep for `smtpstatus=5` if you're already in the area.

## Takeaway

The whole bug is one default in one Python file:

```python
from_email = apt_pkg.config.find("Unattended-Upgrade::Sender", "root")
```

A bare `root` as a default is a sensible thing for a tool that ran for the first time on a UNIX box where local delivery actually meant something. In 2026, with everything going out through a relay that DKIM-signs for a domain you own, that default is a foot-gun. Set `Unattended-Upgrade::Sender` to something with a `@` and a domain that aligns with whatever your relay is signing, and the whole pipeline lights up.

If you're running unattended-upgrades through msmtp / Postfix / nullmailer / any external relay, go look at your `50unattended-upgrades` right now and make sure `Sender` is set. If it isn't, your alerts are probably already vanishing into the void.

The next post in this thread will be the audit script itself, with the per-host audit-id register that lets you grep your inbox for "did this specific host's specific test mail actually arrive". Sending a 250 OK is not the same as delivering a message, and after this one I'll never trust an SMTP relay's accept response as proof of delivery again.
