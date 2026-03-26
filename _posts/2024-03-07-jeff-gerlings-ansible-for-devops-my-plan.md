---
layout: post
title: "Jeff Gerling's Ansible for DevOps: My Plan"
date: 2024-03-07
categories: ["DevOps"]
tags: ["ansible", "automation", "learning"]
description: "Ansible simplifies server management with powerful automation, like a trusty sidekick in DevOps."
---

![](https://www.ansiblefordevops.com/images/ansible-for-devops-cover-2x.jpg)

Hey everyone! So, I've been on a bit of a tech rabbit hole lately and I'm really excited to share what I've got planned. If you've ever spent hours manually configuring servers, troubleshooting drift between environments, or just wished there was a better way to manage infrastructure — stick around, because I think you're going to love this.

## What is Ansible?

Ansible is a simple, but powerful, server and configuration management tool (with a few other tricks up its sleeve). It's agentless, uses SSH under the hood, and lets you define your infrastructure as code using easy-to-read YAML playbooks. No need to install agents on every machine — just point Ansible at your hosts and go.

[https://www.ansiblefordevops.com/](https://www.ansiblefordevops.com/)

## The Plan

I have a plan to dive deep into Ansible for DevOps and I'd like to share it with you. Ansible has been gaining a lot of attention lately, and I've decided to jump in head first. It's like the superhero of IT system automation, enabling you to make your infrastructure work for you with just a bit of code.

To start learning Ansible, I'm going to work through Jeff Geerling's *Ansible for DevOps* book, which is widely considered the best guide for Ansible enthusiasts. Jeff is a well-known expert in the Ansible community — he's contributed extensively to Ansible Galaxy and has a fantastic YouTube channel full of hands-on tutorials. I'm excited to learn from him and apply what I pick up directly to my homelab.

## Why Ansible?

Why Ansible over other tools like Puppet or Chef? A few reasons:

- **Agentless architecture** — No need to install software on your managed nodes. Ansible connects over SSH and gets the job done.
- **Human-readable playbooks** — Ansible uses YAML, which means your automation scripts are easy to read, write, and share with others.
- **Idempotency** — Run the same playbook multiple times and it won't break things. Ansible only makes changes when changes are needed.
- **Massive community** — Ansible Galaxy is packed with community roles and collections that let you hit the ground running.

It lets you describe your tech setup in easy-to-read code, eliminating the need for manual setups. Ansible automates the tedious stuff and ensures consistency across servers. It's like having a trusty sidekick that takes care of business while you focus on the bigger picture.

## What's Next

I'm thrilled to kick off this journey and share what I learn along the way. My plan is to read through the book, experiment with playbooks in my homelab, and document the whole process here on the blog. Expect follow-up posts as I work through real-world use cases and start automating everything I can get my hands on.

> **Note:** If you're reading this later, I did follow through! Check out my posts on [Passwordless Automated Endpoint Patching using Ansible](/passwordless-automated-endpoint-patching-using-ansible) and [Automatically Secure Endpoints Using Fail2Ban and Ansible](/automatically-secure-endpoints-using-fail2ban-and-ansible) to see Ansible in action with real deployments.

Cheers 🍻
