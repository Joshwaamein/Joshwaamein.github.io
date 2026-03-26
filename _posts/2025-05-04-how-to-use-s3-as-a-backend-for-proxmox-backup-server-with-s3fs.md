---
layout: post
title: "How to Use S3 as a Backend for Proxmox Backup Server with s3fs"
date: 2025-05-04
categories: ["Cloud", "Homelab"]
tags: ["proxmox", "aws", "s3", "backup", "linux"]
description: "Proxmox Backup Server (PBS) doesn’t natively support S3 storage as a Datastore, but with a little creativity and the help of s3fs-fuse, you can make it work! Here’s a step-by-step guide to mounting S3"
---

Hey there! If you've ever wished you could back up your Proxmox VMs straight to S3 but found out there's no native support for it, you're in the right place. In this guide, I'll show you how to use s3fs-fuse to bridge that gap and turn an S3 bucket into a fully functional Proxmox Backup Server datastore.

Proxmox Backup Server (PBS) doesn’t natively support S3 storage as a Datastore, but with a little creativity and the help of [s3fs-fuse](https://github.com/s3fs-fuse/s3fs-fuse), you can make it work! Here’s a step-by-step guide to mounting S3 storage and integrating it with PBS.

## 1. Prerequisite: Configuration

Assuming you already have S3 keys generated and PBS installed and configured — let’s jump into setting up S3 as a backend. If you haven't configured your S3 keys, look to the bottom of this post.

## 2. Mounting S3 Storage with s3fs

### Install s3fs

First, install s3fs on your PBS server:

```bash
sudo apt install s3fs
```

### Add Your S3 Credentials

Create the credentials file:

```bash
sudo nano /etc/passwd-s3fs
```

Add your S3 access key and secret in the following format (replace with your actual credentials):

```
ACCESS_KEY_ID:SECRET_ACCESS_KEY
```

Set the correct permissions to keep your credentials secure:

```bash
sudo chmod 600 /etc/passwd-s3fs
```

### Create a Mount Point

Choose a directory where your S3 bucket will be mounted:

```bash
sudo mkdir /mnt/pbs-s3
```

### Mount the S3 Bucket

Now, mount your S3 bucket using s3fs. Here’s an example command (adjust the bucket name and endpoint as needed):

```bash
sudo s3fs YOUR-BUCKET /mnt/pbs-s3 \
  -o allow_other \
  -o passwd_file=/etc/passwd-s3fs \
  -o url=https://s3.nl-ams.scw.cloud \
  -o use_path_request_style \
  -o endpoint=nl-ams \
  -o parallel_count=15 \
  -o multipart_size=128 \
  -o nocopyapi \
  -o dbglevel=info \
  -f -o curldbg
```

**Tip:**  
Check for a `200` response, and try creating a test file:

```bash
touch /mnt/pbs-s3/test.txt
```

If this works, your mount is good to go!

## 3. Auto-Mount S3 on Boot

While `fstab` is the usual way to mount filesystems at boot, many users (myself included!) have found it tricky with s3fs. Instead, here’s a reliable workaround using a cron job.

### Create a Boot Script

```bash
nano ~/s3-mount.sh
```

Paste your s3fs mount command from above into this script.

Make it executable:

```bash
chmod u+x ~/s3-mount.sh
```

### Add to Crontab

Edit the root crontab:

```bash
sudo crontab -e
```

Add this line to mount S3 at every reboot (adjust the path as needed):

```bash
@reboot /bin/sh /home/YOUR-USER/s3-mount.sh
```

## 4. Add the S3 Mount as a Datastore in PBS

Now, in the Proxmox Backup Server UI:

-   Go to **Add Datastore** (bottom of the left panel).
-   Enter the details, pointing the location to your S3 mount (e.g., `/mnt/pbs-s3`).

> **Note:**  
> Creating the Datastore may take a _very_ long time, especially for large buckets.

## 5. Connect PBS Storage to Proxmox VE

On your Proxmox Hypervisor:

-   Navigate to **Datacenter > Storage > Add > Proxmox Backup Server**.
-   Fill in the details.  
    If you’re storing VMs in the cloud, enable **encryption** for your backups — just be sure to keep your encryption key safe!
-   On PBS, click **Show Fingerprint** and copy it into the **Fingerprint** field in Proxmox VE.

Now you can create backups under the **Backup** tab in Proxmox VE. Be patient — backups to S3 are slower than local storage due to upload speeds and S3 overhead.

## 6. Final Tips

-   **Monitor Your Backups:** Check in periodically to ensure backups are running smoothly and data is intact.
-   **Use Intelligent Tiering**: Reduce costs by moving infrequently accessed data to non-hot storage types.
-   **Test Restores:** Always test restoring from your S3-based backups before relying on them in production.
-   **Keep Credentials Safe:** Your S3 access keys are sensitive — treat them like passwords!

You now have a cloud-based backup solution for Proxmox using S3 and s3fs. If you run into issues, check the [s3fs-fuse GitHub page](https://github.com/s3fs-fuse/s3fs-fuse) for troubleshooting tips.

## How to Generate S3 Bucket Access Keys

To connect your Proxmox Backup Server to an S3 bucket, you need an AWS Access Key ID and Secret Access Key. Here’s how you can generate these securely:

### 1. Create an IAM User

-   Log in to your AWS Management Console.
-   Go to the IAM (Identity and Access Management) service.
-   In the left sidebar, click “Users,” then click “Add users.”
-   Enter a username and select “Programmatic access” to generate access keys for API/CLI use.

### 2. Assign Permissions

-   Attach the necessary permissions. For S3 access, you can attach the “AmazonS3FullAccess” policy, or customize permissions as needed.
-   Click “Next” through the remaining setup steps and then “Create user”.

### 3. Retrieve Your Access Keys

-   After the user is created, select the user and go to the “Security credentials” tab.
-   Under “Access keys,” click “Create access key”.
-   You’ll be shown the Access Key ID and Secret Access Key. **Copy and save these credentials immediately** — the Secret Access Key is shown only once.

**Tips:**

-   Never share your access keys publicly.
-   Use IAM policies to restrict permissions to only what’s necessary for your backups.
-   If you lose the Secret Access Key, you must delete the key and create a new one.

---

That's it — you've got yourself a cloud-backed Proxmox Backup Server! Whether you're archiving VMs off-site or just want the peace of mind that comes with redundant storage, this setup has you covered. If you have any questions or run into snags, feel free to reach out.

Cheers 🍻
