---
title: "Outlook Classic Not Syncing New Gmail Folders"
description: "When new Gmail labels wouldn't appear in Outlook Classic despite existing on the IMAP server, the only reliable fix was deleting the OST file to force a full resync. Here's the batch script that automates it on every startup."
date: 2026-03-26 12:00:00 +0000
categories: [Code]
tags: [windows, outlook, gmail, imap, troubleshooting]
---

A friend had their Gmail account set up in Outlook Classic on Windows using IMAP/SMTP. The problem: whenever they created new folders or labels in Gmail's web UI, they'd show up on their iPhone and iPad immediately, but never in Outlook. I'd previously fixed it for them by manually editing the IMAP subscribed folders list, but didn't want to keep doing that every time they created a new label.

## What I Tried

First, the obvious: unchecking **"When displaying hierarchy in Outlook, show only subscribed folders"** in the IMAP Folders dialog. Didn't help on its own.

Querying folders in the IMAP Folders dialog confirmed the missing folder existed on the server — Outlook could see it was there. But none of the usual tricks worked:

- Send/Receive — no change
- Collapsing and expanding the folder tree — no change
- Restarting Outlook — no change
- Unsubscribing and resubscribing — no change

The folder was on the server. Outlook knew it was there. It just refused to display it.

## The Fix

Renaming the Gmail OST file with a `.bak` extension and relaunching Outlook forced a complete resync from the IMAP server. When Outlook starts and can't find its OST file, it creates a new one and pulls everything down fresh. This was the only thing that reliably brought in the new folders.

The OST file lives at:

```
%localappdata%\Microsoft\Outlook\
```

## Automating It

Rather than having them manually rename the file every time, I wrote a batch script that does it on startup:

```batch
@echo off
:: Kill Outlook if running
taskkill /f /im OUTLOOK.EXE >nul 2>&1

:: Wait for the file to be released
timeout /t 3 /nobreak >nul

:: Delete the Gmail OST file
del "%localappdata%\Microsoft\Outlook\*.ost" /q >nul 2>&1

:: Relaunch Outlook
start "" "C:\Program Files (x86)\Microsoft Office\root\Office16\OUTLOOK.EXE"
```

Saved as `OutlookFresh.bat` and dropped into the Windows startup folder (`shell:startup`). Now every time they log in, Outlook starts fresh with a full resync from Gmail's servers. The OST rebuild takes a minute or two depending on mailbox size, but after that everything — including any new folders created on other devices — is there.

## Why This Works

The OST file is Outlook's local cache of the IMAP mailbox. When the folder structure changes server-side, Outlook is supposed to pick it up during sync. In practice, it sometimes doesn't — especially with Gmail's label-as-folder IMAP mapping, which has always been a bit odd. Deleting the cache and forcing a rebuild from scratch bypasses whatever state Outlook has gotten itself into.

It's not elegant, but it's reliable. And for a non-technical user who just wants their folders to appear, a startup script they never have to think about is the right solution.

**Environment:** Windows, Outlook Classic (32-bit), Gmail via IMAP/SMTP.
