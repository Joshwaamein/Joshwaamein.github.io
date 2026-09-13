---
title: "My Steering Rules Hid a Bug for Three Months, Then Found It in an Hour"
description: "A wrong sentence in my always-on Cline rules ('there is no LVM event autoactivation on this host') loaded into every session for three months and quietly capped how deep any diagnosis could go. The same harness then cornered the real cause in about an hour: two vgchange -aay calls racing inside the initramfs, a fix that took the initramfs from 182 seconds to 1.7, an adversarial reviewer that falsified two of my own conclusions, and a correction cascaded back through three tiers of documentation so the wrong sentence cannot mislead the next session."
date: 2026-09-12 16:00:00 +0100
categories: [AI, Homelab]
tags: [cline, claude, llm, agents, adversarial-review, proxmox, lvm, linux, troubleshooting, automation]
---

A hypervisor of mine printed this on every boot, and had done for months:

```
Activation of logical volume <vg>/<pool> is prohibited while
logical volume <vg>/<pool>_tmeta is active.
```

I wrote [a post about that error in April 2024](/posts/proxmox-activating-lv-failed-activation-of-logical-volume-is-prohibited-while-lo/)
and published a fix I had taken from a forum thread. Two years later the error was
still there, on a host where that fix had never been applied and would not have
worked anyway.

The interesting part is not the bug. It is that my own steering harness is why the
bug survived three months, and also why it took about an hour to corner once I
actually looked. Both directions are worth writing down, because the failure mode
is one I had not seen described anywhere: **a rule file is a cache, and a wrong
entry in it is not neutral. It actively caps how deep any future diagnosis can
go.**

## The Harness, Briefly

Three tiers, described in more detail in
[how I steer Cline with a tiered rules system](/posts/how-i-steer-cline-with-a-tiered-rules-system/):

| Tier | Loads | Holds |
|---|---|---|
| `rules/` | every session, always | pointers, policy, decide-before-acting |
| `skills/` | on demand, when a description matches | procedures and API traps |
| `reference/` | on demand, when a task touches it | live state, per-host docs, dated narrative |

Plus a `PreToolUse` hook, agent personas for delegation, and a standing habit of
having non-trivial work attacked by an adversarial reviewer before I believe it.

The tiering exists because context is scarce. What I had not thought about is that
the always-on tier is also the most dangerous place to be wrong, precisely because
it is guaranteed to be in context for every session that follows.

## How the Harness Hid It

In June I hit this error and worked around it: a boot unit that deactivates the
thin pool's metadata volume before activating the volume group. It worked. I then
wrote the finding into my per-host reference doc, and one sentence of what I wrote
was false:

> There is no LVM event/static autoactivation on this host, so the unit is
> load-bearing, do not remove it.

The second half is true. The first half is wrong: `global/event_activation` is
`1`, and the udev rule that acts on it is present in the initramfs. I had checked
for a systemd generator and for `lvm2-activation.service`, found neither, and
generalised from that to "no event activation", which is a different claim than
the one my evidence supported.

That sentence then did exactly what the harness is designed to do: it loaded as
context, every session, for three months. Two consequences, and the second is the
one I did not expect.

**It gave a confident answer to the question I should have investigated.** Any
session asking "what activates these volume groups at boot?" got an answer from
the rules tier and stopped. Retrieval beat investigation, which is normally the
entire point of writing the rule.

**It made the symptom look explained.** I had a documented cause, a working
workaround, and a note in the tracker. Nothing about that state generates the
feeling that something is still wrong, so a pool failing to activate on every
single boot read as a known quirk rather than an open bug. Two VMs intermittently
came up stopped after reboots, and I had already filed that under the same quirk.

A stale rule announces itself eventually, because reality drifts and something
breaks. **A rule that was wrong when written never announces itself at all.** It
is indistinguishable from knowledge.

## How the Harness Found It

The same structure, used on purpose rather than by reflex. Five parts of it did
real work.

### 1. The rule that says to read the source

My global rules include "prefer reading the actual source or docs over guessing
API shapes". Applied to an error message, that becomes: find out which binary
prints it. Thirty seconds:

```bash
strings /usr/bin/udevadm | grep -i 'udev queue'
#   Timed out while waiting for udev queue to empty.

strings /usr/sbin/lvm | grep 'using metadata type'
#   Found %svolume group "%s" using metadata type %s
```

The timeout string exists only in `udevadm`. So the console sequence was
`udevadm settle`, then `lvm vgscan`, then a `vgchange`. Exactly one script in the
initramfs does those three things in that order, and it ships with
`zfs-initramfs` on a host with no ZFS pools at all:

```sh
# /usr/share/initramfs-tools/scripts/local-top/zfs
udev_settle()  { /sbin/udevadm settle --timeout=30 ; }
activate_vg()  { /sbin/lvm vgscan
                 /sbin/lvm vgchange -aay --sysinit ; }
udev_settle
activate_vg
```

In 2024 I searched the error text on forums instead, which finds other people's
causes, not mine.

### 2. Counting, because the rules demand specifics

"Use real details and specifics" is a writing rule in my config, but it changes
diagnosis too. `vgchange -aay` honours a per-volume `autoactivation` property, so
I counted the volumes that had it set and compared against what the console
printed:

| Volume group | LVs with `autoactivation=enabled` | Console said |
|---|---|---|
| nvme-pool | 6 | 6 |
| usb-ssd-pool | 3 | 3 |
| root-vg | 3 | 3 |
| sata-ssd-pool | 2 | 2 |
| **hdd-pool** | **3** | **0** |

Five for five, and the failing pool is the only mismatch. That single table proved
the messages came from an `-aay` call and that the pool had three activatable
volumes which never activated. It also killed the "LVM is just slow" theory,
because `vgscan` measures 0.064 seconds and the per-device scan 0.023.

### 3. Reading the udev rule, which contradicted my own notes

`69-lvm.rules` is present inside the initramfs, and its two branches are the whole
bug:

```
TEST!="/run/systemd/system", GOTO="lvm_direct_vgchange"

ENV{LVM_VG_NAME_COMPLETE}=="?*", RUN+="/usr/bin/systemd-run --no-block ... vgchange -aay ..."
GOTO="lvm_end"

LABEL="lvm_direct_vgchange"
ENV{LVM_VG_NAME_COMPLETE}=="?*", RUN+="/usr/sbin/lvm vgchange -aay --autoactivation event $env{LVM_VG_NAME_COMPLETE}"
```

With systemd present, activation is dispatched asynchronously, and the comment in
the file says why: it "can take longer to run than udev wants to block when
processing rules". There is no `/run/systemd/system` in the initramfs, so it takes
the second branch and runs **synchronously inside a udev worker**.

So two things activate volume groups simultaneously during early boot: this rule,
once per physical volume, and the ZFS script, across every volume group at once.
They race for the thin pool's metadata volume. One wins, the other is refused.
That is the error, and it is also why `udevadm settle` can never finish: each
activation creates device-mapper nodes that raise fresh uevents that match the
rules again, across 42 devices.

This is the moment the false sentence in my reference doc died. It said no event
activation existed; the rule had been sitting in the initramfs the whole time.

### 4. A fix chosen against a constraint the harness already knew

Two fixes were available: remove `zfs-initramfs`, or disable autoactivation on the
four data volume groups. My rules carry a note that this host currently has no
convenient console access, and my global rules say to prefer the reversible option
and to stop before anything that could need a physical visit.

That decided it. Removing the package needs an `update-initramfs`, and a bad
initramfs on a host you cannot easily reach is the worst class of self-inflicted
outage. The flag does not:

```bash
for v in <nvme-pool> <hdd-pool> <sata-ssd-pool> <usb-ssd-pool>; do
    vgchange --setautoactivation n "$v"
done
```

It lives in the on-disk LVM metadata on the physical volume, so a kernel upgrade
cannot revert it and no initramfs is rebuilt. It also turns out to be what the
platform already does per-volume for anything it creates, so this only finished the
job for older volumes. Never on the root volume group, which holds root and swap;
my script has a guard that re-enables it and exits non-zero if it ever finds it
disabled.

Measured across a reboot, same kernel and command line both sides:

| Metric | Before | After |
|---|---|---|
| Initramfs duration | 182.09s | **1.71s** |
| First `device-mapper: thin` message | 25.07s | 210.65s |
| `Unable to deactivate ..._tmeta` | 1 | **0** |
| Boot to `graphical.target` | 7min 21s | **4min 35s** |
| VMs and containers running | 13 + 2 | 13 + 2 |

The `device-mapper: thin` row is the diagnosis, not just the improvement. A thin
pool used to be activated at 25 seconds, inside the initramfs, before systemd
existed. Now the first one happens at 210 seconds, inside the boot unit. Nothing
is left to race with.

### 5. Adversarial review, which falsified two of my conclusions

I write up non-trivial work and then have it attacked, because
[polish reads as correctness](/posts/when-the-output-looks-right/) and I cannot fix
that with resolve. Five objections came back. Two were right.

**"You quoted a rootkit scanner's runtime next to a boot comparison."** True, and
sloppy. The objection then computed a corrected saving of about 18 seconds, which
is wrong for a reason worth knowing:

```
[  441.368563] Reached target multi-user.target        <- boot ends here
[ 3655.069238] Starting <scanner>.service...           <- 3214 seconds later
```

**`systemd-analyze blame` lists every unit that ran during the boot's uptime, not
the units on the startup path.** A timer-triggered unit firing 53 minutes later
still appears there. `critical-chain` is the tool for what actually gated the boot.
So my headline number survived, but I had invited the misreading.

**"You called a 221-second volume activation 'expected' and moved on."** Guilty.
Splitting it per volume group found something I had reported as one homogeneous
number:

| Volume group | LVs | Activation | Device |
|---|---|---|---|
| nvme-pool | 15 | **3.5s** | NVMe |
| sata-ssd-pool | 4 | 1.7s | SATA SSD |
| usb-ssd-pool | 3 | 22s | USB SSD |
| **hdd-pool** | **3** | **194s** | **7200rpm SATA** |

Five times the volumes on NVMe in one fiftieth of the time.

Two objections were confidently wrong, which is the part people leave out of posts
about adversarial review. The strongest-sounding one claimed the 194 seconds was
thin-pool exhaustion, since that pool is 93.6% full and metadata fragmentation
spikes past 90%. It is not:

- The pool's **metadata** is 15.41% used. Data fullness does not index metadata
  fullness, and metadata is what gets traversed at activation.
- `thin_check` did not run at all. No occurrences, no needs-check flag.
- The NVMe pool has an **identically sized metadata volume** at 1.95% and
  activates five times as many volumes in 3.5 seconds.

A direct read of the two metadata devices explains it without any pathology:
118 MB/s on the spinning disk against 530 MB/s on the NVMe, with 2.5 GiB of live
metadata against 317 MiB. Acting on the plausible diagnosis would have sent me
after the wrong subsystem, so the reviewer needs fact-checking with the same energy
as the work.

The other partly-wrong objection still produced the best change in the exercise.
It argued my `ExecStartPre` deactivate step was a dirty hack. The reasoning was
inverted, but the conclusion was right, because the fix had made that step
pointless:

```
before:  29 iterations of "remove ioctl failed: Device or resource busy"
after:   one "0 logical volume(s) ... now active", 96 milliseconds
```

It existed solely to undo a race that no longer happens, so it came out. I would
not have removed it on my own, because I had it filed as working.

## Closing the Loop, Which Is the Actual Deliverable

Fixing the host was the easy half. The bug that cost three months was a sentence in
a file, so the fix has to land in the files or it will happen again.

My rules require a doc-bearing change to cascade through **all three tiers**, then a
grep of the whole tree for the old fact to prove no stale copy survives in a layer I
did not think to open. For this one:

1. **Always-on pointers.** The mechanism, the fix, and the never-on-the-root-VG
   warning, so a future session gets the correct model for free.
2. **Per-host reference doc.** Replaced the false sentence, and said explicitly that
   it *was* false and what the evidence actually shows.
3. **The dated project narrative.** The full evidence chain, including the two
   objections that were wrong and why.
4. **The Ansible role**, so a rebuilt host gets the flag automatically, with an
   assertion that refuses to disable the root volume group.
5. **A tracker ticket** for the 194-second activation, stating in the title that it
   is *not* the pool fullness, because the next person to look will otherwise reach
   for the obvious explanation. That includes me in six months.

Point 2 is the one I would emphasise. The instinct is to quietly replace a wrong
line. But the correction is more useful than the corrected fact, because the same
generalisation-from-absent-evidence will happen again, and a future session reading
"this used to say X, here is why that was wrong" learns something the fixed sentence
alone cannot teach.

## What I Changed About the Harness

**Wrong beats stale, so the always-on tier needs a higher bar.** I have been
policing that tier for *size*, because it had grown to 195% of my own budget. I had
not been policing it for *confidence*. A hedge costs three words: "no
systemd-generator autoactivation found (initramfs not checked)" would have preserved
the open question instead of closing it.

**Absence of evidence needs different language from evidence of absence.** My note
said "there is no X". What I had established was "I looked in two places and did not
find X". The rules tier now gets the second phrasing when that is what happened.

**Say which tool answers which question.** `blame` and `critical-chain` look
interchangeable and are not. That went into the reference docs, because it is exactly
the kind of trap that produces a confident wrong answer months later.

**And one process rule got teeth.** Preparing this post, I verified it with a
container build instead of serving the site, and offered it for review with nothing
to look at. My blog rules already said to always preview on the local Docker stack; I
had substituted a weaker check that proves a file compiles but gives a reviewer no
page. That rule now says plainly that a build is not a substitute for a serve, along
with the three traps I hit doing it properly: a `date:` ahead of the container's UTC
clock silently drops the post, leftover theme-specific Liquid renders as literal
text, and the port opens several seconds before the first build finishes.

None of these are AI-specific problems. They are documentation problems that an AI
harness makes sharper, because the wrong sentence is no longer merely wrong in a file
you might reread. It is loaded, every session, into the thing you are asking the
question of.

The 2024 post stays up, with a correction linking here. It describes a real fix for a
real variant of this problem, and quietly deleting a two-year-old mistake would be
worse than leaving it visible with the correction attached.
