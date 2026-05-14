---
title: "I Built a GNOME Shell Extension for Tailscale — Panel Toggle, Peer Browser, and the Signal-Handler Gotcha That Broke It"
description: "Why GNOME's built-in VPN panel can't drive Tailscale, how I shipped a small GJS extension to fix that across GNOME Shell 48–50, and the signal-handler re-fire bug that made my toggle behave like a one-shot fuse."
date: 2026-05-14 22:00:00 +0100
categories: [Code, Linux]
tags: [tailscale, gnome, linux, javascript, gjs, vpn, automation, networking]
---

I run Tailscale on every machine I own. My homelab is stitched together with it, my laptop joins the tailnet on boot, and at this point I treat `100.64.0.0/10` like it's part of my own LAN. It's brilliant.

What's *not* brilliant is the day-to-day UX on Linux. The CLI is excellent — but it lives in a terminal. GNOME's built-in **VPN** panel applet doesn't speak Tailscale's control protocol, so all the things I actually click on (toggle, exit node, copy a peer's IP, check who's online) live behind `tailscale` subcommands. Every time I needed a peer's IPv4 I'd open a terminal, type `tailscale status`, scroll, and copy. Every time.

So I built the small thing that should have always existed: a GNOME Shell panel indicator that wraps the bits of the Tailscale CLI you actually click on, without changing your daemon configuration unless you explicitly ask it to.

It's called [`gnome-tailscale`](https://github.com/Joshwaamein/gnome-tailscale), it ships for GNOME Shell **48, 49, and 50**, and it has roughly one bug I'm still slightly embarrassed about. Here's the writeup.

---

## The Setup

- A laptop running Ubuntu 24.04 (GNOME Shell 46 → 48 after upgrade)
- A desktop running Fedora 40 (GNOME Shell 48)
- A future-me on Ubuntu 26.04 "Resolute Raccoon" (GNOME Shell 50)
- Tailscale CLI installed everywhere, `tailscaled` always running

The goal: a **panel indicator** that reflects daemon state, lets me toggle the daemon, lists my tailnet, copies peer IPs on click, picks an exit node from a submenu, and surfaces actionable error messages — no terminal required.

## Why I Couldn't Reuse Anything Existing

Before writing a line of GJS, I went through the usual dead ends:

1. **GNOME's built-in VPN panel.** It speaks NetworkManager. Tailscale is a userland mesh — it doesn't expose itself as an `NM` connection. Dead end.
2. **The "Tailscale Status" extensions on extensions.gnome.org.** Most are stuck on GNOME Shell 42–45 (the old `imports.*` CommonJS world). Shell 48 is fully ESM (`import` / `export`), and the old-API extensions are not loadable at all on Shell 48+. Re-skinning a 3-year-old codebase to ESM was going to take longer than starting fresh.
3. **A standalone tray app via Ayatana AppIndicator.** Works, but doesn't blend into the panel and breaks every time GNOME twitches its mind about tray icons.
4. **A bash script bound to a keyboard shortcut.** Toggle works, but there's nowhere to *show* the peer list.

The only sensible option was a native shell extension targeted at the **GJS ESM era** — Shell 48, 49, and 50.

---

## The Architecture

I wanted the extension to be small and testable. GJS is fun until you try to unit-test it; the runtime is bound to GNOME Shell, so anything that touches `St`, `Clutter`, or `Gio` won't run under plain Node.

So I split the codebase three ways:

| File | Runtime | What's in it |
|------|---------|--------------|
| `extension.js` | GJS | The panel indicator — `St` widgets, menu items, the polling loop. |
| `prefs.js` | GJS (Adwaita) | The preferences window. |
| `lib/util.js` | **Pure JS** | Formatting, sorting, argv builders, error classification. |

`lib/util.js` is the trick. Anything that's pure logic — parsing `tailscale status --json`, sorting peers, working out which `tailscale` argv to spawn for a given preference combination, classifying error output into one of about eight known categories — lives there with **zero GJS imports**. It's runnable under Node's built-in test runner, which means CI can lint and test the extension without ever touching a real GNOME Shell.

```bash
make test       # runs node --test on tests/*
make lint       # eslint on the whole tree
make schema     # compiles the GSettings schema
make ci         # everything CI runs
make pack       # builds the release zip
```

The whole thing is < 2,000 lines including tests.

---

## The "Don't Touch My Daemon" Principle

The single most important design decision: **toggling the panel switch does not change your daemon configuration**. Ever. By default, the toggle runs `tailscale up` and *that's it*. It does not push `--accept-routes`, it does not push `--accept-dns`, it does not run `tailscale set` for anything.

Why that matters: if you've spent an evening tuning your `tailscaled` flags exactly the way you like them, the last thing you want is a friendly little panel applet quietly overwriting them every time you click it. I've been bitten by exactly that on other VPN GUIs.

There's a single switch in prefs called *Override accept-routes / accept-dns on connect*. It's **off by default**. Turn it on if you want the panel to actively manage those flags via `tailscale set` after each `up`. Otherwise the panel is purely an *observer plus toggle*.

The privileged-command path is similar:

| Setting | Default | Behaviour |
|---|---|---|
| Use pkexec for up/down | **on** | Privileged `tailscale up`/`down` go through a polkit dialog. |
| Use pkexec for up/down | off | Assumes you've run `sudo tailscale set --operator=$USER` and `tailscale` runs without sudo. |

The prefs window literally tells you the two recipes (Option A: `--operator`, Option B: a sudoers alias) and explains that Option B is a terminal-only convenience and won't help the panel toggle. Trying to be a polite citizen of someone else's machine.

---

## The Polling Loop

`tailscale status --json` is the source of truth. The extension polls it every 5 seconds (configurable) and rebuilds the menu from scratch each tick. Nothing about the peer list or exit-node list is hardcoded — every menu item exists because it appeared in the most recent JSON.

```javascript
// extension.js (simplified)
async _tick() {
    let proc;
    try {
        proc = Gio.Subprocess.new(
            ['tailscale', 'status', '--json'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch (e) {
        return this._showError(classifyError(e));
    }

    const [, stdout, stderr] = await proc.communicate_utf8_async(null, null);
    if (!proc.get_successful()) {
        return this._showError(classifyError(stderr));
    }

    const status = JSON.parse(stdout);
    this._render(status);   // pure: status -> menu items
}
```

`classifyError` lives in `lib/util.js` and is unit-tested. It maps stderr blobs onto a small enum:

```javascript
// lib/util.js
export function classifyError(stderr) {
    if (/command not found|ENOENT/.test(stderr))   return 'CLI_MISSING';
    if (/not running|connection refused/i.test(stderr)) return 'DAEMON_DOWN';
    if (/Logged out|please run.*tailscale up/i.test(stderr)) return 'LOGGED_OUT';
    if (/Authentication cancelled|polkit/i.test(stderr)) return 'PKEXEC_CANCELLED';
    if (/permission denied|operator/i.test(stderr)) return 'NO_OPERATOR';
    return 'UNKNOWN';
}
```

That enum drives both the user-facing notification copy *and* a *Copy error details* item in the menu, so when something does go sideways you can paste the raw stderr into a bug report instead of squinting at a vague "something went wrong".

---

## The Bug That Took Me a Whole Evening

Here's the embarrassing one. Early users (i.e. me) reported:

> The toggle works the **first** time. After that, clicking it does nothing.

The toggle is a `PopupSwitchMenuItem`. Naively, you connect to its `'toggled'` signal and call `tailscale up` or `tailscale down` accordingly:

```javascript
// THE BUG
this._toggleItem.connect('toggled', (item, active) => {
    if (active) this._tailscaleUp();
    else        this._tailscaleDown();
});
```

Then every poll, you reflect the *real* daemon state back onto the switch:

```javascript
// THE BUG, continued
_render(status) {
    this._toggleItem.setToggleState(status.BackendState === 'Running');
    // ...
}
```

Spot it? `setToggleState()` **fires the `toggled` signal**. So:

1. User clicks the switch → `'toggled'` fires with `active=true` → `tailscale up` runs.
2. Five seconds later, poll completes, `setToggleState(true)` is called.
3. `setToggleState(true)` fires `'toggled'` *again* with `active=true`.
4. `tailscale up` runs *again* — harmless because the daemon is already up.
5. User clicks the switch *off* → `'toggled'` fires with `active=false` → `tailscale down` runs.
6. Five seconds later, poll completes, `setToggleState(false)` is called.
7. `setToggleState(false)` fires `'toggled'` again with `active=false`.
8. `tailscale down` runs *again*. Daemon is already down. Still harmless.
9. User clicks the switch *on* → `'toggled'` fires with `active=true`...

...except by step 9, the recursive `'toggled'` from step 7 has *also* fired, and the user-initiated state change races against the programmatic one. Depending on which finishes first, the switch can end up visually *off* while my handler genuinely thought the user wanted it *on*. From the user's perspective: clicking does nothing.

The fix is one line, sort of:

```javascript
// THE FIX (extension.js)
this._toggleHandlerId = this._toggleItem.connect('toggled', (_, active) => {
    if (active) this._tailscaleUp();
    else        this._tailscaleDown();
});

_render(status) {
    // Block the handler while we mirror daemon state onto the switch,
    // so the programmatic update doesn't re-fire 'toggled'.
    this._toggleItem.block_signal_handler(this._toggleHandlerId);
    try {
        this._toggleItem.setToggleState(status.BackendState === 'Running');
    } finally {
        this._toggleItem.unblock_signal_handler(this._toggleHandlerId);
    }
    // ...
}
```

`block_signal_handler` / `unblock_signal_handler` are GObject's standard "shut up for a moment" pair. The `try/finally` is non-negotiable: if `setToggleState` ever throws, an unblocked handler is required for the *next* poll to recover, otherwise the switch goes dead permanently.

This is the kind of bug that doesn't show up in unit tests because the unit tests can't import `St`. It only shows up when a real human clicks the switch on a real GNOME Shell. Lesson learned: when in doubt, **block the handler before mirroring state**.

The fix shipped in 0.2.0. There's even a row in the troubleshooting table for it, because I wanted future-me to be able to find it.

---

## What Made It Onto the Panel

After a few iterations, the menu settled into this shape:

| Section | What it shows |
|---------|---------------|
| **Self** | This machine's hostname, MagicDNS short name, OS, online dot. Click copies its Tailscale IPv4. |
| **Toggle** | A `PopupSwitchMenuItem` that runs `tailscale up`/`down` (via pkexec by default). |
| **Exit Node ▸** | Every peer reported with `--advertise-exit-node`, with a green/grey dot, OS in plain text. Plus a *None* row to clear. |
| **Peers ▸** | All peers from `tailscale status --json` — dot, name, OS, primary IPv4, tags (`exit`, `active`). Click copies IPv4 (or MagicDNS name — configurable). |
| **Quick links** | Admin console, manual refresh, preferences. |
| **Errors** | When something goes wrong, a notification + a *Copy error details* item on the menu. Errors are also written to `journalctl` with a `[tailscale]` prefix. |

The panel icon flips between connected/disconnected glyphs based on `BackendState`. That's it. No popups, no modal dialogs, no surprise reconfigurations. The whole thing is < 2,000 lines including tests.

---

## Gotchas I Hit Along the Way

A few things that were less obvious than they should have been:

### 1. Symlink installs will eat your source tree

`gnome-extensions install` copies your zip into `~/.local/share/gnome-shell/extensions/`. If you symlink your dev tree there instead (which I do, via `make link`), and then you click *Uninstall* in the GNOME Extensions app — **GNOME deletes the contents of the symlink target**. That is to say: your source tree.

I've put a comically aggressive warning in the README and `make link` itself prints a reminder. There's also a `make uninstall` that does the right thing (remove the symlink, not the target).

### 2. Shell 48 is ESM. Shell 45 is not.

If you're porting an old extension, `imports.misc.extensionUtils` is gone. `Main.panel.addToStatusArea` is still there. `St`/`Clutter`/`Gio` you import from `gi://`. The `Extension` base class has lifecycle methods (`enable`, `disable`) that you actually have to implement properly because nothing magic happens for you. The migration is mechanical but tedious.

### 3. `Gio.Subprocess` is your friend

The naive way to spawn `tailscale` is `GLib.spawn_command_line_sync`. **Don't.** It blocks the shell — and "the shell" here is *literal* GNOME Shell, the thing rendering your entire desktop. A 200ms hang in `tailscale status` becomes a 200ms freeze of every window animation on your screen. Use `Gio.Subprocess` with `communicate_utf8_async`, `await` the promise, and never block.

### 4. Adwaita prefs windows are easier than you'd think

GNOME 42+ extensions can use full Adwaita widgets in `prefs.js`. `AdwPreferencesPage` + `AdwPreferencesGroup` + `AdwActionRow`/`AdwSwitchRow`/`AdwSpinRow` give you a prefs UI that looks identical to GNOME Settings. Hooking each row up to a `Gio.Settings` instance is a one-liner per setting (`settings.bind('key', row, 'active', Gio.SettingsBindFlags.DEFAULT)`).

---

## Releasing It

The release pipeline is just a Makefile target and a GitHub Actions workflow:

```bash
make pack       # produces dist/tailscale@Joshwaamein.github.io.shell-extension.zip
```

`make pack` runs `make ci` first (lint + tests + schema compile), then bundles the extension into the zip layout that `gnome-extensions install --force <zip>` accepts. CI uploads the zip as a release asset on every tag. Anyone can install with:

```bash
gnome-extensions install --force tailscale@Joshwaamein.github.io.shell-extension.zip
gnome-extensions enable tailscale@Joshwaamein.github.io
```

Wayland users have to log out and back in once, because Shell can't hot-load a new extension on Wayland. X11 users can press `Alt+F2`, type `r`, and hit Enter — old-school, but it still works.

---

## What I'd Do Differently

A few things I'd change if starting again:

- **Bind state with a tiny store.** I rebuild the entire menu on every poll. That's fine at 5-second intervals and a dozen peers, but it does mean you sometimes see a flash if you're hovering an item exactly when the poll completes. A diff-based renderer (or just remembering which submenu was open and reopening it after rebuild) would be nicer.
- **Cache `tailscale --version` once at startup**, not on every error path. I currently shell out to it whenever I want to render a "your CLI is too old" hint, which is wasteful.
- **Push releases to extensions.gnome.org.** Right now you install from the GitHub release zip. e.g.o. has a review process I haven't bothered with yet.

---

## The Result

I haven't typed `tailscale status` in a terminal for weeks. Toggling the daemon is a click. Copying a peer's IPv4 is a click. Picking an exit node when I'm on hotel Wi-Fi is two clicks. None of it changes my daemon configuration unless I've explicitly opted in. And when something does go wrong — daemon down, CLI missing, login expired — the panel tells me what specifically is broken instead of vaguely failing.

It's open source, GPL-2.0-or-later (same family as GNOME Shell itself), and lives at [github.com/Joshwaamein/gnome-tailscale](https://github.com/Joshwaamein/gnome-tailscale). PRs welcome — there's a [`CONTRIBUTING.md`](https://github.com/Joshwaamein/gnome-tailscale/blob/main/CONTRIBUTING.md) and the `lib/util.js` split means new logic comes with tests.

Sometimes the tool you want is a 2,000-line Saturday project away.
