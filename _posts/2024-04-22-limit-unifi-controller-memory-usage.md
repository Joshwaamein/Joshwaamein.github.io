---
layout: post
title: "Limit UniFi controller memory usage"
date: 2024-04-22
categories: ["Homelab"]
tags: ["unifi", "linux", "java", "memory"]
description: "Unifi controller memory usage adjusted using system.properties."
---

Hey there! If you're running a UniFi controller on a resource-constrained machine and wondering why it's eating up all your RAM - you're not alone. In this quick post, I'll walk you through how I tamed the memory usage on my setup by tweaking the Java heap space settings. Let's get into it.

I have a machine which is running low on memory and hits swap space often. The device is using SD card flash. These changes have been made for some "in production testing..." which is not recommended for critical systems. This article should be read and used with caution.

**Official Minimum Requirements (from Ubiquiti):**

[https://help.ui.com/hc/en-us/articles/360012282453-Self-Hosting-a-UniFi-Network-Server](https://help.ui.com/hc/en-us/articles/360012282453-Self-Hosting-a-UniFi-Network-Server)

-   **Operating System:**
    -   Ubuntu Desktop / Server 22.04
    -   Debian 11 "Bullseye"
-   **CPU:** x86-64 Processor (Intel / AMD x64)
-   **RAM:** 2 GB
-   **Network:** 100 Mbps Wired Ethernet
-   **HDD:** Minimum 10 GB free (20 GB or more preferred)

The network I am working with hosts only a handful of UniFi devices and clients. After doing some reading on the forums where people are managing hundreds of devices with 2 GB of controller memory, I am fairly confident that this will work long term. To ensure this doesn't become a major issue, my Zabbix server will be configured with service discovery and monitoring on the UniFi controller to monitor the status of the UniFi controller service. When I receive an alert, I will make the necessary changes to increase memory.

To edit the controller memory usage:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-1.png?w=377)

Here you will see the xms and xmx values. I have set mine to 256 and 512 in MB. Please continue reading to understand what this means:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-2.png?w=741)

To apply these changes, restart the UniFi service:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image-3.png?w=203)

**Java Heap Space**

-   The UniFi controller is a Java-based application. Java applications use a portion of memory called the "heap space" to store objects and data while the program is running.
-   The size of the heap space directly influences how much memory the UniFi controller can use.
-   The ``unifi.xms`` and ``unifi.xmx`` settings control this memory allocation.

**unifi.xms=256**

-   **Xms:** This stands for the initial heap size (the "minimum").
-   **Effect:** The UniFi controller will start with 256 MB of memory allocated to its heap space. This is the lower boundary.

**unifi.xmx=512**

-   **Xmx:** This stands for the maximum heap size.
-   **Effect:** The UniFi controller can dynamically grow its memory usage up to 512 MB as needed. It will not be allowed to exceed this amount.

**Why Make These Changes?**

1.  **Memory Constrained Systems:** If your UniFi controller is running on a device with limited RAM (like a Raspberry Pi), these settings help prevent it from consuming too much memory and potentially causing instability in your system.
2.  **Performance Tuning:** In some cases, larger heap sizes can improve UniFi controller performance, especially if you have a large network with many devices. However, increasing memory beyond what's necessary won't provide any additional benefit.

That's about it! A quick tweak to the system.properties file and you can keep your UniFi controller from hogging all the memory on your machine. Just remember to keep an eye on things with proper monitoring so you know if you need to bump it back up. Cheers 🍻