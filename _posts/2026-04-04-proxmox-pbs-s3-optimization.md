---
title: "Optimizing Proxmox Backup Server with S3: Regional Migration and Fixing a Glacier Misconfiguration"
description: "How I investigated and resolved PBS S3 connection issues, migrated to a closer regional endpoint, and properly optimized backups after a Glacier lifecycle misconfiguration."
date: 2026-04-04 12:00:00 +0000
categories: [Homelab, DevOps]
tags: [proxmox, pbs, s3, aws, glacier, backup, optimization, linux]
---

*How I migrated my PBS S3 datastore to a closer regional endpoint, resolved a Glacier lifecycle misconfiguration, and properly optimized the setup*

---

## The Most Important Thing First: Glacier is Incompatible with PBS

Before anything else — **if you're running Proxmox Backup Server with an S3 backend, do not use Glacier lifecycle policies.** This includes Glacier Instant Retrieval, Glacier Flexible Retrieval, and Glacier Deep Archive.

PBS needs immediate, on-demand access to chunks for garbage collection, verification, deduplication, and restores. Glacier storage classes require retrieval requests that can take anywhere from milliseconds to 48 hours depending on tier. The moment PBS tries to access a Glaciered chunk, it fails. This breaks GC, verification, and restores silently or with cryptic errors.

The correct storage class for PBS S3 is **S3 Intelligent-Tiering** — it automatically moves infrequently accessed data to cheaper tiers, but everything remains immediately accessible with no retrieval delays or fees.

---

## Background

I run a Proxmox homelab with multiple PVE nodes and PBS servers. One of my PBS servers uses AWS S3 as a backend for offsite backups. PBS 4.x supports S3 as a "technology preview" feature — it uses a local cache disk and syncs chunks to S3.

The setup had been running for several months and had accumulated a number of issues:
- Intermittent connection errors ("bytes remaining on stream", "Transport endpoint not connected")
- The S3 cache disk was growing without bound
- S3 costs were higher than expected due to Glacier retrieval fees

I decided to do a thorough investigation and fix everything properly.

---

## The Investigation

### Infrastructure Overview

| Component | Details |
|-----------|---------|
| PBS Server | VM on Proxmox |
| S3 Backend | AWS S3 |
| Cache Disk | 850 GB ext4 |

### Key Findings

**1. Wrong Regional Endpoint**
The PBS server and the S3 bucket were in different regions. Every S3 API call was incurring unnecessary cross-region latency. With millions of small chunk objects, this latency compounds significantly — S3 is a high-request-count workload.

**2. Glacier Lifecycle Disaster**
A lifecycle policy was transitioning objects through Glacier tiers:
- Day 14 → Glacier Instant Retrieval
- Day 104 → Glacier Flexible Retrieval
- Day 194 → Glacier Deep Archive

As covered above, this is fundamentally incompatible with PBS. It was silently breaking GC and verification, and would have made restores impossible for older backups.

**3. Unbounded Cache Growth**
The 850 GB cache disk was 65% full with 1.67M chunk files across 65,536 subdirectories. PBS docs recommend only 64–128 GiB for the cache.

Cache breakdown:
- ~71% of chunks were 0-byte marker files (cache index markers)
- ~29% contained actual cached data
- Chunks from months ago were still in the cache
- No automatic cache eviction exists in this PBS version

**4. TCP Keepalive Too Slow**
Default `tcp_keepalive_time` was 7200 seconds (2 hours). Dead S3 connections weren't detected for hours, causing the "Transport endpoint not connected" errors. High latency to a distant S3 region made this worse — more connections timing out silently.

**5. Ext4 Wasted Space**
The cache disk had 4.18% reserved blocks — about 37 GB wasted on a disk where root reservation serves no purpose.

**6. GC Schedule Needed Review**
Garbage collection frequency needs careful consideration with S3 backends — every GC run makes a large number of LIST and HEAD API calls against S3, which cost money. Running GC too frequently wastes money; too infrequently leaves orphaned chunks accumulating. Weekly is a reasonable balance for most setups.

**7. S3 Endpoint Style**
Using path-style addressing (`s3.amazonaws.com/bucket/key`) instead of the recommended vhost-style (`bucket.s3.region.amazonaws.com/key`).

---

## The Optimizations

### Phase 1: No-Downtime Changes

#### 1. GC Schedule

```bash
proxmox-backup-manager datastore update pbs-s3 --gc-schedule "sat 02:00"
```

Weekly GC on Saturday at 2am. Frequent enough to keep orphaned chunks in check, infrequent enough to keep S3 API costs reasonable.

#### 2. Ext4 Reserved Blocks: 4.18% → 1%

```bash
tune2fs -m 1 /dev/sdc
```

Freed ~28 GB immediately. No reason to reserve 37 GB for root on a cache disk.

#### 3. TCP Keepalive Tuning

```bash
cat > /etc/sysctl.d/99-s3-tuning.conf << EOF
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 6
net.ipv4.tcp_fin_timeout = 30
EOF
sysctl -p /etc/sysctl.d/99-s3-tuning.conf
```

Dead S3 connections now detected in ~2 minutes instead of 2 hours. Essential when connection latency is non-trivial.

#### 4. Ext4 Mount Options

Updated `/etc/fstab`:
```
UUID=<disk-uuid> /mnt/S3BackupCache ext4 noatime,commit=120 0 2
```

- `noatime` — Eliminates metadata writes on every access across 1.67M files
- `commit=120` — Reduces journal commit frequency (cache is reconstructible from S3)
- UUID-based mount for stability across disk reorders

#### 5. S3 Endpoint: Path-style → Vhost-style

```bash
proxmox-backup-manager s3 endpoint update pbs-s3 \
    --endpoint '{{bucket}}.s3.{{region}}.amazonaws.com' \
    --region <your-region> \
    --delete path-style
```

Direct regional routing rather than the global endpoint.

### Phase 2: Restart Required

#### 6. RAM: Increased

More RAM means better filesystem caching for 1.67M chunk files — the OS page cache can hold more of the chunk index in memory.

---

## The Migration: Moving to a Closer Region

### The Problem

The PBS server and S3 bucket were in different regions. Every backup chunk upload and every GC/verification API call was crossing region boundaries. This was the root cause of the elevated latency and connection instability.

### Step 1: Create New Bucket in the Correct Region

```bash
aws s3api create-bucket \
    --bucket <your-new-bucket-name> \
    --region <closer-region> \
    --create-bucket-configuration LocationConstraint=<closer-region>
```

Configured with:
- **S3 Intelligent-Tiering** lifecycle (no Glacier)
- Server-side encryption
- Randomized bucket name for security

### Step 2: Restore Glacier Objects

The biggest challenge — over 860,000 objects were in Glacier or Deep Archive and needed to be restored before they could be copied.

| Storage Class | Objects |
|---|---|
| STANDARD | ~828,000 |
| GLACIER_IR | ~212,000 |
| GLACIER | ~433,000 |
| DEEP_ARCHIVE | ~430,000 |

#### First Attempt: Individual API Calls (Too Slow)

Started with parallel `aws s3api restore-object` calls. At ~1–2 seconds per call with 860K objects, this would have taken days.

#### Solution: S3 Batch Operations

Used S3 Batch Operations to restore all Glacier objects server-side:

1. Generated a CSV manifest of all Glacier objects
2. Created an IAM role for batch operations
3. Submitted the batch job via the AWS console

**Result:** ~810,000 succeeded, ~51,000 "failed" with `RestoreAlreadyInProgress` (from our earlier individual attempts — not real failures). Completed in ~2 hours entirely on AWS infrastructure.

### Step 3: Copy Data to New Region

#### Standard Objects (`aws s3 sync`)

```bash
aws s3 sync s3://<source-bucket> s3://<dest-bucket> \
    --region <dest-region> \
    --source-region <source-region> \
    --storage-class INTELLIGENT_TIERING
```

However, `aws s3 sync` refuses to copy objects with GLACIER storage class — even after they've been restored.

#### Glacier Objects (boto3)

Used Python boto3 to copy the restored Glacier objects:

```python
from concurrent.futures import ThreadPoolExecutor
import boto3

s3_dst = boto3.client('s3', region_name='<dest-region>')

def copy_one(key):
    s3_dst.copy_object(
        Bucket='<dest-bucket>',
        Key=key,
        CopySource={'Bucket': '<source-bucket>', 'Key': key},
        StorageClass='INTELLIGENT_TIERING'
    )

with ThreadPoolExecutor(max_workers=20) as executor:
    executor.map(copy_one, glacier_keys)
```

**Result:** ~833,000 objects copied, 0 failures. ✅

### Step 4: Switch PBS to New Bucket

```bash
# Maintenance mode
proxmox-backup-manager datastore update pbs-s3 \
    --maintenance-mode 'type=offline,message="Migrating region"'

# Update endpoint region
proxmox-backup-manager s3 endpoint update pbs-s3 --region <new-region>

# Update bucket name in config
sed -i 's/bucket=<old-bucket>/bucket=<new-bucket>/' \
    /etc/proxmox-backup/datastore.cfg

# Verify connectivity
proxmox-backup-manager s3 check pbs-s3 <new-bucket>

# Remove maintenance mode
proxmox-backup-manager datastore update pbs-s3 --delete maintenance-mode
```

### Step 5: Full Verification

```bash
proxmox-backup-manager verify-job update <verify-job-id> --ignore-verified false
proxmox-backup-manager verify-job run <verify-job-id>
```

---

## Lifecycle Policy: The Right Way

### ❌ Wrong (What I Had)
```
Day 0   → S3 Standard
Day 14  → Glacier Instant Retrieval
Day 104 → Glacier Flexible Retrieval
Day 194 → Glacier Deep Archive
```

This breaks PBS completely — GC, verification, dedup, and restores all require immediate chunk access.

### ✅ Correct
```json
{
    "Rules": [{
        "ID": "pbs-intelligent-tiering",
        "Status": "Enabled",
        "Filter": {},
        "Transitions": [{
            "Days": 1,
            "StorageClass": "INTELLIGENT_TIERING"
        }]
    }]
}
```

S3 Intelligent-Tiering automatically moves infrequently accessed data to cheaper tiers, but everything remains **immediately accessible** with no retrieval fees or delays.

---

## Cache Disk Shrink

After migration, the cache disk was shrunk from 850 GB to 128 GiB:

1. Add new smaller disk to the VM
2. Put datastore in maintenance mode, stop proxy
3. Format new disk: `mkfs.ext4 -L S3BackupCache /dev/sdX && tune2fs -m 1 /dev/sdX`
4. Update `/etc/fstab` with UUID of new disk
5. Mount, start proxy, remove maintenance mode
6. Run `proxmox-backup-manager datastore s3-refresh pbs-s3` — this pulls all manifest/index files from S3 so existing backups become visible in the new cache
7. Remove old disk

> **Important:** After replacing the cache disk, run `s3-refresh`. The new disk starts empty — PBS won't know about existing S3 backups until the manifests are downloaded. This is a one-time operation.

---

## Before & After

| Metric | Before | After |
|--------|--------|-------|
| S3 Region | Distant region | **Closer regional endpoint** |
| API Latency | High | **Low** |
| Endpoint Style | path-style | **vhost-style** |
| Lifecycle | Glacier cascade | **Intelligent-Tiering** |
| GC Frequency | Monthly | **Weekly** |
| TCP Keepalive | 2 hours | **60 seconds** |
| Mount Options | defaults | **noatime,commit=120** |
| Reserved Blocks | 4.18% (37 GB wasted) | **1%** |
| Cache Disk | 850 GB (unbounded) | **128 GiB** |
| Connection Errors | Frequent | **Gone** |
| Backup Performance | Unoptimised | **Optimised** |

---

## Lessons Learned

1. **Never use Glacier lifecycle policies with PBS S3.** PBS needs immediate access to all chunks. Use Intelligent-Tiering instead. Check this before doing anything else.

2. **S3 region matters.** Put the bucket in the same or closest available region to the PBS server. Cross-region latency compounds badly with high object counts.

3. **GC frequency vs. S3 API cost is a real tradeoff.** Every GC run makes thousands of API calls. Don't run it more frequently than necessary — weekly is a good default for most homelab setups.

4. **TCP keepalive tuning is critical for S3.** The default 2-hour timeout means dead connections go undetected. With any meaningful latency, this causes intermittent backup failures.

5. **The PBS S3 cache needs deliberate sizing.** 64–128 GiB is recommended. An oversized cache disk just fills with stale data and is never evicted.

6. **After replacing the cache disk, run `s3-refresh`.** The new disk starts empty — existing S3 backups won't be visible until manifests are downloaded.

7. **`aws s3 sync` won't copy GLACIER-class objects** even when restored. Use boto3 `copy_object()` for those.

8. **ext4 `noatime` is essential** with millions of small files. Every read normally updates access time metadata — eliminating this overhead makes a noticeable difference.

---

*Tags: proxmox, pbs, s3, aws, glacier, backup, optimization, homelab*
