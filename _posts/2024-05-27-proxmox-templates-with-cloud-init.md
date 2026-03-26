---
layout: post
title: "Proxmox Templates with Cloud Init"
date: 2024-05-27
categories: ["Homelab", "DevOps"]
tags: ["proxmox", "cloud-init", "linux", "automation"]
description: "Cloud images are operating system templates and every instance starts out as an identical clone of every other instance. It is the user data that gives every cloud instance its personality and cloud-i"
---

As part of my upcoming Kubernetes deployment and workload migration, I wanted to standardise and streamline the creation of virtual machines on my Proxmox hosts. I have spent far too long in the Ubuntu install wizard and manually configuring servers. To do this, I used a template VM with a cloud image of Ubuntu 24.04 LTS and cloud-init for my SSH keys for secure authentication.

My aim with this mini-project is to create a template which uses the latest version of Ubuntu LTS with automatic machine and user configuration, SSH keys, and updates on the clone. To do this, I used a pre-configured cloud Ubuntu template from [https://cloud-images.ubuntu.com/](https://cloud-images.ubuntu.com/) along with cloud-init. I used the documentation here to configure cloud-init: [https://technotim.live/posts/cloud-init-cloud-image/](https://technotim.live/posts/cloud-init-cloud-image/).

## What Are the Benefits of Cloud Images?

Ubuntu Cloud Images provide a robust, secure, and flexible solution for cloud deployments, supported by a strong community and professional services.
### Cloud Optimisation

-   **Pre-configured**: Ready to work in cloud settings, reducing setup time.
-   **Cloud-init Integration**: Allows automatic configuration of network settings, SSH keys, and more at first boot.

### Efficiency and Performance

-   **Lightweight**: Faster boot times and better performance.
-   **Optimised Kernel**: Improves performance and stability.

### Security

-   **Regular Updates**: Ensures instances remain secure.
-   **Minimal Attack Surface**: Fewer unnecessary packages reduce security risks.

### Compatibility and Support

-   **Broad Support**: Available on major cloud providers like AWS, Azure, Google Cloud, and OpenStack.
-   **Canonical Support**: Option for professional support from Canonical.

## What Is Cloud-init?

Cloud-init is an industry-standard tool used for provisioning cloud instances. It is responsible for handling the early initialisation of a cloud instance right after it is launched. Cloud-init allows you to customise and configure a new instance automatically, making it particularly useful for automating the setup of virtual machines (VMs) in cloud environments such as AWS, Azure, Google Cloud, OpenStack, and others.

### Key Features of Cloud-init

1.  **Instance Metadata**: Cloud-init can retrieve instance metadata from the cloud provider, which includes information such as the instance ID, public and private IP addresses, and user data scripts.
2.  **User Data Scripts**: Users can pass scripts (shell, Python, etc.) or cloud-config files during the launch of an instance to automate tasks such as installing software, setting up configuration files, and more.
3.  **Configuration Modules**: Cloud-init includes a variety of modules that perform different initialisation tasks. These modules can handle activities like:
    -   Setting the hostname
    -   Configuring network interfaces
    -   Managing users and SSH keys
    -   Running custom scripts
    -   Installing packages
4.  **Multiple Datasources**: Cloud-init supports multiple data sources to fetch metadata and user data, which makes it compatible with various cloud providers.
5.  **Repeatability**: Once configured, cloud-init ensures that the same configuration can be applied consistently across multiple instances, aiding in creating reproducible environments.

### How Cloud-init Works

When a cloud instance is launched, the cloud provider’s platform injects metadata and user data into the instance. Cloud-init then performs the following steps:

1.  **Bootstrapping**: During the initial boot, cloud-init reads the provided metadata and user data.
2.  **Initialisation**: It runs through a series of stages to initialise the system based on this data.
3.  **Customisation**: Executes the provided user data scripts or cloud-config files to customise the instance.

### Use Cases

-   **Automated Software Installation**: Automatically install and configure necessary software upon instance launch.
-   **Consistent Environment Setup**: Ensure that all instances in a deployment are configured identically.
-   **Dynamic Configurations**: Adjust configurations based on the metadata provided at launch time.
-   **Initial Bootstrapping**: Perform essential setup tasks like setting up SSH keys, users, and network configurations.

## How to Deploy Cloud-init

```
## SSH to your Proxmox host

## Pull your cloud image (for me its amd64.img (use the link above for URI))
wget https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img

## Create a new virtual machine
qm create 80000 --memory 2048 --core 2 --name ubuntu2404-template --net0 virtio,bridge=vmbr0

## Import the downloaded Ubuntu disk
qm importdisk 80000 noble-server-cloudimg-amd64.img local

## Attach the new disk to the vm as a scsi drive on the scsi controller
qm set 80000 --scsihw virtio-scsi-pci --scsi0 local:vm-8000-disk-0

## Add cloud init drive
qm set 80000 --ide2 local-lvm:cloudinit

## Make the cloud init drive bootable and restrict BIOS to boot from disk only
qm set 80000 --boot c --bootdisk scsi0

## Add serial console
qm set 8000 --serial0 socket --vga serial0

## Create template from VM
qm template 80000
```

## Configuring Cloud-init

In the Proxmox UI, navigate to your newly created template and select cloud-init. Here you can set credentials, DNS, SSH keys, network, and upgrade settings.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-23.png?w=561)

```
## Create a VM from the template
qm clone 80000 80001 --name ubuntu2404-1 --full
```

## Conclusion

That’s really all there is to it! Once you’ve got your template set up, spinning up new VMs becomes an absolute breeze — no more clicking through install wizards or manually configuring each server. Just clone, boot, and you’re good to go. Cloud-init handles the rest.

Cheers 🍻
