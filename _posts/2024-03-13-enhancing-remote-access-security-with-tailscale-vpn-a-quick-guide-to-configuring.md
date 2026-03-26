---
layout: post
title: "Enhancing Remote Access Security with Tailscale VPN: A Quick Guide to Configuring ACLs"
date: 2024-03-13
categories: ["Networking", "Security"]
tags: ["tailscale", "vpn", "acl", "remote-access"]
description: "Tailscale VPN offers secure and user-friendly mesh networking. Access Control Lists (ACLs) provide enhanced security by defining precise device access rules. Configure and review ACLs via the Admin Co"
---

In the dynamic landscape of remote work and interconnected devices, ensuring a secure and reliable VPN solution is paramount. Tailscale VPN has emerged as a versatile and user-friendly option, offering not only seamless connectivity but also robust security features. One such feature is the ability to configure Access Control Lists (ACLs), empowering users to define and enforce precise rules for network access.

[Access Tailscale here](https://tailscale.com/)

![](https://cdn.sanity.io/images/w77i7m8x/production/d0d8d900e94bd8c6b9b2f364d3bb2336400672af-1360x725.svg?w=1920&q=75&fit=clip&auto=format)

### Tailscale VPN: A Quick Overview

Tailscale VPN is known for its simplicity and efficiency. Its mesh networking approach allows devices to connect securely over the internet, creating a private and encrypted network. This makes it an ideal choice for remote teams, providing secure access to resources without the need for complex setups. The platform offers a Tailnet for up to 3 users before needing to pay for a subscription.

### Configuring ACLs for Enhanced Security

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-2.png?w=1024)

Access Control Lists (ACLs) in Tailscale enable users to fine-tune their network’s security by specifying which devices are allowed or denied access to specific resources. Here’s a brief guide to configuring ACLs for an added layer of protection:

#### 1\. **Access the Tailscale Admin Console:**

Start by logging into the Tailscale Admin Console, where you can manage your network and access various settings.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-3.png?w=709)

[https://login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines)

#### 2\. **Navigate to ACL Settings:**

Look for the ACL settings section within the console under access controls. This is where you’ll define the rules governing device access.

My aim here was to allow only certain groups to access certain devices. I managed this with groups, tags, and ACLs for each device. To work out the file config I used an ACL sample found here:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-4.png?w=589)

[https://tailscale.com/kb/1192/acl-samples](https://tailscale.com/kb/1192/acl-samples)

#### 3\. **Define ACL Rules:**

Brief summary of what you can configure:

-   **Allow/Block Specific Devices:** Specify the devices you want to allow or block from accessing your network. This ensures that only trusted devices can connect.
-   **Service-Specific Rules:** Tailor access based on specific services or applications. For instance, you can permit access to a file server while restricting access to sensitive databases.
-   **Time-Based Access:** Set up time-based rules to control when certain devices can connect. This is particularly useful for restricting access during non-working hours.

As mentioned, my goal was to allow only certain groups to access certain devices. I managed this with groups, tags, and ACLs for each device. To implement this I created the following ACL file:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-6.png?w=529)

This config file allows admins to access any location from any source. It allows any user to access an exit node which they have access to via their groups and the access they have to each tagged device. A subnet has also been exposed to allow remote LAN access to site 2.

It's important to note that despite a user not being able to access an exit node, the appliance will still show as an option to the user. This is a known issue:

[https://github.com/tailscale/tailscale/issues/1567](https://github.com/tailscale/tailscale/issues/1567)

I then applied the tags to the relevant devices using the web UI:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/tailscale-tags.png?w=1024)

#### 4\. **Review and Save:**

You can then review your changes using the preview menu, which will show you the permissions you have created per user or per group.

Before applying the changes, thoroughly review your ACL rules to ensure they align with your security objectives. Once satisfied, save the settings to enforce the specified access controls.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-7.png?w=763)

---

That's about it for setting up ACLs in Tailscale! It's a straightforward process once you get the hang of the config file, and it really does make a big difference in locking down your network. If you're running Tailscale for your team or homelab, I'd definitely recommend taking the time to set these up. Thanks for reading, and feel free to reach out if you have any questions!
