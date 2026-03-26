---
layout: post
title: "Proxmox: activating LV failed: Activation of logical volume is prohibited while logical volume tmeta is active. (500)"
date: 2024-04-30
categories: ["Homelab"]
tags: ["proxmox", "lvm", "linux", "troubleshooting"]
description: "Logical volumes (LVs) in Linux provide a powerful layer of abstraction for managing storage. Their flexibility lets you easily shrink, expand, and manage disk space. However on proxmox sometimes you m"
---

So you’ve just rebooted your Proxmox server—maybe after a kernel update—and now your local-lvm storage is gone and you’re staring at a cryptic “Activation of logical volume is prohibited” error. Fun times, right? I ran into this exact issue and it took a bit of digging to sort out, so here’s what I found.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-25.png?w=989)

Logical volumes (LVs) in Linux provide a powerful layer of abstraction for managing storage. Their flexibility lets you easily shrink, expand, and manage disk space. However, on Proxmox, sometimes you might encounter the frustrating error message “activating LV failed: Activation of logical volume is prohibited while logical volume is active. (500)” when working with LVs. Let’s unravel this error and find solutions.

**What Does It Mean?**

This error usually occurs when you attempt to activate a logical volume that has active dependent logical volumes. Let’s break down an example:

-   You have a logical volume named “pve/data”.
-   You’ve created additional logical volumes for metadata and thin metadata (“pve/data\_tmeta” and “pve/data\_tdata”) that reside on top of “pve/data”.

In this scenario, you can’t directly activate “pve/data” while its dependents (“pve/data\_tmeta” and “pve/data\_tdata”) are in use. To activate, you’ll first need to deactivate these dependent volumes.

**How Do I Fix It?**

A post by [Talha Mangarah](https://talhamangarah.com/) which helped me temporarily fix this issue can be found on their blog here: [https://talhamangarah.com/blog/proxmox-7-activating-lvm-volumes-after-failure-to-attach-on-boot/](https://talhamangarah.com/blog/proxmox-7-activating-lvm-volumes-after-failure-to-attach-on-boot/)

His commands are:

```
lsblk ( to view the volume names)
lvchange -an pve/data_tmeta (my volume name)
lvchange -an pve/data_tdata (my volume name)
vgchange -ay
```

Although that is only a temporary fix. After doing some further reading and finding this thread: [https://forum.proxmox.com/threads/local-lvm-not-available-after-kernel-update-on-pve-7.97406/page-2#post-430860](https://forum.proxmox.com/threads/local-lvm-not-available-after-kernel-update-on-pve-7.97406/page-2#post-430860)

Fiona, a Proxmox Staff Member, states:

It’s not an LVM bug, but should rather be considered a bug in Proxmox VE’s (and likely Debian’s) init configuration/handling. What (likely) happens is that the `thin_check` during activation takes too long and `pvscan` is killed ([see here for more information](https://bugzilla.redhat.com/show_bug.cgi?id=2023213#c4)).

Another workaround besides the one suggested by [@Fidor](https://forum.proxmox.com/members/134727/) should be setting

Code:

```
thin_check_options = [ "-q", "--skip-mappings" ]
```

in your `/etc/lvm/lvm.conf` and running `update-initramfs -u` afterwards.

EDIT: Yet another alternative is to increase the udev timeout: [https://forum.proxmox.com/threads/l…fter-kernel-update-on-pve-7.97406/post-558890](https://forum.proxmox.com/threads/local-lvm-not-available-after-kernel-update-on-pve-7.97406/post-558890)

**Important Considerations:**

It’s important to note that there is a trade-off when using the “--skip-mappings” option, as it can offer faster performance but at the cost of being less thorough in its detection of metadata inconsistencies. If certain inconsistencies go undetected, they can cause problems. Therefore, it’s recommended to perform a full thin\_check without the “--skip-mappings” option before making this change permanent. This will establish a clean baseline for your thin pool’s health.

---

Hopefully this saves you some time if you run into the same issue. The permanent fix with `thin_check_options` in `lvm.conf` has been solid for me so far. Cheers 🍻
