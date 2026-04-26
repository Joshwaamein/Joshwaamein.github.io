---
title: "How I Fixed SSL Certificate Warnings Across My Entire Proxmox Homelab — With Full Auto-Renewal and Email Alerts"
description: "A complete guide to issuing a Let's Encrypt wildcard cert via DNS-01, deploying it to all Proxmox VE and PBS nodes, handling the PBS fingerprint gotcha that will break your backups, and wiring up email alerts on every renewal."
date: 2026-04-26 00:00:00 +0100
categories: [Homelab, Security]
tags: [proxmox, linux, ssl, tls, letsencrypt, acme, cloudflare, dns, tailscale, automation, certificates, proxmox-backup-server]
---

If you run a Proxmox homelab, you know the drill. You open your PVE or PBS web UI and Chrome hits you with the red "Your connection is not private" screen. You click Advanced, you click Proceed, and you feel slightly bad about it. Every. Single. Time.

I finally fixed it — for all my servers at once, fully automated, with email alerts on every renewal. Here's the complete guide including the gotcha that broke my backups immediately after, and how I fixed that too.

---

## My Setup

- 3 × Proxmox VE nodes
- 4 × Proxmox Backup Server nodes
- All private, accessible via Tailscale only
- Domain managed by Cloudflare

## Why Standard Let's Encrypt Doesn't Work Here

The usual HTTP-01 challenge requires your server to be reachable on port 80 from the internet. My servers are behind Tailscale — they're not reachable from the internet at all. HTTP-01 is a non-starter.

The answer is the **DNS-01 challenge**. You prove domain ownership by creating a TXT record in your DNS zone instead. Let's Encrypt checks the TXT record, issues the cert, and your server never needs to be publicly accessible. If your DNS is managed by Cloudflare (or most other major providers), this is fully automatable.

## The Wildcard Strategy

Rather than getting individual certificates — separate challenges, separate renewal timers, separate deploy jobs — I issued a single **wildcard certificate** for `*.yourdomain.com`.

One cert. One renewal. One deploy script. Covers every subdomain on the domain.

---

## Step 1: Install acme.sh

[acme.sh](https://github.com/acmesh-official/acme.sh) is a shell script ACME client with native Cloudflare support. Install on your management machine (wherever you SSH from):

```bash
curl https://get.acme.sh | sh -s email=your@email.com
```

This installs to `~/.acme.sh/` and adds a daily cron job automatically.

## Step 2: Create a Cloudflare API Token

In Cloudflare: **My Profile → API Tokens → Create Token → Edit zone DNS**.

Scope it tightly:
- Permissions: `Zone → DNS → Edit`
- Zone Resources: `Include → Specific zone → yourdomain.com`

You also need your Zone ID from the Cloudflare dashboard Overview page.

## Step 3: Issue the Wildcard Cert

```bash
export CF_Token="your-cloudflare-api-token"
export CF_Zone_ID="your-zone-id"

~/.acme.sh/acme.sh --issue \
  --dns dns_cf \
  -d "*.yourdomain.com" \
  --server letsencrypt
```

acme.sh:
1. Creates `_acme-challenge.yourdomain.com` TXT record via Cloudflare API
2. Waits for DNS propagation
3. Asks Let's Encrypt to verify it
4. Gets your cert
5. Deletes the TXT record

Takes about 40 seconds. No ports opened, no firewall changes. The cert lands at:
```
~/.acme.sh/*.yourdomain.com_ecc/
├── *.yourdomain.com.key      # private key
├── *.yourdomain.com.cer      # certificate
├── ca.cer                    # intermediate CA
└── fullchain.cer             # cert + chain (use this)
```

## Step 4: Deploy to All Servers

Proxmox VE and PBS both support dropping a cert into a specific path and restarting the proxy service.

**PVE nodes (port 8006):**
```bash
scp fullchain.cer root@pve1:/etc/pve/local/pveproxy-ssl.pem
scp *.yourdomain.com.key root@pve1:/etc/pve/local/pveproxy-ssl.key
ssh root@pve1 "systemctl restart pveproxy"
```

**PBS nodes (port 8007):**
```bash
scp fullchain.cer root@pbs1:/etc/proxmox-backup/proxy.pem
scp *.yourdomain.com.key root@pbs1:/etc/proxmox-backup/proxy.key
ssh root@pbs1 "systemctl restart proxmox-backup-proxy"
```

> **PVE gotcha:** `/etc/pve/` is a FUSE filesystem called pmxcfs. If you try to `chmod` the cert files you'll get "Operation not permitted". This is normal and harmless — ignore it.

I scripted this to loop over all servers. Total deploy time: ~30 seconds.

## The Gotcha: PBS Fingerprints in storage.cfg

Here's the thing nobody mentions. **After deploying the new certs, my PVE nodes couldn't connect to my PBS servers anymore.**

The reason: every PBS storage definition in PVE's `storage.cfg` contains a `fingerprint` line — the SHA256 fingerprint of the PBS server's certificate. PVE uses this to verify it's talking to the right server:

```
pbs: pbs1
    server pbs1
    fingerprint fa:f0:14:a5:74:79:e8:...  ← old self-signed cert fingerprint
    username backup@pbs!pve1-backup
```

When we replaced the PBS cert with the new Let's Encrypt cert, the fingerprint changed. PVE saw the mismatch and refused the connection.

**Fix:** update the fingerprint on every PBS storage entry on every PVE node.

```bash
# Get the new fingerprint from one PBS server
NEW_FP=$(echo | openssl s_client -connect pbs1:8007 2>/dev/null \
  | openssl x509 -fingerprint -sha256 -noout 2>/dev/null \
  | sed 's/sha256 Fingerprint=//' \
  | tr '[:upper:]' '[:lower:]')

# Update all PBS storages on each PVE node
for storage in $(grep '^pbs:' /etc/pve/storage.cfg | awk '{print $2}'); do
  pvesh set /storage/$storage --fingerprint "$NEW_FP"
done
```

Run this on each PVE node. PBS connections restored immediately.

**This needs to happen every time the cert renews.** So I built it into the auto-renewal script.

## The Second Gotcha: PBS Sync Job Remotes

After fixing the PVE storage fingerprints, I thought I was done. Then my backup PBS node started failing its sync jobs:

```
WARNING: certificate fingerprint does not match expected fingerprint!
expected: fa:f0:14:a5:74:79:e8:...
certificate validation failed - Certificate fingerprint was not confirmed.
```

That node pulls backups from the other PBS nodes using PBS sync jobs. Those sync jobs connect via **remote definitions** — and remote definitions also store the cert fingerprint. These are completely separate from PVE's `storage.cfg`.

Fix: update the remote definitions on the syncing PBS node:

```bash
for remote in pbs1 pbs2 pbs3; do
  proxmox-backup-manager remote update $remote --fingerprint "$NEW_FP"
done
```

So there are actually **two places** fingerprints need updating after a cert change:
1. **PVE `storage.cfg`** — for PVE → PBS backup jobs (via `pvesh set /storage/...`)
2. **PBS remote definitions** — for PBS → PBS sync jobs (via `proxmox-backup-manager remote update`)

Both are now handled by the deploy script.

## Step 5: The Auto-Renewal Script

The script does more than just copy files. Here's what a production-ready version needs to handle:

1. Deploy cert to all PVE nodes → restart pveproxy
2. Deploy cert to all PBS nodes → restart proxmox-backup-proxy
3. Wait for PBS to come back up (poll, don't just sleep)
4. Read the new fingerprint from PBS
5. Update PBS storage fingerprints on all PVE nodes (`pvesh set /storage/...`)
6. Update PBS sync remote fingerprints (`proxmox-backup-manager remote update ...`)
7. Email on start, success, and failure

A few gotchas to avoid:
- Use `$HOME` not `~` — tilde doesn't always expand in non-interactive cron context
- Use `BatchMode=yes` in SSH options — interactive prompts will hang cron indefinitely
- Use a heredoc for the email body, not inline quoting — log content containing apostrophes breaks the command
- Use `set -euo pipefail` — fail fast on unexpected errors
- Validate cert files exist before doing anything

The key structural pattern:

```bash
#!/bin/bash
set -euo pipefail

ACME_DIR="$HOME/.acme.sh"
CERT_DIR="$ACME_DIR/*.yourdomain.com_ecc"
CERT="$CERT_DIR/fullchain.cer"
KEY="$CERT_DIR/$(ls "$CERT_DIR" | grep '\.key$' | grep -v fullchain | head -1)"
LOG_FILE="$ACME_DIR/deploy-proxmox.log"

SSH_OPTS="-o ConnectTimeout=15 -o StrictHostKeyChecking=no -o BatchMode=yes"

# Validate cert files exist
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "ERROR: Cert files not found" | tee -a "$LOG_FILE"; exit 1
fi

# Deploy to all servers...

# Poll PBS until it responds instead of blind sleep
wait_for_port() {
  local host="$1" port="$2" timeout="${3:-30}" elapsed=0
  while ! echo | openssl s_client -connect "$host:$port" 2>/dev/null | grep -q 'BEGIN CERTIFICATE'; do
    sleep 2; elapsed=$((elapsed + 2))
    [ $elapsed -ge $timeout ] && return 1
  done
}

# Read new fingerprint and update both locations
NEW_FP=$(echo | openssl s_client -connect pbs1:8007 2>/dev/null \
  | openssl x509 -fingerprint -sha256 -noout 2>/dev/null \
  | sed 's/sha256 Fingerprint=//' | tr '[:upper:]' '[:lower:]')

# 1. PVE storage.cfg fingerprints
for host in $PVE_NODES; do
  ssh $SSH_OPTS root@$host "
    for s in \$(grep '^pbs:' /etc/pve/storage.cfg | awk '{print \$2}'); do
      pvesh set /storage/\$s --fingerprint '$NEW_FP' 2>/dev/null
    done"
done

# 2. PBS sync remote fingerprints
ssh $SSH_OPTS root@$PBS_SYNC_NODE "
  for remote in pbs1 pbs2 pbs3; do
    proxmox-backup-manager remote update \$remote --fingerprint '$NEW_FP' 2>/dev/null
  done"
```

Register it with acme.sh:

```bash
~/.acme.sh/acme.sh --install-cert -d "*.yourdomain.com" \
  --reloadcmd "~/.acme.sh/deploy-proxmox.sh"
```

Now every time acme.sh renews the cert (automatically, ~60 days in), this script runs and handles the entire chain.

## Step 6: Email Notifications

I wanted to know when this ran — success or failure. My management machine doesn't have sendmail configured, but my PVE nodes do (via msmtp + Brevo). I added a `send_email()` function to the deploy script that SSH's into pve1 to relay the email:

```bash
send_email() {
  local subject="$1"
  local body="$2"
  ssh root@pve1 \
    "printf 'Subject: %s\nFrom: proxmox-alerts@yourdomain.com\nTo: you@email.com\n\n%s\n' \
    '$subject' '$body' | /usr/sbin/sendmail -f proxmox-alerts@yourdomain.com you@email.com"
}

# At start:
send_email "🔄 [proxmox] Cert renewal started" "Deploy started at $(date)"

# At end (success):
send_email "✅ [proxmox] Cert renewal succeeded" "$LOG\nNew fingerprint: $NEW_FP"

# On failure:
send_email "❌ [proxmox] Cert renewal FAILED" "$LOG"
```

> If you haven't set up SMTP on your PVE nodes yet, I covered that in [Why I Switched From Gmail to Brevo for All My Homelab Email Alerts](/posts/why-i-switched-from-gmail-to-brevo-for-homelab-email-alerts/).

## Step 7: DNS Records

The wildcard cert covers `*.yourdomain.com`, but for your browser to reach `pve2.yourdomain.com` it needs a DNS A record.

Create records in Cloudflare pointing to your Tailscale IPs, with proxying **disabled**:

```
pve1.yourdomain.com  A  100.x.x.x  (proxied: off, TTL: 3600)
pve2.yourdomain.com  A  100.x.x.x
pbs1.yourdomain.com  A  100.x.x.x
...
```

Tailscale IPs are only routable within your Tailnet. The records are technically public, but anyone outside your network who looks them up gets an IP they can't reach. It's security through inaccessibility.

If you'd rather have zero public DNS footprint, add entries to your local `/etc/hosts` instead:
```
100.x.x.x  pve2.yourdomain.com
```

---

## The Full Automated Flow

Every ~60 days, without any manual intervention:

1. **acme.sh cron fires** (daily at a random time, checks if renewal needed)
2. **DNS-01 challenge** runs — temporary TXT record created and deleted via Cloudflare API
3. **New cert issued** by Let's Encrypt
4. **deploy-proxmox.sh runs:**
   - 🔄 Start email sent
   - New cert deployed to all servers via SCP
   - All proxies restarted
   - New fingerprint read from PBS
   - All PBS storage fingerprints updated on PVE nodes
   - PBS sync remote fingerprints updated
   - ✅ Success email sent with full log + fingerprint + expiry date
   - ❌ Failure email sent if anything went wrong

Zero manual steps required. You get notified either way.

---

## Summary

| What | How |
|------|-----|
| Cert type | Let's Encrypt wildcard `*.yourdomain.com` |
| ACME challenge | DNS-01 via Cloudflare API |
| Client | acme.sh |
| Deployment | scp + systemctl restart |
| Fingerprint update | pvesh set /storage on all PVE nodes |
| Email alerts | msmtp relay via PVE node |
| Auto-renewal | acme.sh cron + custom deploy hook |
| Time to set up | ~15 minutes |
| Ongoing maintenance | None |

The PBS fingerprint step is the non-obvious part that will break your backups if you miss it. Build it into your deploy script from the start and you'll never have to think about it again.
