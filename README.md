# Joshua Mein — Tech Blog

🌐 **Live:** [joshwaamein.github.io](https://joshwaamein.github.io)

A custom-built Jekyll blog with no external theme — same Matrix-green design language as the [portfolio site](https://joshwaamein.github.io/portfolio-site/).

Every line of HTML, SCSS, and JS lives in this repo (no third-party theme, no Bootstrap, no `!important` wars). Inspired structurally by the portfolio.

## Features

- Vanilla Jekyll 4 with custom layouts/includes/SCSS — no theme dependency
- **Three ways to read the site**, switchable from the header of any page:
  - `/` (the normal blog)
  - `/terminal/` is a shell where posts are files: `ls`, `cd`, `cat`, `grep`, `find`, `tree`
  - `/retro/` is the same content as a 1998 home page, complete with visitor counter
- Matrix-green / GitHub-dark palette + light + WCAG high-contrast a11y mode
- Toggleable Matrix-rain canvas background (respects `prefers-reduced-motion`)
- Header toggles for theme / a11y / rain (no-flash localStorage init)
- Auto-generated TOC for posts with 3+ `<h2>` headings
- Categories index + per-category pages, tag cloud + per-tag pages, year-grouped archive
- Pagination, prev/next post navigation, RSS feed
- GitHub Pages deploy via existing GitHub Actions workflow (Ruby 3.3)

## The three view modes

All three are generated from the same posts at build time. No runtime
fetches, no database, no JavaScript required for the normal site or the
retro page.

| Route | What it is | Needs JS |
|---|---|---|
| `/` | The standard blog | No |
| `/terminal/` | A shell over a virtual filesystem. Posts are files under `~/posts`, and the same posts appear again under `~/categories/<cat>/` and `~/tags/<tag>/` the way hardlinks do. Real path handling (`..`, `-`, `~`, absolute and relative), a cwd-aware prompt, path-aware tab completion, command history, four colour skins, and a boot sequence that plays once per browser | Yes (falls back to a plain post list) |
| `/retro/` | A period-accurate 1998 home page: table layout, beveled borders, rainbow rules, hit counter. Standalone CSS, loads none of the modern stylesheet | No |

The header chip for the third mode is labelled **retro** rather than 1998, so
the switcher names a mode rather than a year.

### Terminal commands

Navigation: `ls [-l] [path]`, `cd <path>`, `pwd`, `tree [path]`.
Reading: `cat <file>...`, `head`/`tail [-n N]`, `less`, `open [file]`.
Searching: `grep [-i] [-l] <string> [path]`, `find [path] -name <glob>`, `wc [-w|-l]`.
System: `stat`, `file`, `du`, `man <cmd>`, `history`, `whoami`, `uname`, `date`,
`env`, `echo`, `which`, `clear`.
Elsewhere: `modern`, `retro`, `skin [name]`, `neofetch`, `exit`.

Two deliberate constraints in the implementation:

- **No user input ever reaches a RegExp.** `grep` matches with `indexOf` and
  `find` walks its glob character by character, so no typed pattern can hang
  the page (ReDoS). Globs support `*` and `?`.
- **Path lookups use `hasOwnProperty`.** A bare `children[name]` lookup would
  resolve inherited members, so `cd constructor` would find something. It
  returns "No such file or directory" instead, and there are tests for it.

`grep` and `du` dedupe by post URL, because a post filed under three
categories appears at three paths; `grep` reports the canonical `~/posts/`
path rather than whichever grouping sorted first.

The terminal deliberately avoids `innerHTML` for anything derived from post
data, and both novelty routes escape every interpolated value: a post title
containing a `<script>` tag renders as visible text rather than executing.
`/retro/` is `noindex` and excluded from the sitemap so it does not compete
with the real content in search results.


## Local development

Requires Docker (recommended) or Ruby 3.3+ with Bundler.

### With Docker (no host pollution)

```bash
make serve     # builds + serves at http://localhost:4000
```

### With local Ruby

```bash
bundle install
bundle exec jekyll serve --livereload
```

## File layout

```
.
├── _config.yml           # site metadata, plugins, permalinks
├── Gemfile               # jekyll + plugins
├── _layouts/             # default, home, page, post, archive, category, tag, terminal
├── _includes/            # head, header, nav, footer, post-card, pagination, toc, view-switch
├── _sass/                # tokens, base, layout, components, post, syntax, terminal
├── _posts/               # 37 blog posts (markdown)
├── _tabs/                # top-nav pages (about, archives, categories, tags)
├── terminal.html         # /terminal/ console route
├── retro.html            # /retro/ 1998 route (self-contained, own CSS)
├── assets/
│   ├── css/main.scss     # imports the SCSS partials
│   ├── js/app.js         # tab/theme/a11y/rain toggles
│   ├── js/terminal.js    # the /terminal/ command loop (vanilla, no deps)
│   ├── js/matrix-rain.js # canvas animation
│   └── img/              # favicon and post images
└── .github/workflows/    # GitHub Pages deployment
```

## Adding a post

```yaml
---
layout: post
title: "Post Title"
date: 2026-05-16
categories: ["Homelab", "DevOps"]
tags: ["linux", "automation"]
description: "One-line summary used for the card excerpt and OG description."
---

Markdown body here…
```

## Licence

Site code: MIT. Content (blog posts, images): © Joshua Mein, CC BY 4.0.

## Support

If this project is useful to you, consider supporting it:

- ☕ [Buy Me a Coffee](https://buymeacoffee.com/joshmein)
- ₿ BTC: `bc1qt4r02qp2w3gt8qfdepg89cmtfaaf6at33qd44r`
- Ξ ETH: `0xdBE0d9a2737cBB627F55c33Ac06AD66743731E15`
- ✕ XRP: `rPgJhTe2prZnrMFoUZ3pJj9MMKLmyDUy65`
