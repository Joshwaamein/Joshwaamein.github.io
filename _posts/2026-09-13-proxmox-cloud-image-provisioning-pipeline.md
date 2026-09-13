---
title: "Provisioning Proxmox VMs From Cloud Images: 380 Fewer Packages, One Clone Command, Three Playbooks"
description: "I measured what an Ubuntu cloud image actually saves you (664 packages against 284, a 58% smaller download) and rebuilt my Proxmox VM provisioning as a repeatable pipeline: a build script, a clone script, and three Ansible playbooks. Includes the qm import step most tutorials get wrong, the kernel optimisation that no longer exists, and the playbook run that exited 0 having done nothing."
date: 2026-09-13 14:00:00 +0100
categories: [Homelab, DevOps]
tags: [proxmox, cloud-init, ansible, automation, linux, ubuntu, qemu, templates]
---

I have spent far too much of my life in the Ubuntu Server install wizard. Pick a
language, pick a keyboard layout, wait for the mirror check, decline the snap
suggestions, watch a progress bar, reboot, then start the actual work of making
the machine useful. Twenty minutes of clicking per VM, and every VM comes out
slightly different because a human made twenty small choices along the way.

I wrote about escaping this [back in 2024](/posts/proxmox-templates-with-cloud-init/)
using cloud images and cloud-init. That post worked, and I used it. It was also a
recipe I had followed once, with a command copied from a tutorial and a couple of
claims I had never measured.

This month I rebuilt the whole thing as a pipeline: one script to build a
template, one to clone a VM, and three playbooks to configure it. Along the way I
finally measured the efficiency claims everyone repeats about cloud images, and
found that one of the most-quoted ones is no longer true.

## What a Cloud Image Actually Saves You

A cloud image is a pre-built disk with `cloud-init` baked in. There is no
installer, because the install already happened: you copy the disk, and on first
boot `cloud-init` reads a small metadata blob and applies your hostname, user,
SSH key and network config. A clone is reachable over SSH in under a minute
without anyone opening a console.

The usual framing is that a cloud image is dramatically leaner than an ISO
install. That is true, but the numbers people quote are all over the place, so I
checked. Canonical publishes a package manifest next to every image, which makes
this a two-minute exercise rather than a matter of opinion:

```bash
base=https://cloud-images.ubuntu.com
wget -q $base/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.manifest
wget -q $base/minimal/releases/noble/release/ubuntu-24.04-minimal-cloudimg-amd64.manifest
wc -l ubuntu-24.04-*-cloudimg-amd64.manifest
```

Measured for 24.04 LTS on amd64, September 2026:

| | Packages | `.img` download | `unminimize` present |
|---|---|---|---|
| Server cloud image | 664 | 625 MB | no |
| Minimal cloud image | **284** | **264 MB** | yes |

Two official cloud images exist, and the gap between them is 380 packages. The
minimal image drops `man-db`, `manpages`, `nano`, `vim`, `htop`,
`bind9-dnsutils`, `landscape-common` and the `ubuntu-server` metapackage, among
others. For a VM that configuration management builds and nobody logs into by
hand, that is the better base, and it is a 58% smaller download.

Note the direction of the surprise: the *server* cloud image is heavier than the
figures usually quoted, and the *minimal* one is roughly where people think the
server one sits. If you build your template from
`noble-server-cloudimg-amd64.img` and tell yourself you are running something
lean, you are running 664 packages.

## The Kernel Optimisation That No Longer Exists

Here is the claim I had repeated without checking, and it is the one worth
correcting publicly, because it is everywhere: cloud images ship a stripped
hypervisor kernel instead of the generic one. Fewer physical-hardware drivers,
smaller footprint, less attack surface. It is a satisfying detail.

On 24.04 it is not true. Both manifests show the same kernel:

```
linux-image-virtual              6.8.0-139.139
linux-image-6.8.0-139-generic    6.8.0-139.139
```

`linux-image-virtual` is now a metapackage that depends on the generic kernel,
and Canonical's own package page calls `linux-image-kvm` a *"dummy transitional
package"* that pulls in `linux-image-virtual`. The separate `linux-kvm` flavour
was retired after 22.04.

So the savings are real, and they come from 380 fewer packages plus a much
smaller image, not from a smaller kernel. If you are hand-installing a kernel
flavour to optimise a template, you are installing a metapackage that points at
the kernel you already had.

## The Design Decision That Matters More Than Any Command

Before the commands, the one thing I would tell anyone building this. There are
three places you can configure a new VM, and getting the split wrong is how you
end up with two sources of truth that disagree silently:

```
template    -> nothing host-specific. No users, no keys, no hostname,
               no hardening. Just a bootable OS with cloud-init.
clone-time  -> only what must exist before config management can connect:
               hostname, the cloud-init user, its public key, the IP.
config mgmt -> everything else. Hardening, firewall, fail2ban, monitoring,
               patching, log rotation, timezone, locale, packages.
```

The temptation is to bake hardening into the template, or into a cloud-init
snippet, because it is right there and it feels efficient. Do that and the same
setting now exists in two places. Six months later the playbook changes, the
template does not, and every VM built before the change differs from every VM
built after it. Nothing errors. Both halves look fine individually.

My rule: if a setting has a playbook, the playbook owns it. The template is
deliberately boring.

## The Import Step Most Tutorials Get Wrong

Here is the disk import from my 2024 post, and from most guides you will find:

```bash
qm importdisk 9000 noble-server-cloudimg-amd64.img local
qm set 9000 --scsihw virtio-scsi-pci --scsi0 local:vm-9000-disk-0
```

Two commands, and the second is the one people forget. `qm importdisk` imports
the volume and leaves it as `unused0`: present, visible in the web UI, attached
to nothing. Miss the second command and the template boots to nothing.

Current Proxmox does it in one step, with nothing to forget:

```bash
qm set 9000 --scsi0 local-lvm:0,import-from=/path/to/noble-server-cloudimg-amd64.img
```

`<storage>:0` allocates the volume and `import-from` fills it, attached at
`scsi0` immediately. Verified against `pve-manager 9.2.x`.

While I was in there, the flags the original post omitted:

```bash
qm set 9000 --scsi0 local-lvm:0,import-from=<img>,discard=on,ssd=1,iothread=1
qm set 9000 --agent enabled=1,fstrim_cloned_disks=1
qm set 9000 --ide2 local-lvm:cloudinit --ostype l26
qm set 9000 --serial0 socket --vga serial0 --boot order=scsi0
```

Each one earns its place:

- **`discard=on`**: without it, deleting a file inside a guest never releases the
  block in an LVM-thin pool. Thin allocation only grows, so the pool creeps
  toward its ceiling while the guests inside it look half empty.
  `fstrim_cloned_disks=1` makes the guest agent trim after a clone, which is when
  the gap is widest.
- **`--ide2 <storage>:cloudinit`** is mandatory. No CD-ROM means cloud-init has no
  datasource, and every clone-time setting you carefully pass is silently
  ignored.
- **`--ostype l26`** is what Proxmox keys the cloud-init format off.
- **`--serial0 socket --vga serial0`**: Ubuntu cloud images treat the serial
  console as primary. Without this the noVNC console is blank, which you discover
  at precisely the moment a first boot has gone wrong and you need to watch it.
- **`--boot order=scsi0`** only. The default tries the CD-ROM first, a guaranteed
  miss that adds a BIOS timeout to every single boot.

One more, which cost me nothing but could cost you everything: verify the image
against the published `SHA256SUMS` before building from it. That file becomes the
root filesystem of every VM you clone afterwards. `SHA256SUMS` lists every
architecture and prefixes entries with `*`, so filter to your one filename or
`sha256sum -c` fails on the dozens you never downloaded.

## The Pipeline, End to End

Six steps. Every one is a precondition for the next, which is the only reason to
write it down as an ordered list rather than a pile of scripts.

| # | Where | What |
|---|---|---|
| 1 | Proxmox host | Build the template. Once per Ubuntu release. |
| 2 | Proxmox host | Clone a VM and apply cloud-init values. Once per VM. |
| 3 | Control node | Bootstrap play: hostname, root key, baseline packages. |
| 4 | Control node | Join the private network with the right ACL tag. |
| 5 | Control node | Add the host to the inventory. |
| 6 | Control node | Run the ordered baseline. |

### 1. Build the template

```bash
./build-ubuntu-cloud-template.sh --vmid 9000 --storage <pool> --dry-run
./build-ubuntu-cloud-template.sh --vmid 9000 --storage <pool>
```

Both scripts take `--dry-run`, which prints every `qm` command and changes
nothing. I use it every time, not just the first time.

For the lean base, build the minimal image on its own VMID so both can coexist:

```bash
./build-ubuntu-cloud-template.sh --vmid 9001 --flavour minimal --storage <pool>
```

The minimal tree is a different path *and* a different filename stem, not just a
codename swap, which trips people up:
`/minimal/releases/<codename>/release/ubuntu-<ver>-minimal-cloudimg-amd64.img`.

### 2. Clone a VM

```bash
./clone-vm-from-template.sh --template 9000 --vmid 150 --hostname web-1
```

Or with static addressing and a bigger disk:

```bash
./clone-vm-from-template.sh --template 9000 --vmid 150 --hostname web-1 \
  --ip 192.0.2.50/24 --gw 192.0.2.1 --nameserver 192.0.2.53 \
  --cores 4 --memory 4096 --disk-grow +30G
```

The script waits for the guest agent and prints the address, so there is no
console step to hunt for a DHCP lease.

**Full clone or linked clone?** `--linked` gives you a copy-on-write clone
sharing the template's base disk: near-instant, and ten VMs cost roughly one base
image plus their deltas. The trade-off is that the template becomes permanent.
Every linked clone depends on that base disk, so the template can never be
deleted, moved to other storage, or resized while any clone exists, and the
clones must stay on the same storage. It also needs storage that supports
copy-on-write snapshots (LVM-thin, ZFS, qcow2 on a directory store). I default to
full clones for anything long-lived and use `--linked` for throwaways.

### 3, 4 and 5. Bootstrap, join, inventory

The bootstrap play is the bridge between "a generic clone" and "a host my other
playbooks can touch". Every other play in my repo assumes an already-managed
host: they target inventory groups, connect as root, and several assert that
`/root/.ssh/authorized_keys` already exists. A brand-new clone satisfies none of
that.

```bash
ansible-playbook provision-new-vm.yml -i '192.0.2.50,' \
  -e target_host=192.0.2.50 -e new_hostname=web-1 -e ansible_user=ansible \
  --check --diff
```

It sets the hostname, installs root's key, timezone, locale, baseline packages
and the guest agent. It deliberately does **not** do SSH hardening, the firewall,
fail2ban, monitoring or unattended upgrades, because those already have
playbooks. See the division of labour above.

Two details worth stealing. It writes
`/etc/cloud/cloud.cfg.d/99-preserve-hostname.cfg`, because cloud-init sets the
hostname at *first boot only* and will otherwise revert a later rename on the
next reboot. And package installation runs **before** the timezone and locale
tasks, which is not cosmetic: on the minimal image `locales` does not exist (so
locale generation has nothing to generate) and neither does `cron` (so a timezone
task notifying a `restart cron` handler fires at a service that is not there).
Six packages absent from minimal get installed explicitly, so both flavours
converge on an identical baseline.

Joining the private overlay network is a separate play, because not every guest
needs it and joining consumes a single-use auth key:

```bash
ansible-playbook join-tailscale.yml -i '192.0.2.50,' \
  -e target_host=192.0.2.50 \
  -e tailscale_authkey='<single-use-tagged-key>' \
  -e tailscale_tags='tag:<tier>'
```

The tag sets the host's trust tier in the network ACLs, so the play has no
default for it: you state it deliberately or the run fails. This step comes
before the inventory step because my `inventory_hostname` convention *is* the
overlay address, so a host cannot be in the inventory until it has joined.

### 6. The ordered baseline

```bash
ansible-playbook site-newhost.yml --limit <host> --check --diff
ansible-playbook site-newhost.yml --limit <host>
```

This is a thin orchestrator: it imports the existing playbooks and adds no
configuration of its own, so there is nothing in it to drift out of sync with the
plays it calls. **Always `--limit`.** Without it, it targets the fleet.

The order is the interesting part, because several constraints are load-bearing:

- **Firewall before the SSH lockdown.** The firewall play adds and asserts an SSH
  allow plus a rate-limit *before* enabling the firewall. Reverse these two and
  you lock yourself out of a host you have not finished building.
- **`sshd` hardening before the key-only drop-in.** `sshd` is first-match-wins, so
  the include that disables password auth has to land after the main config is
  final.
- **fail2ban after `sshd` is final**, so its jail matches the running config
  rather than the pre-hardening one.
- **Unattended upgrades and log rotation last**, because the first can reboot the
  host on its own schedule.

There is also a preflight guard that asserts `/root/.ssh/authorized_keys` exists
before the firewall or `sshd` are touched at all. Without it, a run against a
keyless host would cheerfully enforce key-only SSH and strand it. Failing at
preflight is the difference between "nothing happened" and "half applied".

Verification reads `sshd -T` rather than `sshd_config`, which matters: the file
does not show you the drop-in override that is actually in force, and the whole
point is knowing what the daemon is really running.

## Four Traps That Only Showed Up When I Ran It

Everything above passed static checks before it ever touched hardware: shell
syntax clean, `shellcheck` clean, every playbook passing `--syntax-check`, zero
lint findings. Then one end-to-end run on real hardware found four defects. These
are the ones worth warning you about, because three of them fail quietly.

### The run that exited 0 having done nothing

My bootstrap play takes a host by address, because a brand-new VM is not in the
inventory yet. I ran it and got this:

```
PLAY [Preflight - validate the required extra-vars] ****
TASK [Require target_host] ****
ok: [localhost]
TASK [Require new_hostname] ****
ok: [localhost]

PLAY [Bootstrap a new cloud-image VM to fleet baseline] ****
skipping: no hosts matched

PLAY RECAP ****
localhost   : ok=2  changed=0  unreachable=0  failed=0
```

Exit code 0. `failed=0`. Two tasks green. And it had done nothing whatsoever.

`hosts:` is resolved against the inventory. An address that is not in the
inventory matches no host, so the play was skipped, and because my preflight
validation runs against `localhost` it passed happily and made the whole run look
healthy. The fix is one character:

```bash
ansible-playbook provision-new-vm.yml -i '192.0.2.50,' ...
```

The trailing comma is what makes Ansible read the string as an inline host list
rather than a path to an inventory file. Without it you get a silent no-op that
reads as success, which is worse than an error, because an error stops you.

### The wrong SSH key, which cost me the VM

The clone script injects a public key via cloud-init so the guest is reachable
from first boot. It defaulted to the copy on the Proxmox host, which sounds
obviously right and is not.

The key that matters is the one whose **private** half lives on the machine that
runs the playbooks. On my setup those were two different keys, for the ordinary
reason that keys get rotated at different times on different machines. So the new
VM came up reachable from the hypervisor and from my workstation, and *not* from
the control node, which is the only place it needed to be reachable from. The
failure surfaces one step later as `Permission denied (publickey)` from a
playbook, well away from the cause.

I first patched around it by appending the right key by hand. That worked and was
exactly the wrong fix, because the next VM would have had the same problem. So I
destroyed the VM, rebuilt it properly, and made the script verify rather than
assume: it now compares fingerprints against the control node's own copy and
refuses a mismatch with the exact fix printed. I tested it in both directions,
because a guard only exercised on the happy path is not a tested guard.

### The `set -e` bug inside the guard I just wrote

Writing that check produced a bug of its own. This pattern is broken under
`set -e`:

```bash
verify_key() { return 2; }

verify_key
case $? in          # never runs
    2) warn "could not verify" ;;
esac
```

A bare call to a function returning non-zero aborts the script before the `case`
can read `$?`. The script just exits at the call, silently. Capture it instead:

```bash
rc=0
verify_key || rc=$?
case "$rc" in
    2) warn "could not verify" ;;
esac
```

### Expect exactly one failure in `--check` mode

On a fresh cloud image, `--check` reports `No package matching 'qemu-guest-agent'
is available`. It is a check-mode artefact: `apt` cannot see a cache that
`update_cache` only simulated. Measured on my run: check mode `ok=13 failed=1`,
the real run `ok=27 changed=9 failed=0`, and a second real run `changed=0`. Know
which failures are expected, or you will chase one for twenty minutes.

One bonus, for anyone using the minimal image: it has no guest agent yet, so
`qm guest cmd <vmid> network-get-interfaces` cannot tell you the new VM's address
and the clone script's wait will time out. The guest is usually fine. An ARP sweep
plus the guest's MAC finds it:

```bash
for i in $(seq 1 254); do ping -c1 -W1 192.0.2.$i >/dev/null 2>&1 & done; wait
ip -4 neigh show dev vmbr0 | grep -i "$(qm config <vmid> \
  | awk -F'[=,]' '/^net0:/{print tolower($2)}')"
```

And to confirm it booted at all, read the serial console non-interactively.
`qm terminal` needs a tty and fails over SSH with `Inappropriate ioctl for
device`; the socket works:

```bash
{ printf '\n'; sleep 8; } | socat - UNIX-CONNECT:/var/run/qemu-server/<vmid>.serial0
```

A `<hostname> login:` prompt proves cloud-init applied the hostname.

## What I Deliberately Left Manual

Two steps the tooling reports and then stops, because both are decisions rather
than steps: adding the new guest to a backup job (ideally to two targets), and
confirming it appears in monitoring and is not sitting in a no-data state.
Automating a decision you have not made yet just means it gets made badly and
silently.

## The Payoff

A new VM is now two commands on the hypervisor and three playbook runs, and every
one of them is idempotent and re-runnable. No install wizard, no console, no
twenty small human choices. The efficiency argument for cloud images is real, but
it is smaller and more specific than the folklore says: 380 fewer packages and a
58% smaller download on the minimal image, and the same generic kernel you always
had.

The bigger win is not the packages. It is that the machine that comes out the far
end is identical to the last one, because nobody was asked to choose anything
along the way.
