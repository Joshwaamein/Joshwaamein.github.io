---
layout: post
title: "Automatically Secure Endpoints Using Fail2Ban and Ansible"
date: 2024-03-23
categories: ["DevOps", "Security"]
tags: ["fail2ban", "ansible", "linux", "automation"]
description: "Fail2ban is a Linux security tool that prevents unauthorized access by detecting and blocking brute-force attacks. It scans system log files for suspicious activity and automatically creates firewall "
---

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/03/image-22.png?w=519)

Hey there! In this post I'm going to walk through how I used Ansible to automatically deploy Fail2Ban across multiple Linux hosts. If you're managing more than a handful of machines, automating your security config is a no-brainer -- so let's get into it.

As part of my ansible journey I have wanted to ensure that my devices are secure. both in terms of patches and security configuration. one useful too to secure linux based machines is fail2ban.

## **What is Fail2ban?**

Fail2ban is a security tool designed specifically for Linux systems. It protects your server from attacks where malicious actors try to gain unauthorised access.

Fail2ban’s main goal is to prevent brute-force attacks. These attacks happen when attackers repeatedly try to guess your passwords or credentials to break into your system.

Fail2ban works by scanning your system’s log files (e.g., authentication logs) for patterns that indicate suspicious activity. If it detects a potential attack, like too many failed login attempts from a specific IP address, it takes automatic action and creates a firewall rule to ban that IP address.

## Deploying Fail2Ban to multiple hosts via Ansible

Please see my other post on deploying ansible for how to deploy and run this script. Simply swap this playbook for the playbook in:

[Passwordless Automated Endpoint Patching using Ansible](http://passwordless-automated-endpoint-patching-using-ansible)

```yaml
---- name: Install fail2ban and configure sshd  hosts: #INPUT_HOST_HERE#  become: true  tasks:    - name: Install fail2ban      ansible.builtin.apt:        name:          - fail2ban        update_cache: true    - name: Copy fail2ban configuration file      ansible.builtin.copy:        src: fail2ban-ansible/fail2ban-ansible.conf        dest: /etc/fail2ban/jail.d/fail2ban-ansible.conf        mode: '0644'        owner: root        group: root    - name: Stop fail2ban      ansible.builtin.systemd_service:        state: stopped        daemon_reload: true        name: fail2ban    - name: Start fail2ban      ansible.builtin.systemd_service:        state: started        daemon_reload: true        name: fail2ban
```

---

That's all there is to it! With just a single Ansible playbook you can roll out Fail2Ban across your entire fleet and sleep a little easier knowing brute-force attempts are being handled automatically. As always, feel free to tweak the config to suit your setup.

Cheers 🍻
