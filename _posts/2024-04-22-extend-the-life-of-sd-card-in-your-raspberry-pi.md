---
layout: post
title: "Extend the life of SD card in your Raspberry Pi"
date: 2024-04-22
categories: ["Homelab"]
tags: ["raspberry-pi", "linux", "storage", "sd-card", "zram"]
description: "Improve SD card lifespan with backups, free space, swap removal, ZRAM."
---

If you’re running a Raspberry Pi off an SD card (and let’s be honest, most of us are), you’ve probably wondered how long that little card is going to hold up. SD cards aren’t exactly built for the constant read/write abuse that a full Linux system throws at them. The good news is there are some simple tweaks you can make to squeeze a lot more life out of your storage — and save yourself from a corrupted card headache down the road.

I recently set up a Raspberry Pi for a friend, which is running a network controller and a few other applications, including a Zabbix monitoring server’s client application. The server alerts me of any issues with the device and its components to ensure maximum uptime and connectivity for the network.

Recently, I received an alert on my monitoring server, indicating that the machine is using its swap space frequently. This made me realize that the life of the SD card in the device will be eaten away faster than I’d like. Hence, I would like to make some tweaks to improve the endurance of the storage on the appliance.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/04/image.png?w=940)

SD cards have a short lifespan because they use flash memory, which can handle only a certain number of write/erase cycles before it starts to wear out and become unreliable. Consumer-grade SD cards have a lower write cycle limit than specialised endurance SD cards or typical hard drives. Although wear levelling spreads writes evenly across the card, extending its usable life, it is not a perfect solution. Over time, all the cells will eventually start degrading, and a normal SD card may only last a few years.

To extend the life of the SD card, you can do the following:

1. **Back up regularly**

   Always have a backup of your important data from the SD card. SD cards *will* fail eventually — it’s not a question of *if* but *when*. Keep regular backups so that when the card does give out, you can flash a new one and be back up and running in minutes. You can use tools like `dd` to create a full image of your SD card, or use something like `rpi-imager` to clone it. If you’re running headless, a simple cron job that rsyncs critical directories to a network share or USB drive works great too.

2. **Leave plenty of free space**

   Most SD cards use wear levelling algorithms to minimise the number of times each block is written. If the SD card is bigger than you need, the wear can be spread over a much larger area of free space. For example, if you only need 16 GB of storage, consider using a 64 GB card — the extra unused space gives the wear levelling controller more room to spread writes around, which can significantly extend the card’s useful life. When configuring your operating system partitions, leave some space free and avoid filling the card past 70–80% capacity.

3. **Remove swap space (caution)**

   If your machine has enough memory, you can disable swap space on the device. Swap space acts as an extension of your Random Access Memory. When RAM fills up with running applications and processes, data that’s less actively used gets temporarily moved to swap space on the SD card. This frees up RAM for more critical tasks — but it hammers your SD card with writes in the process.

   On Raspberry Pi OS, swap is managed by `dphys-swapfile`. To disable it, run:

   ```bash
   sudo dphys-swapfile swapoff
   sudo dphys-swapfile uninstall
   sudo systemctl disable dphys-swapfile
   ```

   You can verify swap is off with:

   ```bash
   free -h
   ```

   The swap line should show all zeros. Be cautious with this one — if your Pi doesn’t have enough RAM for the workloads you’re running, disabling swap can cause out-of-memory kills. This is best suited for Pis with 4 GB or 8 GB of RAM running lightweight services.

   Reference: [https://raspberrypi.stackexchange.com/questions/169/how-can-i-extend-the-life-of-my-sd-card](https://raspberrypi.stackexchange.com/questions/169/how-can-i-extend-the-life-of-my-sd-card)

4. **Utilize ZRAM compression**

   ZRAM is a Linux kernel module that creates a compressed block device within your RAM. This block device then acts as a swap space or even a temporary disk. When data is written to ZRAM, it’s compressed, allowing you to fit more data into your Raspberry Pi’s limited RAM at the cost of some CPU usage for compression and decompression. Since ZRAM keeps everything in memory, it completely avoids writing swap data to the SD card.

   To set up ZRAM on your Pi, first disable the existing swap (see step 3 above), then install and configure ZRAM:

   ```bash
   sudo apt update
   sudo apt install zram-tools -y
   ```

   Edit the configuration file to set your preferred size and compression algorithm:

   ```bash
   sudo nano /etc/default/zramswap
   ```

   Set the following (adjust percentage to your liking):

   ```
   ALGO=lz4
   PERCENT=50
   ```

   Then restart the service:

   ```bash
   sudo systemctl restart zramswap
   ```

   Verify it’s working with:

   ```bash
   zramctl
   ```

   You should see a `/dev/zram0` device with your configured size. This gives you a compressed swap space that lives entirely in RAM — no SD card writes involved.

   Reference: [https://pimylifeup.com/raspberry-pi-zram/](https://pimylifeup.com/raspberry-pi-zram/)

5. **Use log2ram to reduce logging writes**

   System logs are one of the biggest sources of constant writes to your SD card. Services like `rsyslog` and `journald` write log entries frequently, and over time this adds up. [log2ram](https://github.com/azlux/log2ram) is a lightweight tool that mounts a tmpfs (RAM-based filesystem) over `/var/log`, so all log writes go to RAM instead of the SD card. Periodically (and on shutdown), it syncs the logs back to disk so you don’t lose them entirely.

   To install it:

   ```bash
   echo "deb [signed-by=/usr/share/keyrings/azlux-archive-keyring.gpg] http://packages.azlux.fr/debian/ bookworm main" | sudo tee /etc/apt/sources.list.d/azlux.list
   sudo wget -O /usr/share/keyrings/azlux-archive-keyring.gpg https://raw.githubusercontent.com/azlux/log2ram/master/log2ram.gpg
   sudo apt update
   sudo apt install log2ram -y
   ```

   After installing, reboot your Pi and verify it’s active:

   ```bash
   systemctl status log2ram
   ```

   You can configure the RAM size allocated for logs by editing `/etc/log2ram.conf`. The default of 40 MB is usually fine for most setups.

---

These tweaks are simple but they can make a real difference in how long your SD card lasts. Combine a few of them — disable swap, enable ZRAM, and throw log2ram on top — and you’ll drastically cut down on unnecessary writes. Your SD card will thank you.

I hope this helps you to improve the endurance of the storage on your Raspberry Pi.

Cheers 🍻
