---
title: "I Built a Health Check Script for Evernode Validators — 61 Checks in One Command"
description: "Evernode Node Doctor is a bash script that validates everything needed to run an Evernode node on the Xahau blockchain — system requirements, Docker, networking, SSL, port scanning, account balances, and Xahau WSS connectivity. 750 lines, 15 phases, zero dependencies beyond standard Linux tools."
date: 2026-02-12 12:00:00 +0000
categories: [Homelab, DevOps]
tags: [bash, blockchain, evernode, xahau, linux, monitoring]
---

I run a couple of [Evernode](https://evernode.org) validator nodes. For anyone unfamiliar, Evernode is a decentralised hosting platform built on the [Xahau](https://xahau.network/) blockchain (an XRPL sidechain). Running a node means keeping Docker containers healthy, ports open, SSL certificates valid, Xahau WebSocket connections alive, and XRPL accounts funded — all at once.

The problem is that when something goes wrong, the failure mode is usually silent. Your node just stops earning reputation, and you don't notice until you check the dashboard days later. Debugging means SSH'ing in and manually checking a dozen different things: is Docker running? Are the sashimono containers up? Is port 22861 reachable from outside? Is the Xahau node in `full` state? Does the host account have enough EVR?

So I wrote a script that checks all of it in one go.

## What It Does

[Evernode Node Doctor](https://github.com/Joshwaamein/evernode-node-doctor) is a ~750-line bash script that runs 61 individual checks across 15 validation phases. You run it, it tells you what's healthy and what's broken, colour-coded and with a summary at the end.

```bash
curl -sO https://raw.githubusercontent.com/Joshwaamein/evernode-node-doctor/main/evernode_health_check.sh
chmod +x evernode_health_check.sh
sudo ./evernode_health_check.sh
```

The 15 phases:

1. **System Requirements** — CPU cores, RAM, free disk space
2. **System Uptime** — uptime and load average
3. **Docker Infrastructure** — Docker service status, container health, sashimono containers
4. **Evernode Installation** — evernode CLI version, sashimono config
5. **Network Latency** — ping to 8.8.8.8, 1.1.1.1, google.com
6. **SSH Security** — root login, password auth, SSH port
7. **SSL Certificates** — certificate validity, expiry, reverse proxy detection
8. **DNS Resolution** — forward and reverse DNS for the node's domain
9. **Firewall Rules** — UFW status, required ports open
10. **Port Scanning** — nmap external port scan, port usage analysis
11. **Port Purpose Documentation** — explains what each port range is for
12. **Xahau WSS Connection** — WebSocket connectivity to the Xahau blockchain
13. **Xahau Node State** — verifies the node is in `full` state (not just `connected`)
14. **XRPL Account Balances** — host account XAH balance, EVR trust line, reputation account
15. **Log Analysis** — recent error patterns in Evernode logs

## The Three-Tier Xahau Validation

This was the trickiest part to get right. The script needs to verify that your node has a healthy connection to the Xahau blockchain, but there are multiple ways to check and each has different failure modes.

The v2.6 update implements a three-tier approach:

1. **WebSocket (websocat)** — direct WSS connection to the Xahau endpoint, sends a `server_info` request and parses the response. This is the most reliable check but requires `websocat` to be installed.

2. **API v1 (HTTPS)** — falls back to an HTTPS request with `api_version: 1` for enhanced validation. Checks that the node state is specifically `full` (not `validating` or `proposing`, which indicate the node is still syncing).

3. **Standard API (HTTPS)** — final fallback using the standard Xahau API endpoint.

Each tier validates the node state and gracefully degrades to the next method if the current one fails. No hard dependencies — if `websocat` isn't installed, it just moves to HTTPS.

## Cron Mode

Running the script interactively is fine for debugging, but I wanted it to run automatically and alert me when something breaks. The `--cron` flag makes it fully non-interactive:

```bash
# Run every 6 hours, log output, email on failure
0 */6 * * * /root/evernode_health_check.sh --cron >> /var/log/evernode-doctor.log 2>&1
```

In cron mode, the script auto-detects everything it needs:
- **Domain** — parsed from `/etc/sashimono/mb-xrpl/mb-xrpl.cfg`
- **Instance count** — counted from running sashimono Docker containers
- **Host account** — extracted from the sashimono JSON config
- **Reputation account** — extracted from the sashimono JSON config

No prompts, no user input. It also supports `--no-color` for clean log output, `--skip-accounts` to skip balance checks, and `--skip-logs` to skip log analysis.

## Port Usage Analysis

One thing that caught real issues on my own nodes was the port usage analysis. It's not enough to check that a port is open in UFW — you need to verify something is actually *listening* on it. A port that's open in the firewall but has nothing behind it is a security risk with no benefit.

The script cross-references UFW rules with `netstat` output and flags any mismatches:

```
⚠ WARNING: Port 22861 is open in firewall but nothing is listening
```

It also documents what each port range is for, which is useful because Evernode uses several non-standard ranges:

| Port Range | Purpose |
|-----------|---------|
| 80, 443 | HTTP/HTTPS for SSL and API |
| 22861-22870 | Evernode peer communication |
| 26201-26210 | Sashimono instance ports |
| 36525-36540 | HotPocket consensus |
| 39064-39080 | User port mappings |

## Account Balance Checks

The script queries the Xahau network to check:
- **XAH balance** on the host account (the native token needed for transaction fees)
- **EVR trust line** — verifies the trust line exists and shows the balance (EVR is the Evernode reward token)
- **Reputation account** — checks it exists and has sufficient XAH

This catches the annoying scenario where your node is running perfectly but you've run out of XAH for transaction fees, so it silently stops participating in consensus.

## The Summary Report

At the end, you get a colour-coded summary:

```
═══════════════════════════════════════
         HEALTH CHECK SUMMARY
═══════════════════════════════════════
✅ Successes: 52
⚠️  Warnings:  6
❌ Errors:     3
═══════════════════════════════════════
```

Errors are things that will prevent your node from working. Warnings are things that should be fixed but aren't immediately critical. And the individual check output above tells you exactly what each issue is and how to fix it.

## Why Bash?

I considered Python, but bash was the right choice here:
- **Zero dependencies** — every tool used (`curl`, `nmap`, `openssl`, `jq`, `ufw`) is either already installed or can be installed via `apt`
- **Runs anywhere** — Evernode nodes run on Ubuntu, and bash is guaranteed to be there
- **Root access** — the script needs to read Docker state, UFW rules, and system configs. Bash makes this natural
- **Single file** — `curl | bash` deployment. No virtualenvs, no pip, no package managers

The tradeoff is that bash gets messy at 750+ lines. But for a diagnostic tool that just needs to check things and print results, it's the right fit.

## What It Found on My Nodes

When I first ran this against my own nodes, it caught:
- A node where the Xahau state had dropped from `full` to `connected` after a network hiccup (it wasn't earning reputation)
- Port 22861 open in UFW but the Evernode service had crashed, so nothing was listening
- An expired SSL certificate on one node (the auto-renewal cron had silently failed)
- Low XAH balance on a reputation account

All things I would have eventually noticed from the Evernode dashboard, but probably not for days.

The script is open source at [Joshwaamein/evernode-node-doctor](https://github.com/Joshwaamein/evernode-node-doctor). It's read-only — it doesn't modify any configs or restart any services. Safe to run on production nodes.
