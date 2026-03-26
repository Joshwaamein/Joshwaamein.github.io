---
layout: post
title: "Upgrading a Home Network with Ubiquiti UniFi and Secure Remote Access"
date: 2024-03-14
categories: ["Homelab", "Networking"]
tags: ["unifi", "ubiquiti", "tailscale", "vpn", "wifi"]
description: "Mesh Wi-Fi systems promise whole-home coverage, but they can fall short in demanding environments. In this post, I'll walk you through a recent project where I replaced a struggling mesh network with Ubiquiti UniFi."
---

Hey! Ever had a mesh Wi-Fi system that just couldn't keep up? In this post, I'll share how I helped a friend ditch their struggling setup and upgrade to a Ubiquiti UniFi network — complete with remote access via Tailscale.

Mesh Wi-Fi systems promise whole-home coverage, but they can fall short in demanding environments. In this post, I’ll walk you through a recent project where I replaced a struggling mesh network with a powerful and flexible Ubiquiti UniFi solution. This post will cover network planning, equipment choices, remote access for their on-site kit, and even touch on performance optimisation, offering valuable lessons for your network upgrade.

## The Challenge

My friend’s TP-Link Deco mesh system couldn’t keep up after they moved into a larger home with thick walls and upgraded to gigabit fibre. Wi-Fi overhead, numerous devices, and signal attenuation were causing slowdowns and frustrations. Since they weren’t planning on staying long-term, we needed a portable network solution that also delivered excellent performance.

## Why Ubiquiti UniFi?

Here’s a deeper look into why I chose Ubiquiti UniFi for this upgrade:

-   **Ease of Use:** While offering advanced features, the UniFi Controller software remains intuitive, especially for those with some networking experience.
-   **Maturity:** Ubiquiti has been around for years, and their UniFi product line is tried and tested.
-   **Value:** Wi-Fi 6 access points like the U6+ offer fantastic performance at a reasonable price. We opted against Wi-Fi 7 due to cost and the bottleneck of the 1Gbps wired network infrastructure.
-   **Control:** Create separate guest networks, prioritise devices (great for gaming or video streaming), and isolate network segments with VLANs for enhanced security.
-   **Monitoring:** Analyse traffic patterns, identify bottlenecks, and troubleshoot issues with detailed network insights.
-   **Scalability:** If needs change, you can seamlessly add more access points, switches, or security gateways.
-   **Unified Management:** Control the entire UniFi ecosystem from a single, centralised interface.

## Planning and Lab Testing

-   **Network Mapping:** I worked out a rough floorplan and marked potential access point locations, considering wall materials and device density.
-   **Subnet Considerations:** Since the existing network was on 192.168.x.1/24, I stuck with that for compatibility. Consider re-addressing if you’re starting a network from scratch.
-   **Virtualisation Power:** My Proxmox lab allowed me to spin up a pfSense instance with VLANs, mirroring the target network. This step is critical for minimising installation day disruptions. An example of the topology is shown in the diagram below:

## Deployment Recommendations

-   **Pre-configuration:** Set up the UniFi Controller in your lab (or temporarily on a laptop), adopt the devices, and get the basics like SSIDs and VLANs in place.
-   **Placement Matters:** Mount access points high and in central locations for optimal coverage.
-   **Cabling:** If possible, run Ethernet cables to access point locations for maximum performance and reliability rather than using them as mesh devices.

## Deployment

-   Scope out the physical site, its subnets and devices to document and outline a plan
    -   Obtained a rough floor plan sketch indicating potential access point locations and existing wiring.
    -   Made a list of wireless and wired devices that will be used on the network (laptops, phones, smart TVs, printers, etc.).
    -   Documented existing subnets and VLANs (if any). Plan for any necessary changes or expansions.
    -   Assessed current and projected internet usage to ensure the upgraded network can handle the load.  
        
-   Unbox the kit checking for damage.
-   Power on all kit plugged into local switch only (not connected to lab).
-   Assessed current and projected internet usage to ensure the upgraded network can handle the load.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/1.png?w=486)

-   Flashed SD card with Ubuntu 22.04 to run the network controller and remote access
-   Configured pfSense appliance in my lab with VLAN 68 for isolated project LAN traffic and another VLAN 100 to reach WAN via another isolated subnet to ensure all traffic stays away from my UniFi setup in my lab. The machine was set up with DHCP and DNS on the LAN port on VLAN 68.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/2.png?w=321)

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/3.png?w=602)

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/4.png?w=602)

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/5.png?w=602)

-   Configured switch ports to accept traffic on VLAN 68 and plugged the uplink of the switch into my lab using this port.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/6.png?w=441)

-   Configured a windows virtual machine with a virtual NIC on VLAN 68 to configure the SBC inside of the 192.168.x.0/24 subnet.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/7.png?w=602)

-   Verified DHCP leases

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/8.png?w=602)

-   SSH to ubuntu 22.04 and configure UniFi controller to match the existing equipment at the site, TeamViewer host for arm and Tailscale with exit node and exposed subnet.
    -   Upgrade endpoint
        
        -   Install updates with sudo apt update && apt upgrade -y
        
        -   Create an ubuntu 22.04 update script using bash and set it to run weekly at 1 am on a Tuesday.
            -   sudo nano /home/raspberry/update\_system.sh
                -   Paste:

#!/bin/bash

\# Update package lists

sudo apt update

\# Apply available upgrades

sudo apt upgrade -y

\# Optional: Remove unnecessary packages

sudo apt autoremove -y

-   sudo chmod +x /home/raspberry/update\_system.sh
    
    -   sudo crontab -e
        -   Add line:
            -   0 1 \* \* 2 /home/raspberry /update\_system.sh > /home/raspberry/update.log 2>&1
    
    -   TeamViewer Setup
        
        -   Download Teamviewer host for ARM using wget
        
        -   Run “Teamviewer Setup”

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/9.png?w=602)

-   Tailscale Setup
    
    -   curl -fsSL [https://tailscale.com/install.sh](https://tailscale.com/install.sh) | sh
    
    -   sudo tailscale up –advertise-routes=192.168.x.0/24 –accept-routes –advertise-exit-node
    
    -   UniFi Controller Setup
        -   Followed instructions in: [https://github.com/jacobalberty/unifi-docker](https://github.com/jacobalberty/unifi-docker)
-   Tested items by connecting to the new broadcasting SSID, connecting to TeamViewer to manage the device and testing the Tailscale exit node and exposed subnet.
-   Deploy to the site and configure a static IP on the controller on the subnet at the deployment site. This IP was put into the UniFi controller as required for the inform address for APs and switches to communicate with the controller to provide statistics and configuration changes.
-   Final testing and user feedback, checked in after a few days to question the performance of the new network and remote access.

## Remote Access: Security and Convenience

-   **Tailscale Setup:** brief instructions on installing and connecting Tailscale to both the Raspberry Pi controller and my devices. ([https://tailscale.com/kb/](https://tailscale.com/kb/))
-   **TeamViewer as Backup:** TeamViewer can offer an alternative entry point if the VPN experiences issues. ([https://community.teamviewer.com/English/kb/articles/6318-install-teamviewer-classic-on-linux](https://community.teamviewer.com/English/kb/articles/6318-install-teamviewer-classic-on-linux))
-   **Security Best Practices:**  Remember the importance of strong passwords and keeping both Tailscale and TeamViewer updated.

## Docker for the UniFi Controller: Why It Matters

-   **Version Control:** Docker makes it easy to test new controller versions before rolling them out.
-   **Resource Management:** Docker containers help isolate the UniFi Controller and its dependencies, preventing potential conflicts on the host Raspberry Pi.

## Optimisation Tips

-   **Channel Selection:** Use Wi-Fi scanning tools to discover less congested channels for your access points. The UniFi controller has a built-in scanner tool that allows you to automatically detect nearby broadcasting access points and change channels without user intervention.
-   **Transmit Power:** Fine-tune transmit power on access points to balance coverage and minimise interference. Thankfully, the UniFi system can auto balance the transmit power using its sensors to work out how close the nearest friendly AP is.
-   **Updates:** Keep the UniFi Controller, access point firmware, and security software up to date.

## Conclusion

The Ubiquiti UniFi upgrade was a success! The homeowner now enjoys fast, reliable Wi-Fi that will easily relocate with them. They are also able to access their CCTV and other home-based systems from anywhere with an internet connection using their Tailscale exit node and exposed subnet.

If you're thinking about upgrading your own network or need to set up secure remote access, I hope this gives you a solid starting point. Feel free to reach out with any questions!

Cheers 🍻
