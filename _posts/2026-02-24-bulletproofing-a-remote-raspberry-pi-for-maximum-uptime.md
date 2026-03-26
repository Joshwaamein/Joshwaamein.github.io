---
layout: post
title: "Bulletproofing a Remote Raspberry Pi for Maximum Uptime"
date: 2026-02-24
categories: ["Homelab"]
tags: ["raspberry-pi", "linux", "unifi", "reliability", "networking"]
description: "How I hardened a remote Raspberry Pi 4 running a UniFi controller to survive on 905MB of RAM, an SD card, and zero physical access — 200 miles from home."
---

I have a Raspberry Pi 4 sitting in a family member's house, roughly 200 miles away from me. It runs a UniFi Network Controller and a handful of supporting services. It manages their entire network — Wi-Fi, switches, the lot. If it goes down, I can't just walk over and pull the power cable. I need this thing to be rock solid.

The problem? It's a Pi 4 with **905MB of usable RAM** and a **29GB SD card**. The UniFi controller alone is a Java application backed by MongoDB — not exactly lightweight. On top of that, SD cards have a limited number of write cycles before they start failing. So I needed to solve two problems at once: **keep it from crashing** and **keep it from wearing out its storage**.

Here's everything I did.

---

## The Memory Problem

With under 1GB of RAM, the UniFi controller can easily consume most of it. MongoDB's WiredTiger cache, the Java heap, and the OS itself are all competing for the same tiny pool. Left unchecked, the system will hit an out-of-memory condition and the kernel's OOM killer will start terminating processes — potentially including SSH, which would lock me out entirely.

### ZRAM Swap

The first line of defence is **ZRAM** — compressed swap space that lives entirely in RAM. Instead of swapping to the SD card (slow and destructive), ZRAM uses LZ4 compression to create virtual swap devices backed by physical memory.

I'm running two ZRAM devices:

| Device | Algorithm | Virtual Size | Actual RAM Used |
|--------|-----------|-------------|-----------------|
| /dev/zram0 | lz4 | ~453MB | ~184MB |
| /dev/zram1 | lz4 | ~1.1GB | ~89MB |

The configuration in `/etc/default/zram-swap`:

```bash
_zram_algorithm="lz4"
_zram_fraction="1/2"
```

This gives me roughly **1.5GB of virtual swap** from around **270MB of actual RAM** — a huge win on a memory-constrained device. LZ4 was chosen over zstd or lzo for its speed; on an ARM processor with this little headroom, compression latency matters.

### Swapfile as a Safety Net

I also have a **2GB swapfile** on disk, but it's configured at the **lowest priority (-2)**. The system will exhaust both ZRAM devices before touching the SD card. It's a last resort — if the system is hitting the swapfile, something has already gone wrong, but at least it won't immediately crash.

```
/swapfile  file  2G  -2
/dev/zram0 partition  452.5M  100
/dev/zram1 partition  1.1G  15
```

### Kernel Tuning

I've tuned the kernel's memory behaviour via `sysctl`:

```bash
vm.swappiness = 10          # Strongly prefer RAM over swap
vm.vfs_cache_pressure = 50  # Keep filesystem caches longer
vm.dirty_ratio = 20         # Max dirty pages before forced write
vm.dirty_background_ratio = 10  # Start background writeback earlier
```

`swappiness=10` tells the kernel to avoid swapping unless it really has to. `vfs_cache_pressure=50` keeps directory and inode caches around longer, which helps when the UniFi controller is constantly reading config files and database pages.

---

## Capping the Hungry Services

### UniFi Controller Memory Limits

The UniFi controller is the biggest consumer. I've constrained it at two levels — the JVM and systemd.

**Systemd drop-in** (`/etc/systemd/system/unifi.service.d/memory-limit.conf`):

```ini
[Service]
Environment="UNIFI_JVM_OPTS=-Xms256M -Xmx400M -XX:+UseParallelGC -XX:MaxMetaspaceSize=128M"
MemoryMax=500M
MemoryHigh=450M
CPUWeight=50
```

- **`MemoryMax=500M`** — Hard ceiling. If the UniFi service (Java + MongoDB combined) exceeds 500MB, systemd kills it.
- **`MemoryHigh=450M`** — Soft limit. Above this, the kernel aggressively reclaims memory from the cgroup.
- **`-Xmx400M`** — Java heap capped at 400MB.
- **`-XX:MaxMetaspaceSize=128M`** — Prevents classloader leaks from eating RAM.
- **`CPUWeight=50`** — Gives SSH and other critical services CPU priority over UniFi.

The JVM is also configured with `-XX:+ExitOnOutOfMemoryError` and `-XX:+CrashOnOutOfMemoryError` — if Java runs out of heap, it crashes immediately rather than limping along in a broken state. The systemd service will restart it cleanly.

MongoDB's WiredTiger storage engine also has its cache constrained with `cache_size=256M` in the mongod startup arguments.

---

## Early OOM Protection

The kernel's built-in OOM killer is a last resort — by the time it triggers, the system is often already thrashing so badly that SSH is unresponsive. Enter **earlyoom**.

earlyoom monitors available memory and swap, and kills processes **before** the system becomes unresponsive. My configuration in `/etc/default/earlyoom`:

```bash
EARLYOOM_ARGS="-r 60 -m 15 -s 10 --prefer 'java|mongod|unifi' --avoid 'tailscaled|ssh|sshd|systemd|systemd-journald|dbus-daemon'"
```

- **`-m 15`** — Trigger when available memory drops below 15%.
- **`-s 10`** — Trigger when available swap drops below 10%.
- **`-r 60`** — Report memory status every 60 seconds.
- **`--prefer`** — If something needs to die, kill Java, MongoDB, or UniFi first. These are the memory hogs, and they can be restarted.
- **`--avoid`** — Never kill SSH, Tailscale, systemd, or journald. Losing SSH or Tailscale on a remote machine 200 miles away would be catastrophic.

earlyoom itself is capped at 50MB by systemd (`MemoryMax=50M`) and currently uses only about 340KB. It's practically invisible.

---

## Hardware Watchdog

The Pi 4 has a built-in hardware watchdog timer. If the system hangs completely — kernel panic, total freeze, anything that stops the watchdog daemon from checking in — the hardware will **automatically reboot** the device.

This is the nuclear option, but on a remote device with no physical access, it's essential. The watchdog runs at real-time priority to ensure it can always check in, even under extreme system load.

---

## Protecting the SD Card

SD cards use flash memory with a limited number of write cycles. On a server that's running 24/7, uncontrolled logging and swap activity can kill a card in months. Here's how I've minimised writes.

### noatime Mount Option

Both the root filesystem and boot partition are mounted with `noatime`:

```
LABEL=writable  /  ext4  discard,errors=remount-ro,noatime  0 1
LABEL=system-boot  /boot/firmware  vfat  defaults,noatime  0 1
```

Without `noatime`, every single file read updates the "last accessed" timestamp — a write operation for every read. On a busy system, this adds up fast.

### Volatile Logging with Journald

System logs are kept entirely in RAM:

```ini
[Journal]
Storage=volatile
RuntimeMaxUse=64M
RuntimeMaxFileSize=8M
```

`Storage=volatile` means journald never writes logs to disk. They live in `/run/log/journal/` (a tmpfs mount) and are lost on reboot — which is fine for a headless appliance. If I need to investigate an issue, I can SSH in and read them live. The Zabbix agent handles long-term monitoring and alerting.

### Log2Ram

As an additional layer, **Log2Ram** keeps `/var/log` in a RAM disk and syncs it to disk once daily via a systemd timer (`log2ram-daily.timer`). This dramatically reduces the number of individual write operations to the SD card.

### Filesystem TRIM

The `fstrim.timer` runs weekly to send TRIM/discard commands to the SD card, helping the flash controller manage wear levelling more efficiently. The `discard` mount option in fstab also enables continuous TRIM.

### Kernel Module Blacklisting

I've blacklisted dozens of unnecessary kernel modules — framebuffer drivers, unused network drivers, audio modules, USB HID drivers, and legacy FireWire modules. Fewer loaded modules means less kernel memory usage and fewer background operations that could generate unnecessary disk I/O.

---

## Security

Since this device is accessible over the network and manages critical infrastructure, security is non-negotiable.

### Firewall (UFW)

UFW is active with a strict whitelist approach. Only the ports needed for UniFi device communication, the Tailscale VPN, SSH, and Zabbix monitoring are open. Management interfaces are restricted to the VPN subnet and local network — they're not exposed to the internet.

### Fail2Ban

Fail2Ban watches for SSH brute-force attempts:

```ini
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 3
backend = systemd
dbpurgeage = 1d

[sshd]
enabled = true
```

Three failed attempts in 10 minutes gets you banned for an hour. The `systemd` backend reads directly from the journal (which is in RAM) rather than polling log files — more efficient and avoids unnecessary disk reads. `dbpurgeage=1d` keeps the ban database small.

### SSH Hardening

- **Key-only authentication** — passwords are completely disabled
- **PubkeyAuthentication** enabled
- No password authentication whatsoever

### Unattended Upgrades

Security patches are applied automatically. On a remote device I can't easily access, waiting weeks for manual patching isn't an option.

```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

---

## Remote Access with Tailscale

Tailscale provides a WireGuard-based mesh VPN that gives me secure access to the Pi from anywhere. Even if the ISP changes the public IP, even if the router restarts, Tailscale maintains the connection. It's the lifeline that makes managing a device 200 miles away actually feasible.

The Pi also offers itself as a Tailscale exit node, which means I can route traffic through the remote network when needed — useful for accessing the UniFi web UI or troubleshooting local network issues as if I were physically there.

---

## Monitoring with Zabbix

The Zabbix agent reports system health metrics back to my central monitoring server. CPU, memory, disk usage, swap activity, service status — if anything starts trending in the wrong direction, I get an alert before it becomes a problem.

This is how I originally discovered the excessive swap usage that kicked off this whole hardening project.

---

## The Result

This Pi has been running for **11+ days** since its last reboot (which was a planned maintenance reboot, not a crash). It's serving a UniFi controller managing an entire network and reporting back to my monitoring stack — all on 905MB of RAM and an SD card.

The key takeaway: **a low-powered device can be reliable if you respect its constraints.** Cap your memory-hungry services, protect against OOM conditions before they become critical, minimise disk writes, and always — always — make sure you can't lose remote access.

```
$ uptime
22:15:19 up 11 days, 20:47, 0 users, load average: 1.36, 1.16, 1.05

$ free -h
              total    used    free    shared  buff/cache   available
Mem:          905Mi   676Mi    73Mi     13Mi      155Mi       101Mi
Swap:         3.5Gi   675Mi   2.9Gi
```

It's not glamorous, but it works. And when you're 200 miles away, *working* is all that matters.
