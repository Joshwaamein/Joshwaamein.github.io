---
title: "Driving a Server Back to Life Through a Console Harness: fsck, Cross-Linked Inodes, and a Kernel That Never Booted"
description: "A failing SATA cable corrupted the root filesystem of a hypervisor, and the repair was driven from an out-of-band console: screenshot the screen, send keystrokes, read the result. What that harness looks like, why fsck left binaries containing the text of unrelated files, why the package manager reported a clean system while fourteen libraries were broken, and the five diagnostic tools that lied along the way."
date: 2026-09-12 12:30:00 +0100
categories: [Homelab, DevOps]
tags: [linux, automation, python, bash, opsec, recovery]
---

The console harness is what did the work. A hypervisor on my network had
dropped its root filesystem to read-only, taken its guests with it, and would
not answer SSH. The boot was stopping long before the network came up, so there
was nothing to log into.

What I had was an out-of-band console, which shows the screen and accepts
keystrokes regardless of what the host thinks is happening. The gap was
automation: every keypress meant a click in a UI. So the recovery was really two
jobs: build a thin scripted harness over the console, then use it to drive a
filesystem repair from a BusyBox prompt.

This is the write-up of both: what the harness bought me, and the four separate
diagnostic tools that gave me confidently wrong answers once I could see
clearly enough to catch them.

## The Harness

A remote console is normally something you sit in front of. It shows you a
screen, you type, you read, you type again. That is fine for changing a BIOS
setting and miserable for a filesystem repair, because a repair is dozens of
commands where each one's output decides the next, and every single keystroke
is arriving through a browser.

But strip the console back and it only really offers two things: read the
screen, press a key. Both are automatable:

```
console shot        # capture the screen to a PNG
console send "..."  # type a string, press Enter
keys ctrl-d         # send a named non-printing key
```

That is the whole harness. No cleverness in it at all. What matters is that
each one is a single non-interactive command, which turns the console from
something you operate into something you can drive from a script:

```
console send "e2fsck -fy /dev/mapper/vg-root"
console shot && read-the-result
console send "the next thing, based on what you just read"
```

### What that actually bought me

**The output became greppable.** Console output is pixels, not text. Reading
"how many inodes did it fix" off a screenshot by eye is slow and error-prone,
especially at the point in the night where you are most likely to misread a
digit. Capturing to a file meant I could compare two screenshots and see that
the second `fsck` pass reported identical file and block counts to the first,
which is the actual evidence that a repair converged. I would not have trusted
myself to spot that by looking.

**Long operations stopped needing babysitting.** An `fsck` on a large volume, a
package reinstall, a set of guests starting in sequence: each is minutes of
waiting. Scripted, I could fire one, poll for the prompt to come back, and get
on with writing the next diagnostic instead of watching a progress indicator in
a browser tab.

**Every repair became a file instead of a paste.** This was the unexpected one.
Once the harness could ship a script to the host and run it, each diagnostic I
wrote during the outage survived the outage. Six of them are now permanent
tools, and the second and third times I needed the same check I did not retype
it, I ran it. That is most of the speedup, and none of it required the console
to be clever.

**Being able to repeat a check exactly is what made the diagnosis possible.**
Half of this post is tools that gave me the wrong answer. Catching that
depended on running the same check again after a change and comparing, rather
than remembering what it said twenty minutes ago. By hand I would have believed
the first answer.

The honest summary: the harness did not do anything a person at the keyboard
could not have done. It made each attempt cheap enough that I stopped
rationing attempts, and that is the difference between a night of careful
guessing and a night of measurement.


## The Repair

With the console scripted, the actual sequence was short.

The older of the two installed kernels dropped to an initramfs shell with
`UNEXPECTED INCONSISTENCY; RUN fsck MANUALLY`, which is the good outcome: it
means the filesystem check refused to guess. From there,
`e2fsck -fy` on the root logical volume ran twice. The first pass ended
`FILE SYSTEM WAS MODIFIED` after correcting free-inode counts across many
groups. The second pass ran all five phases with no prompts and exited 0.

**Two consecutive clean passes is the signal, not one.** A single "fixed it"
pass tells you the tool changed something; the second pass tells you the
result is self-consistent. Identical file and block counts across both is what
you are looking for.

Then, in order, and the order matters:

1. **Settle the package manager first.** Four files sitting in its `updates`
   directory proved it had been interrupted mid-write. Clearing that before
   anything else avoids stacking a new failure on an unfinished one.
2. **Test the interpreters the management stack depends on**, because a damaged
   library tree breaks them in ways that surface much later. All passed, which
   was the first genuinely good news.
3. **Resume the boot.** Typing `exit` at the initramfs prompt continues the
   normal sequence. A leftover flag on the kernel command line from an earlier
   attempt meant it landed in single-user rescue mode rather than going all the
   way up; Ctrl-D from there continues to full multi-user. Worth knowing so you
   do not read it as a second failure.

Then the interesting part started.

## fsck Does Not Only Delete, It Cross-Links

The lesson I already knew is that a filesystem check deletes what it cannot
repair. The lesson this outage added is worse, and I had not seen it stated
plainly anywhere:

**fsck also merges directory entries into the wrong inodes.** A file exists,
has plausible ownership and permissions, has a sensible size, and contains
something else entirely.

Three examples from the same box:

- A network daemon binary was a few hundred bytes containing **the text of a
  systemd unit**.
- Its companion CLI binary was tens of megabytes of **nulls**.
- An unrelated multimedia library was **exactly the same size**, also all nulls,
  because it shared that inode. The identical size was the only evidence linking
  them; nothing else about the two files suggested a connection.

Six more shared libraries were present, correctly named, correctly sized, and
not valid executables.

### Every tool I reached for gave me the wrong answer

This is the part worth internalising, because the tools are the ones everybody
reaches for first.

**`ldd` reports only libraries it cannot find.** A library that is present but
zeroed resolves perfectly, so `ldd` says nothing at all. It is the wrong
instrument for this failure. What does find it: `ldconfig`, which reads every
library in the cache and complains `is not an ELF file, wrong magic bytes`, and
a four-byte magic check per file, where a real object must start with
`7f 45 4c 46`.

```bash
od -An -t x1 -N4 /path/to/lib.so   # expect: 7f 45 4c 46
```

**The package verifier reported a clean system while fourteen libraries were
broken.** This one is genuinely dangerous. The verifier compares files against
recorded checksums, but the checksum manifests are themselves files on the
damaged disk. One had been cross-linked to a binary, and a corrupt manifest
makes the verifier **abort early and report almost nothing wrong**. It printed
one damaged file. There were fourteen. A low count from a verifier that also
emitted a control-file error is not a clean bill of health.

**A corrupt trigger file made every reinstall fail.** The obvious fix for a
broken package is to reinstall it. Every attempt aborted with `too-long line or
missing newline`, because the package's own metadata contained executable data
where text belonged. The repair is to quarantine the bad metadata first, *then*
reinstall. Until you do, the reinstall cannot succeed and the error message
does not tell you why.

**The user-visible symptom pointed somewhere else entirely.** What I actually
saw, before any of the above, was virtual machines refusing to start, with the
management layer reporting the emulator binary as an unknown and unacceptably
old version.

The emulator was a perfectly valid executable of the correct version. It links
against one of the corrupted multimedia libraries, so the version probe returned
nothing and the management layer inferred an ancient install. I could have spent
the night on the emulator and found nothing wrong with it.

Generalise that: **when a version check reports "unknown" rather than a wrong
version, suspect the library path, not the binary.**

## The Kernel That Was Never Going to Boot

With the host back up, one thing was still unexplained: why it had gone down
during a routine patch window weeks earlier.

The newer of the two installed kernels was in a half-installed state, flagged
by the package manager as needing reinstallation, with leftover temporary files
from an unpack that was interrupted when the disk failed. Three findings, in
increasing order of severity:

1. **Over a thousand files failed checksum verification**, and the module tree
   was short by hundreds of objects.
2. **The built-in module list was empty**: zero lines, against hundreds for the
   working kernel. Both the filesystem and volume-manager drivers are compiled
   *into* this kernel, so without that list it cannot resolve the drivers it
   needs to mount its own root.
3. **The initramfs was an ELF executable rather than a compressed archive.**
   The same cross-linking failure as the libraries, landing on the one file the
   kernel cannot boot without. Listing its contents returned zero entries and
   the extractor reported `unrecognised compression or corrupted file`.

The kernel image itself was fine. Everything around it was destroyed.

**And the bootloader was already configured to boot it.** Default entry, first
in the menu. Every reboot from the moment that patch landed would have booted
an unbootable kernel. That is what took the machine down originally, and it had
been sitting there as a loaded gun ever since.

### Reinstall, do not purge

Prefer reinstall over purge when repairing a kernel package. Removal runs
post-removal hooks that rewrite the initramfs and regenerate bootloader
configuration, which widens the blast radius of a mistake considerably.
Reinstalling in place re-extracts every file with no window in which the kernel
is half-absent, and it fixes exactly the observed faults, wrong contents and
missing files.

I verified the cached package archives before trusting them, since they had
been downloaded while the disk was failing. Worth knowing: inspecting a
package's control data only reads the metadata member. Listing its *contents*
decompresses the data member, which is what actually proves the archive is
intact.

Sequence: settle the package manager, reinstall, rebuild module dependencies,
regenerate the initramfs **for that one kernel version only**. Not for all
installed kernels: the one kernel known to boot should not be touched while
you are repairing another.

Afterwards the repaired kernel matched the known-good one on every measure I
could check: zero checksum mismatches, a valid archive with all the storage
drivers present, a full built-in module list, and a complete module tree.
It then booted first time.


## A Bootloader Trap

**Pin the default by entry ID, never by index.** Menu positions shift every
time a kernel is added or removed, so a numeric default silently starts
pointing at a different entry, which is a miserable thing to debug at the
console. Also worth disabling the "remember the last manual choice" behaviour,
or a one-off selection at the menu becomes the permanent default without
anyone deciding that it should.

## What Was Actually Wrong With the Hardware

The cable. Every one of the sixty link-ups in the logs had negotiated
1.5 Gbps on a link rated for 6.0. After a replacement cable, a different
port and a different power lead: all links at 6.0 Gbps, and zero interface
errors, zero failed commands and zero filesystem errors under the write load of
starting every guest at once, which was the exact condition that previously
produced error bursts in the hundreds.

The drive was innocent throughout, and said so all along: its cable-error
counter was zero, its self-test passed, its health reported fine. I checked
every device in the machine afterwards with self-tests and full attribute
reads. All clean.

Two things I would tell my past self:

**Check the negotiated link speed, not just the error counters.** One line
tells you a cable is failing before any filesystem notices:

```bash
grep . /sys/class/ata_link/*/sata_spd
```

**Derive device names, never hardcode them.** The disk moved to a different
port during the repair. Every script I had written against the old port name
would now happily report zero errors for a port with nothing attached, which
reads exactly like success.

### Vendors rename the attributes that matter

When I did check the drives properly, a name-based check would have skipped the
most important values. Different vendors report the reallocated-sector count and
the interface CRC counter under their own attribute names, so a check that greps
for the standard name finds nothing, prints nothing, and reads as a pass.

Key on the numeric attribute IDs, which are stable: 5, 183, 187, 197, 198, 199.

## The Diagnostic That Lied Last

One final entry for the collection, because it nearly produced a wrong
conclusion at the very end.

While proving that a UDP datagram was actually arriving at a host, I sent the
packet and watched for it with a packet capture on the interface. Nothing. Four
attempts, different filters, different interfaces, still nothing, while the
capture happily recorded unrelated broadcast traffic on the same port. I was
one step from blaming the switch.

Then I had the host send a packet to its own broadcast address, and the capture
missed that too. The packets had been arriving the whole time. A capture on a
bridge member simply does not see broadcast and locally-originated traffic the
way you expect.

**To prove a datagram is delivered, bind a socket to the port.** It took ten
lines and answered immediately.

Packet captures are authoritative about what crosses a wire. They are not
authoritative about what a host receives.


## What I Changed Afterwards

The recovery is only half the value. The other half is that the next one is
cheaper:

- **Set a kernel panic timeout on every boot entry.**
- **Six reusable diagnostics**, written during the outage and kept: find
  missing libraries, find present-but-corrupt libraries, repair contaminated
  package metadata, verify a kernel package end to end, verify link and media
  health port-agnostically, and prove UDP delivery.
- **A written recovery plan**, so the decision about which tool addresses which
  failure state is already made.

## The Short Version

If you take four things from this:

**Two clean fsck passes, not one.** The first proves it changed something. The
second proves the result is consistent.

**After filesystem corruption, verify file *contents*, not file existence.**
Cross-linked files are the right size with the wrong bytes, and both `ldd` and
the package verifier will tell you everything is fine. ELF magic and
`ldconfig` will not.

**Verify the kernel you are not running.** Mine was corrupt, set as the
default, and had already caused one outage. Nothing about a healthy running
system tells you the next reboot will work.

**Your diagnostic tool is a hypothesis too.** In one night: `ldd` could not
see zeroed libraries, the package verifier reported clean while fourteen
libraries were broken, a version probe blamed the wrong binary entirely, a
packet capture missed packets that were arriving, and a SMART check keyed on
attribute names would have skipped the attributes that mattered. When a tool
tells you nothing is wrong, ask what that tool is physically capable of
seeing.

