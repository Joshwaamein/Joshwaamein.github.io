---
title: "I Completely Overhauled My Discord Music Bot — Slash Commands, Spotify Radio, and 70 Tests"
description: "How I took an abandoned MusicBot fork and modernised it with 48 slash commands, a Spotify-powered radio feature, Docker support, systemd hardening, input validation, and a full test suite. 3,640 lines added across 21 commits."
date: 2026-03-19 12:00:00 +0000
categories: [Homelab, Code]
tags: [discord, python, docker, spotify, systemd, linux]
---

I've been running [Just-Some-Bots/MusicBot](https://github.com/Just-Some-Bots/MusicBot) as my Discord server's music bot for a while. It works — mostly. But it's showing its age. The upstream repo hasn't had a meaningful update in months, it still uses text prefix commands (which Discord has been deprecating in favour of slash commands), the Docker image is built on Python 3.8 Alpine, and there's no test suite whatsoever.

So I forked it, and over the course of a few days I essentially rewrote the user-facing layer. 21 commits, 33 files changed, 3,640 lines added. Here's everything that changed.

## The Big One: Full Slash Command Migration

Discord has been pushing slash commands hard — they're the native way to interact with bots now. The original MusicBot used text prefix commands (`!play`, `!skip`, etc.) which still work but feel dated and don't get autocomplete, parameter hints, or the nice inline UI.

I migrated **all 48 commands** to Discord's slash command system, built in six phases:

**Phase 1 — Core Music (16 commands):**
`/play`, `/playnext`, `/skip`, `/pause`, `/resume`, `/queue`, `/np`, `/volume`, `/summon`, `/disconnect`, `/shuffle`, `/clear`, `/repeat`, `/seek`, `/speed`, `/help`

**Phase 2 — Fixes & Expansion:**
Fixed the `CommandTree` integration (the original bot uses `discord.Client`, not `discord.ext.commands.Bot`, so the standard Cog pattern doesn't work), added `FakeMessage` objects to bridge slash interactions to the existing command methods, and added 6 missing commands.

**Phase 3 — Playlist & Config (8 commands):**
`/autoplaylist`, `/resetplaylist`, `/karaoke`, `/follow`, `/setprefix`, `/setnick`, `/perms`, `/id`

**Phase 4 — Moderation (5 commands):**
`/blockuser`, `/blocksong`, `/clean`, `/pldump`, `/listids`

**Phase 5 — Admin (10 commands):**
`/config`, `/setperms`, `/option`, `/cache`, `/setname`, `/setavatar`, `/joinserver`, `/leaveserver`, `/restart`, `/reboot`

Admin commands use `@has_permissions(administrator=True)` instead of the upstream's owner-only restriction, which makes much more sense for a multi-server bot.

**Phase 6 — Info (4 commands):**
`/uptime`, `/latency`, `/botlatency`, `/botversion`

The whole implementation lives in `musicbot/cogs/music.py` — about 1,850 lines. Every command is `guild_only` and includes proper permission checks. The text prefix commands still work alongside the slash commands, so nothing breaks for existing users.

### The FakeMessage Pattern

The trickiest part was bridging slash command interactions to the existing `cmd_*` methods. Those methods expect a `discord.Message` object with specific attributes (`author`, `channel`, `guild`, etc.). Slash commands give you an `Interaction` instead.

The solution was a `_FakeMessage` class that wraps the interaction and exposes the attributes the command methods expect. It's not elegant, but it means I didn't have to rewrite every single command handler — just the interface layer.

## Spotify Radio

This is the feature I'm most pleased with. `/radio` creates an endless radio station seeded from any song or artist:

```
/radio seed:Daft Punk - Get Lucky
/radio seed:The Weeknd
/radio seed:https://open.spotify.com/track/2dpaYNEQHiRxtZbfNsse99
/radio action:Stop
```

How it works:
1. You provide a seed — a song name, artist, or Spotify URL
2. The bot plays your requested song first
3. It discovers similar music using Spotify's API — curated "Artist Radio" playlists, genre-based search, artist top tracks, and album deep cuts
4. When the queue drops to 3 or fewer songs, it automatically fetches more
5. Stop anytime with `/radio action:Stop` or `/clear`

The Spotify integration (`musicbot/spotify.py`, 228 lines) handles OAuth token management, playlist/album/track parsing, and search. It's not using Spotify's recommendations API (which requires a premium app) — instead it gets creative with playlist search and artist catalogs, which works surprisingly well for discovery.

## Input Validation

Every user-facing slash command now validates and sanitises input:

- **Song queries:** max 500 characters, whitespace stripped
- **URLs** (`/stream`): must start with `http://`, `https://`, or `spotify:`, max 2,000 characters
- **Search queries:** max 200 characters
- **Seek time:** regex validates format (`1:30`, `90`, `+30`, `-15`)
- **Speed rate:** validated range 0.5–100.0

This prevents a whole class of abuse — people pasting enormous strings, injecting weird URLs, or sending malformed seek times that would crash the player.

```python
SEEK_PATTERN = _re.compile(r"^[+-]?(\d{1,2}:)?\d{1,4}(:\d{2})?$")

def _validate_song_input(song: str) -> str:
    song = song.strip()
    if not song:
        raise ValueError("Song query cannot be empty.")
    if len(song) > MAX_SONG_QUERY_LEN:
        raise ValueError(f"Song query too long (max {MAX_SONG_QUERY_LEN} chars).")
    return song
```

## Docker Overhaul

The upstream Dockerfile was built on `python:3.8-alpine`. Python 3.8 hit end-of-life in October 2024, and Alpine causes issues with some Python packages that need glibc.

The new Dockerfile uses `python:3.10-slim` with proper apt dependencies:

```dockerfile
FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libopus0 \
    libsodium23 \
    libffi-dev \
    git \
    gcc \
    && rm -rf /var/lib/apt/lists/*
```

I also fixed the entrypoint script — it was using bash `[[ ]]` syntax which doesn't work on Alpine's `sh`. Switched to POSIX `[ ]` for compatibility. And the docker-compose example now includes `restart: unless-stopped`.

## systemd Hardening

The bot runs as a systemd service on my server. The original service file was basic. I hardened it:

- **`Restart=always`** — the bot restarts automatically on any exit
- **`KillMode=control-group`** — ensures all child processes (ffmpeg, yt-dlp) are killed on stop, not just the main Python process
- Removed the `/shutdown` command entirely — it's meaningless when systemd will just restart the bot immediately
- The `respawn_bot_process()` function now detects systemd (via `INVOCATION_ID` env var) and uses `sys.exit(0)` instead of `os.execlp()`, letting systemd handle the restart cycle properly

This fixed a nasty bug where the old restart mechanism would `execlp()` a new process while the original systemd-tracked process was still considered "running" — leading to duplicate bot instances fighting over the same Discord token.

## Python Virtual Environment for Ubuntu 24.04

The bot server was upgraded from Ubuntu 22.04 to 24.04, which brought Python 3.12. The problem: Python 3.12 enforces [PEP 668](https://peps.python.org/pep-0668/) — it blocks `pip install` outside of a virtual environment with an "externally-managed-environment" error. The systemd service was using `/usr/bin/python3` directly, so all the bot's dependencies (`aiohttp`, `discord.py`, `yt-dlp`, etc.) couldn't be installed and the service was crash-looping on startup with `ModuleNotFoundError`.

The fix was straightforward:

```bash
# Create a venv inside the bot directory
python3 -m venv /home/discord-bot/MusicBot/venv

# Install all dependencies into it
/home/discord-bot/MusicBot/venv/bin/pip install -r requirements.txt

# Update the systemd service to use the venv Python
ExecStart=/home/discord-bot/MusicBot/venv/bin/python3 /home/discord-bot/MusicBot/run.py
```

After reloading systemd and starting the service, the bot came back online and synced all 48 slash commands. This is the correct way to deploy Python applications on modern Ubuntu — system Python is for system tools, venvs are for everything else.

## Test Suite

The upstream had zero tests. I added **70 pytest tests** across 5 test files:

| File | Tests | Coverage |
|------|-------|----------|
| `test_fake_message.py` | 13 | FakeMessage attributes, no-op methods, edge cases |
| `test_send_response.py` | 7 | None input, text/embed/config response handling |
| `test_bot_init.py` | 5 | CommandTree creation, setup_hook, sync guard |
| `test_slash_commands.py` | 11 | Registration of all commands, descriptions, parameters, guild_only |
| `test_regression.py` | 34 | No `create=True` in cog (voice bug), validation functions, command registration |

The regression tests are particularly important — they catch the `create=True` bug where slash commands were calling `get_player(create=True)` which would silently create a voice connection in a way that bypassed the proper summon flow, leading to the bot joining empty channels or failing to join at all.

## Codebase Cleanup

I removed a lot of accumulated cruft:

**Deleted files:**
- `.travis.yml` — upstream CI that nobody was using
- `.pre-commit-config.yaml` — not active
- `musicbot.service.example` — replaced by the real deployed service
- `.github/` templates — upstream issue/PR templates irrelevant to the fork

**Dead code removed:**
- Unused `import os` and `Union` import from `music.py`
- `_check_perms()` function that was defined but never called anywhere
- Tests that covered the dead code

**References fixed:**
- Embed footers now show `Joshwaamein/MusicBot` instead of the upstream repo
- `cmd_botversion` URL points to the fork
- All scripts have header comments with attribution and usage instructions

## The Numbers

| Metric | Value |
|--------|-------|
| Commits | 21 |
| Files changed | 33 |
| Lines added | 3,640 |
| Lines removed | 261 |
| Slash commands | 48 |
| Tests | 70 |
| New features | Spotify Radio, input validation, /restart, /reboot |

## What's Next

The bot is running in production on my server now with all of these changes. One thing I still want to tackle:

- **Spotify recommendations API** — if I can get access, this would make the radio feature much better than the current playlist/search approach

The fork is public at [Joshwaamein/MusicBot](https://github.com/Joshwaamein/MusicBot) if you want to use it or contribute.
