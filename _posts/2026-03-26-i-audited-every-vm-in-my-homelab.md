---
title: "I Audited Every VM in My Homelab — Here's What I Found (and Fixed)"
description: "A comprehensive audit of 27 VMs across 3 Proxmox hosts revealed critical storage issues, broken monitoring, outdated operating systems, and years of accumulated tech debt. Here's how I fixed it all in one session."
date: 2026-03-26 12:00:00 +0000
categories: [Homelab, DevOps]
tags: [proxmox, linux, automation, zabbix, monitoring]
---

My homelab has been running for a couple of years now. Three Proxmox hosts, 27 VMs, a mix of blockchain validators, DNS, monitoring, backup servers, and various projects I've spun up and half-forgotten about. It works, mostly. But I'd never actually sat down and audited *everything* — checking what's over-provisioned, what's under-monitored, what's running outdated software, and what's one bad day away from a disk-full meltdown.

So I did exactly that. And it wasn't pretty.

## The Audit

The audit covered every running VM across all three hosts, pulling data from Proxmox configs (`qm config`), Zabbix API metrics, and in-VM checks via `qm guest exec`. For each VM, I checked CPU and RAM utilisation against what was allocated, disk usage, backup coverage, monitoring status, guest agent health, OS version, and hardware configuration.

## The Scary Findings

### A Disk About to Explode

My AI server was sitting at **81% disk usage with only 5GB free** on a 32GB disk. It was one large model download away from grinding to a halt.

```bash
# The fix was straightforward
qm disk resize 3465 scsi0 +16G                    # Proxmox side
qm guest exec 3465 -- growpart /dev/sda 3          # Grow partition
qm guest exec 3465 -- pvresize /dev/sda3           # Extend PV
qm guest exec 3465 -- lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
qm guest exec 3465 -- resize2fs /dev/ubuntu-vg/ubuntu-lv
```

32GB to 48GB. Usage dropped from 81% to 49%. Crisis averted.

### Four VMs With Broken Monitoring

I had 4 VMs registered in Zabbix that were returning **zero for every metric**. They showed as "monitored" in the dashboard, but the Zabbix agent wasn't actually running inside any of them. The hosts existed in Zabbix, the agent was installed, but the service was dead — so every graph was a flat line at zero.

If any of those VMs had a problem, I'd have had no alert. The fix was reinstalling zabbix-agent2 v7.0 from the official repo on all four, configuring the Zabbix server address, restarting the service, and verifying data started flowing through the Zabbix API.

### Ghost VMs

Two VMs had no QEMU guest agent at all — meaning Proxmox couldn't cleanly shut them down, couldn't run commands inside them, and couldn't even see their IP addresses. One of them was stopped with no `onboot` flag, so it wouldn't even survive a host reboot.

Getting the guest agent onto a stopped VM with no SSH access required mounting its raw disk on the host, injecting an SSH key, starting it, and then installing the agent. Not fun, but it worked.

### VMs Still on Ubuntu 22.04

Seven of my Ubuntu VMs were still on 22.04 Jammy. Not end-of-life yet, but approaching standard support end. I'd been putting off the upgrades because doing them one-by-one is tedious and risky if something breaks. More on how I batched these later.

### PBS Servers Without Unattended-Upgrades

My three Proxmox Backup Server instances — the systems responsible for protecting everything else — didn't have `unattended-upgrades` configured. Now, these servers *are* patched regularly by my Ansible update playbook, so they weren't actually unpatched. But Ansible runs on a schedule, and there's always a gap between a critical CVE dropping and the next playbook run. Adding `unattended-upgrades` as a safety net means security patches get applied daily regardless of when Ansible runs next — belt and suspenders.

```bash
# The key is not just installing the package, but configuring it to actually run
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF
```

### VMs on Directory Storage

Six VMs had their disks stored as qcow2/raw files on directory storage instead of LVM-thin. This means worse I/O performance, no thin provisioning, and more overhead. Most of my other VMs were already on LVM-thin — these were just stragglers from older deployments.

### A Backup Job Pointing to a Deleted VM

One of the backup jobs was referencing a VMID that doesn't exist anymore. Meanwhile, a VM that I'd recently created wasn't in *any* backup job. Classic.

## The Remediation

Here's what I actually did, roughly in order of priority:

### Critical

- **Expanded the AI server disk** from 32GB to 48GB (live, no downtime)
- **Fixed 4 broken Zabbix agents** — reinstalled zabbix-agent2 v7.0, configured the Zabbix server address, verified data flow through the API
- **Installed guest agents** on 2 VMs that were previously unmanageable
- **Added an unmonitored VM to Zabbix** — it had no monitoring at all

### High Priority

- **Fixed backup jobs** — added the missing VM and removed the ghost VMID
- **Configured unattended-upgrades** on all 3 PBS VMs as a safety net alongside Ansible

### Medium Priority

- **Fixed boot orders** on 5 VMs — removed unnecessary PXE boot entries that were slowing down startup
- **Reduced CPU allocations** on 3 over-provisioned VMs (one had 6 cores on an 8-core host at 3% usage)

- **Added iothread** to 2 VMs that were missing it. In Proxmox, enabling `iothread` on a virtio-scsi disk offloads I/O processing to a dedicated thread instead of sharing the main vCPU thread. This reduces latency and improves throughput, especially under heavy disk load. It's a free performance win with no downside — the only catch is it requires a brief VM restart to apply:

```bash
qm set 401 --scsi0 <storage>:vm-401-disk-0,iothread=1,size=32G,ssd=1
qm set 555 --scsi1 <storage>:vm-555-disk-0,iothread=1,size=100G
```

- **Migrated 6 disks** from directory storage to LVM-thin (live migration, no downtime):

```bash
# Move from local qcow2 to LVM-thin — live, no VM shutdown needed
qm disk move 239 scsi0 CRUCIAL_SSD1 --delete 1
qm disk move 404 scsi0 CRUCIAL_SSD1 --delete 1
qm disk move 4070 scsi0 usb-crucial-ssd-1 --delete 1
```

### The Big One: Batch OS Upgrades

Seven VMs needed upgrading from Ubuntu 22.04 to 24.04. Rather than doing them one at a time over several weeks, I decided to batch them all at once. The reasoning: if the upgrade process has a systemic issue (like a broken package or incompatible config), I'd rather find out across all VMs simultaneously and fix it once, than discover it seven separate times.

The trick was deploying an upgrade script to each VM via `qm guest exec` (base64 encoded to avoid quoting hell), then launching it as a systemd transient service so it persists after the guest exec connection drops:

```bash
# Deploy script via guest agent (base64 avoids shell quoting nightmares)
qm guest exec $vmid -- bash -c 'echo <base64_script> | base64 -d > /root/do-upgrade.sh && chmod +x /root/do-upgrade.sh'

# Launch as a persistent service that survives the guest exec timeout
qm guest exec $vmid -- systemd-run --unit=os-upgrade /root/do-upgrade.sh
```

The script itself:
```bash
#!/bin/bash
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
do-release-upgrade -f DistUpgradeViewNonInteractive
reboot
```

I launched all seven simultaneously across both hosts and monitored for failures. Six of seven upgraded cleanly. One needed a dpkg repair via chroot after the upgrade interrupted mid-package-install — nothing a `dpkg --configure -a` couldn't fix.

After the upgrades, one VM triggered a Zabbix disk space alert — the OS upgrade consumed enough extra space to push it over 80%. Turned out the 32GB virtual disk only had 15GB allocated to LVM with 17GB sitting unused. A quick `lvextend` and `resize2fs` sorted it without even needing to resize the virtual disk.

### Cleanup

- **Archived 20 stale Zabbix hosts** — old VMs, deleted devices, test entries. Tagged them `archived=true` via the API rather than deleting, in case I need to reference the historical data.
- **Added missing tags** to VM configs for consistency
- **Fixed backup job references** — removed non-existent VMIDs and added newly created VMs

## Lessons Learned

1. **Audit regularly.** Technical debt compounds silently. Four VMs with broken monitoring could have been months of invisible outages.

2. **Don't put VM disks on directory storage.** LVM-thin is better in almost every way — thin provisioning, better I/O, proper snapshot support. Reserve `local` for ISOs and templates.

3. **`systemd-run` is your friend.** When you need to launch a long-running process via `qm guest exec` that would otherwise time out, `systemd-run --unit=name /path/to/script` creates a persistent service that survives the connection drop.

4. **Unattended-upgrades needs configuration, not just installation.** The package alone does nothing — you need the `20auto-upgrades` and `50unattended-upgrades` config files with the right origins. Even if you have Ansible handling updates, it's worth having as a safety net.

5. **Batch your upgrades and monitor for failures.** Doing OS upgrades one-by-one across weeks means you discover the same issues seven times. Batching them lets you catch systemic problems early and fix them once.

6. **Base64 encode scripts** when passing them through multiple layers of SSH/shell quoting. Saves hours of escaping hell.

## What's Left

- **PBS-S3 optimisation** — My S3-backed PBS datastore kept dropping connections under load during the pre-flight backups. Needs a separate deep dive into cache management and retention policies.

## Final State

27 VMs audited. 15 remediation steps executed and verified. 7 OS upgrades. 6 disk migrations. 4 monitoring fixes. 20 stale hosts archived. Zero data lost.
