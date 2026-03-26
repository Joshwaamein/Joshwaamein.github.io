---
layout: post
title: "How to format a volume on Ubuntu and mount it to a folder automatically on start-up"
date: 2024-04-24
categories: ["Homelab"]
tags: ["linux", "ubuntu", "storage", "fstab"]
description: "This is a guide aimed at new starters that want a step by step guide on how to format a volume on ubuntu 22.04 LTS and mount it to a folder automatically on start-up. I couldn’t find many good guides "
---

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/ubuntu-partitions.jpeg?w=1024)

This is a guide aimed at new starters that want a step by step guide on how to format a volume on ubuntu 22.04 LTS and mount it to a folder automatically on start-up. I couldn’t find many good guides with explanations in the past so I wanted to make my own.

**Creating the partition and filesystem**

1.  Find the disk using “lsblk”. In this case the disk I want to format is sde.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-5.png?w=940)

2\. I now want to print the information about the disk to ensure I have the right disk. Use “sudo parted /dev/sde print”

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-6.png?w=625)

3\. I now want to set a disk label for the disk. I am choosing to use gpt over mbr . Use the command “sudo parted /dev/sde mklabel gpt” You can find a comparison of the disk types here: [https://www.freecodecamp.org/news/mbr-vs-gpt-whats-the-difference-between-an-mbr-partition-and-a-gpt-partition-solved/](https://www.freecodecamp.org/news/mbr-vs-gpt-whats-the-difference-between-an-mbr-partition-and-a-gpt-partition-solved/)

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-7.png?w=739)

4\. We now need to make a primary partition that matches the full size of the disk as I am using this for data storage on a HDD. You may want to change these settings based on your preference or hardware type. SSDs tend to live longer if you leave some space for bad block reallocation so you may want to change the size of your volume on the disk. I am using the command “sudo parted /dev/sde mkpart primary ext4 0% 100%”

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-8.png?w=891)

5\. Now we need to make a filesystem on the partition. For this I have used: “sudo mkfs.ext4 /dev/sde1”. (This may take a while depending on the speed of your disk.)

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-9.png?w=940)

**Creating the mount point and mounting on reboot**

1.  Create a mountpoint and set permisssions and ownership on the directory to ensure that your users can reach the directory. To do this I have used 3 commands. [https://www.stationx.net/linux-file-permissions-cheat-sheet/](https://www.stationx.net/linux-file-permissions-cheat-sheet/)

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-10.png?w=750)

2\. We now need to change the mount on reboot. To do this we will edit fstab using “sudo nano /etc/fstab”

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-11.png?w=623)

3\. We now need to add a new line to this file following the same structure. Ill explain what these lines mean. The new one I have added at the bottom.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-12.png?w=940)

**Parts:**

-   /dev/sde1:
    -   This represents the device name of a partition. It indicates the second hard drive (‘sd’) connected to the system, and the first partition (‘1’) on that drive.
-   /media/jellyfin2:
    -   This is the mount point. This is the directory within your Linux file system where the partition’s contents will be accessible.
-   ext4:
    -   The file system type. This is a common Linux file system.
-   defaults:
    -   Mount options. ‘defaults’ implies a standard set of mount options which typically include:
        -   rw: Read-write (mounts the file system with both read and write permissions)
        -   suid: Allow execution of set-user-id and set-group-id programs
        -   dev: Interpret character or block special devices on the filesystem
        -   exec: Allow execution of binaries
        -   auto: Mount the filesystem automatically at boot
        -   nouser: Prevent ordinary users from mounting the filesystem
        -   async: Allow I/O operations to the filesystem to take place asynchronously
-   0:
    -   Dump flag. A value of ‘0’ means the filesystem doesn’t need to be dumped (backed up).
-   2:
    -   Pass number for the fsck (filesystem check) utility. A value of ‘2’ indicates that the filesystem should be checked after non-root filesystems.

**Testing the mount**

To test the mount point we should use “df -h \*path to mount” For example I have run:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-13.png?w=888)

The size is not correct; that’s because the disk has not yet been mounted to the directory. If we reboot and run the same command again the disk size should change next time we run it after a reboot.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-14.png?w=733)

You should now have successfully mounted the new disk or volume on startup. Ill now be adding some docker binds to this disk to manage my media but that can go into another post.