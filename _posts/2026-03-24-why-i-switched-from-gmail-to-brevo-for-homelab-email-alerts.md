---
layout: post
title: "Why I Switched From Gmail to Brevo for All My Homelab Email Alerts"
date: 2026-03-24
categories: ["Homelab", "DevOps"]
tags: ["email", "brevo", "sendinblue", "proxmox", "zabbix", "esp32", "smtp", "linux", "automation"]
description: "How and why I migrated all my homelab email alerts — Proxmox backups, Zabbix monitoring, and even an ESP32 door sensor — from Gmail App Passwords to Brevo's SMTP relay."
---

I run a fairly typical homelab: three Proxmox servers, a Zabbix monitoring instance, and a handful of IoT devices. They all need to send email alerts — backup reports, threshold warnings, door sensor notifications. For years, I used Gmail with App Passwords for this. Last week, I ripped it all out and switched everything to **Brevo** (formerly Sendinblue). Here's why.

---

## The Problem With Gmail

Gmail's SMTP server (`smtp.gmail.com`) works fine for casual use, but it has some serious pain points when you're running it across multiple servers and devices:

### 1. Authentication Failures and Bounces

Gmail has been tightening its sending policies. My Proxmox servers were trying to send directly to Gmail's MX servers, and every single email was getting bounced:

```
550-5.7.26 Your email has been blocked because the sender is unauthenticated.
Gmail requires all senders to authenticate with either SPF or DKIM.
```

My servers use `.local` hostnames (e.g. `your-server.local`), so there's no SPF or DKIM to speak of. Gmail was rejecting everything.

### 2. App Password Management

Each service needs its own App Password. Across three Proxmox nodes, Zabbix, Netdata, and an ESP32, that's a lot of credentials to manage. If Google decides to revoke them (which happens), you're scrambling to regenerate and update them everywhere.

### 3. IPv6 Rejection

Even when authentication was configured, Gmail was rejecting emails sent over IPv6 because my residential IP doesn't have proper PTR records:

```
550-5.7.1 Gmail has detected that this message does not meet IPv6 
sending guidelines regarding PTR records and authentication.
```

### 4. Sender Address Limitations

With Gmail, your sender address **must** be your Gmail address. You can't send from `proxmox-alerts@yourdomain.com` — it'll always show as your personal Gmail in the recipient's inbox.

---

## Why Brevo?

[Brevo](https://www.brevo.com/) (formerly Sendinblue) is a transactional email service with a generous free tier — **300 emails per day** — which is more than enough for homelab alerts. Here's what made it the right choice:

- **Proper SMTP relay** — Your servers authenticate with Brevo, and Brevo handles the delivery with proper SPF, DKIM, and DMARC. No more Gmail bounces.
- **Custom sender addresses** — I can send from `proxmox-alerts@yourdomain.com`, `zabbix-alerts@yourdomain.com`, and `door-alerts@yourdomain.com`. Each service gets its own identity.
- **One set of credentials** — One SMTP key works across all my servers. Or I can generate separate keys per service for better security isolation.
- **No IPv6 issues** — Brevo's relay servers handle delivery over their own well-configured infrastructure.
- **Works everywhere** — Standard SMTP on port 587 with STARTTLS. Works with Postfix, Zabbix, ESP32, anything that can speak SMTP.

---

## What I Migrated

### Proxmox Servers (node1, node2, node3)

All three Proxmox nodes now relay through Brevo via Postfix. The configuration is identical across all three (minus the hostname):

**`/etc/postfix/main.cf`** — key additions:
```ini
relayhost = [smtp-relay.brevo.com]:587
smtp_sasl_auth_enable = yes
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_sasl_security_options = noanonymous
smtp_tls_security_level = encrypt
smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt
sender_canonical_maps = hash:/etc/postfix/sender_canonical
```

**`/etc/postfix/sasl_passwd`**:
```
[smtp-relay.brevo.com]:587 your-brevo-login@email.com:YOUR_BREVO_SMTP_KEY
```

**`/etc/postfix/sender_canonical`** — rewrites the `From` address:
```
root@your-server.local proxmox-alerts@yourdomain.com
root proxmox-alerts@yourdomain.com
```

After running `postmap` on both files and restarting Postfix, backup notifications started flowing immediately.

> **Gotcha:** On two of my servers, the `libsasl2-modules` package wasn't installed, which caused a "no mechanism available" SASL error. A quick `apt install libsasl2-modules` fixed it.

### Zabbix

Zabbix has its own built-in SMTP client, so no Postfix configuration was needed. I just updated the Email media type settings:

| Setting | Value |
|---|---|
| SMTP Server | `smtp-relay.brevo.com` |
| Port | `587` |
| Security | STARTTLS |
| Authentication | Username + SMTP Key |
| Sender | `zabbix-alerts@yourdomain.com` |

### ESP32 Door Sensor

I have an ESP32 with a reed switch that emails me when a door opens or closes. The Arduino sketch uses the `ESP_Mail_Client` library, so the change was straightforward:

```cpp
#define SMTP_HOST "smtp-relay.brevo.com"
#define SMTP_PORT 587
#define AUTHOR_EMAIL "your-brevo-login@email.com"
#define AUTHOR_PASSWORD "YOUR_BREVO_SMTP_KEY"
#define SENDER_EMAIL "door-alerts@yourdomain.com"
```

The key difference from the Gmail version: Brevo uses port 587 with STARTTLS instead of port 465 with SSL, and you can set a separate sender address from the authentication email. I've published both versions (Gmail and Brevo) in my [ESP32 Reed Sensor Email Notifier repo](https://github.com/Joshwaamein/ESP32-Reed-Sensor-Email-Notifier).

---

## The Result

All my alerts now arrive reliably from clean, identifiable sender addresses:

- `proxmox-alerts@yourdomain.com` — Backup reports from all three PVE nodes
- `zabbix-alerts@yourdomain.com` — Monitoring threshold alerts
- `door-alerts@yourdomain.com` — ESP32 door sensor notifications

No more Gmail bounces, no more "sender unauthenticated" errors, no more managing multiple App Passwords. The migration took about an hour across all services.

---

## Tips If You're Doing This

1. **Verify your sender domain in Brevo** — Add your domain in Brevo's settings and set up the DNS records (SPF, DKIM). This ensures your emails don't land in spam.

2. **Install `libsasl2-modules`** on Debian/Ubuntu servers — Postfix needs this for SASL authentication. It's not always installed by default.

3. **Run `newaliases` after editing `/etc/aliases`** — If you're seeing "alias database unavailable" errors in your mail logs, this is probably why.

4. **Use `postqueue -f` to flush stuck emails** — After fixing your Postfix config, flush the queue to retry any deferred messages.

5. **Keep your SMTP keys separate** — Generate different Brevo SMTP keys for different services. If one gets compromised, you only need to rotate that one key.

6. **300 emails/day is plenty** — For a homelab, you'll rarely hit this. My three Proxmox nodes backing up 16+ VMs each, plus Zabbix alerts, use maybe 20-30 emails on a busy day.

---

If you're still using Gmail App Passwords for your homelab alerts, I'd strongly recommend making the switch. Brevo's free tier is generous, the setup is minimal, and the reliability improvement is immediate.
