---
layout: post
title: "How to Use Your Linux PC as a Network Switch"
date: 2025-01-11
categories: ["Homelab", "Networking"]
tags: ["linux", "proxmox", "networking", "bridge"]
description: "Configuring Proxmox Network Interfaces This guide will help you configure a Proxmox host with a newly added dual-port NIC card, switching the management interface and setting up a bridge for additiona"
---
Ever had a spare Linux box sitting around and wished you could use it to extend your network? Turns out, with a bridge configuration, you can essentially turn a multi-NIC Linux machine into a network switch. This is especially handy in a Proxmox homelab setup where you want to share network connectivity across multiple physical interfaces. Let’s walk through how to set it up.


## Configuring Proxmox Network Interfaces

This guide will help you configure a Proxmox host with a newly added dual-port NIC card, switching the management interface and setting up a bridge for additional network connections.

### Identifying Network Adapters

1.  Log in as root or a user with root privileges.
2.  Identify your network adapter names using:

```
ip addr show
```

Note the names of the new adapters (e.g., enp1s0f0 and enp1s0f1).  

### Changing the Uplink Port

1.  Edit the network interfaces file:

```bash
nano /etc/network/interfaces
```

2.  Modify the vmbr0 configuration to use the new uplink port (e.g., enp1s0f0):

```text
iface enp1s0 inet manual

auto vmbr0
iface vmbr0 inet static
        address 192.168.1.x/24
        gateway 192.168.1.1
        bridge-ports enp1s0f0
        bridge-stp off
        bridge-fd 0

source /etc/network/interfaces.d/*
```

My configuration is as follows:

![](https://joshuamein.wordpress.com/wp-content/uploads/2025/01/image.png?w=678)

### Configuring the Bridge

1.  Install bridge-utils if not already present:

```bash
sudo apt-get install bridge-utils
```

2.  Edit the interfaces file again:

```bash
nano /etc/network/interfaces
```

3.  Update the vmbr0 configuration to include both new interfaces:

```text
iface enp1s0f0 inet manual
iface enp1s0f1 inet manual

auto vmbr0
iface vmbr0 inet static
        address 192.168.1.x/24
        gateway 192.168.1.1
        bridge-ports enp1s0f0 enp1s0f1
        bridge-stp off
        bridge-fd 0
```

4.  Save the file and exit the editor.
5.  Apply the new network configuration:

```bash
systemctl restart networking
```

This configuration adds both enp1s0f0 and enp1s0f1 to the existing vmbr0 bridge, allowing them to be used for VM and container traffic. The bridge will handle traffic distribution between the two physical interfaces.

**Note**: Adding a new NIC may change the order and enumeration of attached devices on the PCI bus, potentially altering network interface names. Always verify interface names using `ip addr show` before making changes.

---

And that’s it! Your Linux machine is now acting as a network switch, bridging traffic between its physical interfaces. Pretty neat for a homelab setup, and it saves you from buying extra network hardware.

Cheers 🍻
