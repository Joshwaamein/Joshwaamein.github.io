---
title: "Automating Nextcloud AIO Updates with Bash and Cron"
description: "A small bash script that pulls the latest Nextcloud All-in-One image, recreates the child containers, and triggers the update by calling AIO's internal cron PHP directly — turning AIO's manual UI update flow into something that just runs on a schedule, with proper logging and verification."
date: 2026-05-14 22:00:00 +0100
categories: [Homelab, DevOps]
tags: [nextcloud, docker, bash, automation, cron, linux, self-hosting]
---

I run [Nextcloud All-in-One](https://github.com/nextcloud/all-in-one). It's great. A bundle of containers wired together and managed through one web UI. One-click updates, sane defaults, and most of the moving parts you'd otherwise have to glue together yourself.

The one thing I wanted to change was the manual click-through flow for updates. AIO is designed around a UI-driven update workflow — open the master container's web UI, click "Update all containers", wait, click again. Perfectly fine for occasional use, but I'd much rather it just ran on its own on a sensible schedule and logged what it did.

Here's how I got there with a small bash script and a cron entry.

## How AIO Updates Actually Work

Before writing anything I wanted to understand what the AIO master container actually *does* when you click "Update all containers" in the UI. Once you peel the wrapper off, it boils down to two things:

1. **Pull the new `nextcloud/all-in-one:latest` image.** The mastercontainer is the brain — it pins compatible image versions for every child container. New AIO release = new mastercontainer image = new pinned versions for the children.
2. **Run [`StartAndUpdateContainers.php`](https://github.com/nextcloud/all-in-one/blob/main/php/src/Cron/StartAndUpdateContainers.php).** This is the internal job that orchestrates stopping the old child containers, pulling their new images, and starting them back up. The web UI calls it. The internal cron calls it. So can I.

If I invoke that PHP script directly, I get the same update path the UI button kicks off — just without needing a human to click anything.

## The Script

This lives at `/root/update_nextcloud_aio.sh`. Seven steps, each timestamped, gated by `set -e` so a failure stops everything cleanly. The only part that's environment-specific is the `docker run` block in Step 4 — see the note after the script.

```bash
#!/bin/bash
#
# Nextcloud AIO Update Script
#

set -e

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

log "Starting Nextcloud AIO Update Process"

# Step 1: Pull latest AIO mastercontainer image
log "Step 1/7: Pulling latest Nextcloud AIO image..."
docker pull nextcloud/all-in-one:latest

# Step 2: Stop the existing master container
log "Step 2/7: Stopping nextcloud-aio-mastercontainer..."
docker stop nextcloud-aio-mastercontainer

# Step 3: Remove the existing master container
log "Step 3/7: Removing old container..."
docker rm nextcloud-aio-mastercontainer

# Step 4: Recreate master with the exact same configuration
#         (replace this block with whatever YOUR original `docker run` was)
log "Step 4/7: Recreating master container..."
docker run -d \
  --name nextcloud-aio-mastercontainer \
  --restart always \
  --init \
  -p 8080:8080 \
  -v nextcloud_aio_mastercontainer:/mnt/docker-aio-config \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  nextcloud/all-in-one:latest

# Step 5: Wait for master to settle
log "Step 5/7: Waiting 60 seconds for master container to initialize..."
sleep 60

# Step 6: Force every child container to be recreated next start
log "Step 6/7: Stopping and removing all AIO child containers..."
set +e
for c in $(docker ps     --filter "name=nextcloud-aio-" --format "{{.Names}}" | grep -v mastercontainer); do
    docker stop "$c"
done
for c in $(docker ps -a  --filter "name=nextcloud-aio-" --format "{{.Names}}" | grep -v mastercontainer); do
    docker rm   "$c"
done
set -e

# Step 7: Trigger AIO's internal update cron directly
log "Step 7/7: Triggering Nextcloud update..."
docker exec --user www-data nextcloud-aio-mastercontainer \
    php /var/www/docker-aio/php/src/Cron/StartAndUpdateContainers.php

log "Nextcloud AIO Update Process Completed"
```

A few things worth calling out:

- **Step 4's `docker run` block is the only non-portable part.** Whatever flags, env vars, ports, and volumes you used when you originally created your master container have to be reproduced exactly, or the new master will look at the existing volume and refuse to start. Don't copy mine — pull yours straight off your existing container with `docker inspect nextcloud-aio-mastercontainer` before changing a thing.
- **Step 6 is the gotcha I learned the hard way.** My first version of this script just recreated the master and trusted it to handle the children. It didn't. The mastercontainer happily came up, decided the children were "already running fine", and skipped the upgrade entirely. Stopping and removing the children *first* forces `StartAndUpdateContainers.php` in Step 7 to recreate them from the new pinned images. Without this step the cron PHP is effectively a no-op.
- **`set +e` around Step 6 is intentional.** Some children may not exist (e.g. you've never enabled Collabora). I don't want a missing container to abort the whole update.

## Wiring it Into Cron

Weekly is the sweet spot. Often enough to never be more than a week behind, infrequent enough that point releases have had a chance to settle.

```cron
# root crontab
0 4 * * 0  /root/update_nextcloud_aio.sh >> /root/nextcloud_update.log 2>&1
```

Sunday morning, well outside any usage window. If anything explodes the worst case is "roll back from last night's backup" and life carries on.

## Verifying It's Actually Working

A script that "looks like" it's doing something every Sunday isn't worth much without proof. Three quick checks:

**1. Did the most recent run succeed?**

```bash
grep -E 'Starting|Update command executed|ERROR|WARNING|Completed' \
    /root/nextcloud_update.log | tail -20
```

**2. How many runs have completed cleanly?**

```bash
echo "Successful runs: $(grep -c 'Update command executed successfully' /root/nextcloud_update.log)"
echo "Errors/warnings: $(grep -cE 'ERROR|WARNING'                     /root/nextcloud_update.log)"
```

I've been running this for a few months now with 0 errors and 0 warnings across every weekly invocation. Run durations sit between roughly one and five minutes.

**3. What version is Nextcloud actually on, and is anything pending?**

```bash
docker exec -u www-data nextcloud-aio-nextcloud php occ status
docker exec -u www-data nextcloud-aio-nextcloud php occ update:check
```

`occ status` confirms the running `versionstring`, and `occ update:check` will tell you if a newer point release is available — which is the real test of whether the script is actually moving you forward, not just running successfully.

## A Subtle Point: "Successful" Doesn't Mean "Updated"

Worth flagging because I caught myself on it. If the AIO project hasn't published a new mastercontainer image since your last run, your `docker pull` legitimately gets the same digest, the script runs cleanly, the children get recreated from the same pinned versions — and your Nextcloud version doesn't change. That's not a script failure, that's the script doing exactly what it should.

The way to sanity-check is to compare the running version against the [Nextcloud changelog](https://nextcloud.com/changelog/). If `occ status` reports an older point release than the latest in the changelog but the AIO image hasn't bumped yet, the bottleneck is upstream's release cadence — not your automation. The next scheduled run will pick it up the moment AIO publishes.

## What I'd Improve Next

- **Email alert on failure.** Right now I have to grep the log. Trivial to wire `mail` or an SMTP relay into a `trap` so any non-zero exit pings me.
- **Log rotation.** The log file just grows. A small `logrotate` config to weekly-rotate it with a reasonable retention would be tidy.
- **Pre-flight version capture.** Logging the running Nextcloud version *before* and *after* would make it obvious at a glance which weekly runs actually delivered a new release.
- **Master container health probe** at the end — a quick check that the mastercontainer came back up cleanly before logging "Completed".

## Takeaway

The clean way to automate AIO is to do exactly what the master container does internally — pull the new image, recreate the children, run `StartAndUpdateContainers.php` — but call it directly so it can run on a schedule without any human in the loop. Wrap it in cron, log it, verify it weekly, and it just runs.

Take the script, swap your own `docker run` flags into Step 4, and you're done.
