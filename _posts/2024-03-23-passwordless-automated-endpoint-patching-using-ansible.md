---
layout: post
title: "Passwordless Automated Endpoint Patching using Ansible"
date: 2024-03-23
categories: ["DevOps"]
tags: ["ansible", "ssh", "linux", "automation", "patching"]
description: "The post details using Ansible and SSH keys for automated server patching, emphasizing enhanced security, improved efficiency, and scalability. It outlines the high-level steps of the deployment, the "
---

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-20.png?w=860)

Hey everyone! In this post, I'm going to walk you through how I set up passwordless automated patching for my servers using Ansible and SSH keys. It's one of those things that sounds intimidating at first but is actually pretty straightforward once you get the pieces in place. Let's get into it.

I started working on an Ansible deployment project, and I decided to begin with a simple yet crucial task — patching my servers. I prioritised using passwordless authentication for the many benefits it provides. After going through several playbooks and video guides created by experienced individuals, I successfully managed to bring everything together. Now, let's move on to the main topic.

In the world of IT, system patching is a never-ending battle. Vulnerabilities are discovered, patches are released, and administrators scramble to keep their systems up-to-date. This task can be daunting, especially in large environments with diverse endpoints. Luckily, automation tools like Ansible, along with the security of SSH keys, offer an elegant solution to simplify and streamline the patching process.

## Why Go Passwordless?

- **Enhanced Security:** Passwords are a major attack vector. By eliminating passwords from your patching workflow, you significantly reduce the risk of unauthorised access and compromise.
- **Improved Efficiency:** Entering passwords repeatedly is both time-consuming and prone to errors. Passwordless automation makes the process smoother and faster.
- **Scalability:** As your environment grows, managing passwords becomes increasingly complex. Passwordless setups scale effortlessly.

## High-Level Steps of the Deployment

1. **Prepare SSH Keys:**
   - Generate an SSH key pair on your Ansible control node.
   - Distribute the public key to the target endpoints (this can even be automated with Ansible!).
2. **Create an Ansible Inventory:**
   - Build a list of the endpoints you want to manage, organised into groups if needed.
3. **Develop Ansible Playbooks:**
   - Write playbooks using relevant modules:
     - **Linux:** `apt`, `yum`, `dnf` (depending on the distribution)
     - **Ansible Galaxy collections** (provide a list of modules for integrations with other technologies)
4. **Execute the Playbook:**
   - Run the Ansible playbook targeting your inventory. Ansible will connect to each endpoint using SSH keys and apply the necessary patches.

## Walkthrough

First, set up an Ansible control node. I used Ubuntu 22.04 LTS. You should install Ansible and the extra collections to make sure you don't need to download any later.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-9.png?w=845)

> `ansible`: a much larger 'batteries included' package, which adds a community-curated selection of [Ansible Collections](https://docs.ansible.com/ansible/latest/collections_guide/index.html#collections) for automating a wide variety of devices.
>
> — Ansible Community

[https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html)

## Passwordless Login Config

Now you need to generate an SSH key, which you will use for remote logon to the servers you'll be updating (or whatever you choose to automate). You can do this by executing the following command to generate the key.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-8.png?w=862)

You will now need to distribute the key to your remote servers. This can be done with the SSH copy command below. (You will likely need to set up SSH access for the root user, which will be done in the following steps.)

If successful, you will see a message like the one shown below:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-15.png?w=858)

> **Note:** To be able to copy the SSH key to the remote machine, you may need to make changes to the remote server's SSH config. This can be done by using a text editor to change the login parameters and restarting the service. Luckily, this only has to be done once per host. (There are smarter ways of doing this, but I just haven't done it yet!)

**SSH to the remote 'target' machine and elevate to root:**

```bash
sudo -i
```

**Edit the SSH config file:**

```bash
nano /etc/ssh/sshd_config
```

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-10.png?w=664)

**Change the `PermitRootLogin` line to `yes`:**

```
PermitRootLogin yes
```

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-11.png?w=652)

**Set a password for the root user with `passwd`:**

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-21.png?w=665)

**Restart the SSH service:**

```bash
service ssh restart
```

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-12.png?w=653)

**Set a password for the root user with `passwd`:**

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-13.png?w=661)

**Copy the SSH key to the remote machine:**

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-14.png?w=858)

**Revert the login parameters to allow passwordless SSH key login only:**

```bash
nano /etc/ssh/sshd_config
```

**Change the `PermitRootLogin` line to `without-password`:**

```
PermitRootLogin without-password
```

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-16.png?w=652)

**Restart the SSH service:**

```bash
service ssh restart
```

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-17.png?w=666)

## Ansible Configuration

Once you have Ansible installed and your SSH keys set up, you can now declare a hosts file. This is a list of DNS names or IP addresses which you can group or access individually. I chose to create a Debian and Ubuntu group, as this is most of what I run at home.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-18.png?w=888)

[How to set up an Ansible inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html)

Once you have created the hosts file, you can use the playbook below as a template. Save this somewhere safe as a `.yml` file — you will need it later. It's important to note that this playbook will reboot devices if the updates require it. If you don't need this, make sure you comment it out so you don't get any unexpected reboots.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-19.png?w=988)

```yaml
---
- name: All Ubuntu and Debian update and upgrade with reboot on request
  hosts: ubuntu-and-debian
  become: true
  tasks:
    - name: Update apt repo and cache on all Debian/Ubuntu boxes
      apt: update_cache=yes force_apt_get=yes cache_valid_time=3600

    - name: Upgrade all packages on servers
      apt: upgrade=dist force_apt_get=yes

    - name: Check if a reboot is needed on all servers
      register: reboot_required_file
      stat: path=/var/run/reboot-required

    - name: Reboot the box if kernel updated
      reboot:
        msg: "Reboot initiated by Ansible for kernel updates"
        connect_timeout: 5
        reboot_timeout: 300
        pre_reboot_delay: 0
        post_reboot_delay: 30
        test_command: uptime
      when: reboot_required_file.stat.exists
```

## Putting It All Together

We have now created the following items:

- SSH keys for passwordless login
- An Ansible playbook for the automated task
- An inventory/hosts file listing all of our target devices

We can now combine all of these elements into a single action. We define the hosts in our file as the group `ubuntu-and-debian` and specify the playbook along with the key we created in the following command:

```bash
sudo ansible-playbook /home/ansible/ansible-test/PLAYBOOK_NAME_GOES_HERE.yml --key-file /home/ansible/.ssh/ansible
```

This command should then execute your playbook to update your endpoints. This can be automated using a cron job.

[How to use cron jobs](https://www.hostinger.co.uk/tutorials/cron-job)

## Conclusion

Passwordless automated endpoint patching with Ansible and SSH keys provides a secure, efficient, and scalable solution to a critical IT task. By embracing this approach, you can free up valuable time, reduce risk, and ensure your systems are always protected against the latest vulnerabilities.

Thanks for reading — I hope this helped you get started with Ansible patching in your own environment. If you have any questions or suggestions, feel free to reach out!

Cheers 🍻
