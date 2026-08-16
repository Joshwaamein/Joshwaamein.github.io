# Changelog — Blog Build & Customisation

This document records everything done during the initial build and customisation of joshwaamein.github.io.

---

## Phase 1: WordPress → GitHub Pages Migration

1. **Scraped all 20 blog posts** from joshuamein.wordpress.com via RSS feed (2 paginated pages)
2. **Built a Node.js conversion script** (`convert.js`) that parsed RSS XML, converted HTML to Markdown, generated Jekyll front matter (title, date, categories, description), handled WordPress syntaxhighlighter blocks and YouTube embeds, and separated the "About" post into a standalone page
3. **Created the Jekyll site** with Minima theme: `_config.yml`, `Gemfile`, `index.md`, `about.md`, `.gitignore`, `README.md`
4. **Created GitHub repo** `Joshwaamein.github.io` via `gh repo create`
5. **Enabled GitHub Pages** via API — initially legacy build, then switched to GitHub Actions workflow
6. **Fixed initial issues**: Added missing `jekyll-paginate` plugin (was causing empty homepage), fixed YouTube include errors

---

## Phase 2: Chirpy Theme Migration

1. **Backed up all posts** before migration
2. **Switched from Minima to Chirpy** (jekyll-theme-chirpy ~7.2):
   - New `_config.yml` with Chirpy settings (dark mode, avatar, social links)
   - New `Gemfile` with Chirpy gem and plugins (feed, seo-tag, sitemap, archives, paginate)
   - Created `_tabs/` directory with about, archives, categories, and tags pages
   - Created GitHub Actions workflow (`.github/workflows/pages-deploy.yml`) using Ruby 3.3
3. **Fixed YouTube embed** — replaced `{% include youtube.html %}` with inline iframe wrapped in `{% raw %}` tags
4. **Configured GitHub Pages** for workflow-based deployment via GitHub API

---

## Phase 3: Theme Customisation — Matrix Style

### Colour Scheme Evolution:
1. **Initial attempt** — All text green everywhere (too much, hard to read)
2. **Reduced scope** — Green sidebar only, Chirpy defaults elsewhere
3. **Body text fix** — Changed from green to light grey (#c9d1d9) for readability
4. **Syntax highlighting** — Added GitHub Dark-style Rouge overrides for code blocks
5. **Final colour scheme** — Grey default (#c9d1d9) → Green hover (#00ff41) everywhere

### Matrix Rain Animation:
1. First deployed as background canvas (z-index: -1) — invisible behind opaque backgrounds
2. Changed to z-index: 0 with transparent main-wrapper — still invisible
3. Changed to overlay (z-index: 9998) — visible but too distracting on content
4. **Final implementation**: Background (z-index: 0, opacity: 0.12) — subtle atmosphere showing through transparent content areas
5. Characters: Katakana (ア-ン) + digits + uppercase letters, 14px monospace, 60ms interval
6. Brightness varies randomly between `#008f11`, `#00ff41`, `#39ff14`

### Blue/Orange Removal (multiple rounds):
1. **Round 1**: Overrode Bootstrap CSS variables (`--bs-link-color`, `--bs-primary`, etc.)
2. **Round 2**: Added `.btn-outline-primary` state overrides for all pseudo-classes
3. **Round 3**: Added `.post-tag`, `.page-link`, `.page-item.active` overrides
4. **Round 4**: Added right panel tags, archive links, sidebar bottom links
5. **Round 5 (final)**: Found and matched EXACT Chirpy compiled CSS selectors:
   - Orange `#d2603a !important` on `.content a:not(.img-link):hover`, `#page-tag a:hover`, `footer a:hover`, etc.
   - Blue `#007bff !important` on `.btn.btn-outline-primary:not(.disabled):hover`
   - Overrode all with `#00ff41` (Matrix green)

### Custom File: `_includes/metadata-hook.html`
Single file containing ALL customisations:
- CSS variables overriding Bootstrap/Chirpy accent colours
- Sidebar green Matrix theme (gradient background, Fira Code font, glow effects)
- Grey default / green hover for all links, buttons, tags, TOC, pagination
- Exact Chirpy selector overrides for orange/blue elimination
- Matrix rain canvas JavaScript animation
- Avatar zoom-out CSS
- Fira Code font import (sidebar only)

---

## Phase 4: Content Improvements

### Blog Post Quality Improvements:
- **Read all 20 posts** using parallel subagents for efficiency
- **Created improvement plan** documenting issues per post (grammar, structure, missing content)
- **Improved 19 posts** across 3 parallel batches:
  - Fixed grammar/spelling across all posts ("thier"→"their", "imporant"→"important", "wnated"→"wanted", "havent"→"haven't", "Idiots"→"Idiot's", etc.)
  - Added casual intro paragraphs to every post (matching "Building, Breaking & Automating Things" tone)
  - Added conclusions with "Cheers 🍻" sign-off to every post
  - Fixed heading hierarchy (## for sections, ### for subsections)
  - Expanded thin content (SD card tips with actual commands, Ansible plan with proper sections)
  - Removed broken Brave search image URLs from Homelab Ideas post
  - Fixed SQL code blocks with stuck-together words
  - Fixed `sudo apt update && apt upgrade` → `sudo apt update && sudo apt upgrade`

### Code Block Language Hints:
- **Built auto-detection script** (`fix-code-langs.js`) with pattern matching for bash, python, yaml, sql, json, cpp, text
- **Applied to 69 code blocks** across 10 posts, enabling proper syntax highlighting

### New Blog Posts Published:
1. **"Debugging OpenWebUI + AWS Bedrock: A Deep Dive into Model Not Found Failures"** — Date: 2026-03-23, Categories: Cloud/DevOps, Tags: docker/aws/bedrock/openwebui/python/debugging
2. **"Bulletproofing a Remote Raspberry Pi for Maximum Uptime"** — Date: 2026-02-24, Categories: Homelab, Tags: raspberry-pi/linux/unifi/reliability/networking
3. **"Why I Switched From Gmail to Brevo for All My Homelab Email Alerts"** — Date: 2026-03-24, Categories: Homelab/DevOps

### Taxonomy Standardisation:
- **6 categories**: Homelab (11 posts), DevOps (8), Cloud (4), Networking (5), Security (3), Code (4)
- **Cleaned tags**: Removed redundant tags (e.g. "oracle" from SQL, "devops" tag on DevOps category), standardised to 3-6 lowercase hyphenated tags per post, added new relevant tags (self-hosting, wifi, zram, memory, iot)

---

## Phase 5: Site Configuration

### Profile:
- **Title**: Joshua Mein
- **Tagline**: "Building, Breaking & Automating Things"
- **Avatar**: Custom photo from `Downloads/photoofme.jpg` → `assets/img/avatar.jpg`, with CSS zoom-out (scale 0.8, object-position center 20%)
- **About page**: Rewritten in casual personal style with emoji sections, highlighted keywords, tech stack list

### Technical Configuration:
- **Theme**: jekyll-theme-chirpy ~7.2
- **Theme mode**: Dark (forced)
- **Pagination**: 10 posts per page
- **TOC**: Enabled on all posts
- **Social links**: GitHub (Joshwaamein) + LinkedIn (joshuamein)
- **Timezone**: Europe/London
- **Build**: GitHub Actions with Ruby 3.3, auto-deploys on push to main

---

## Phase 6: Three View Modes (Terminal and 1998 Retro)

Added two alternative presentations of the same content, plus a switcher
to move between them. All three are generated from the same posts at build
time: no runtime fetches, no database, no duplicated content.

### `/terminal/`: a console for the blog

A keyboard-driven route styled on the existing Matrix-green palette.
Vanilla JS in the same idiom as `app.js` (IIFE, `var`, no arrow functions,
no build step, no dependencies).

**Commands:** `help`, `about`, `posts` (alias `ls`), `open <n>`,
`cat <n|slug>`, `grep <term>`, `neofetch`, `skin <name>`, `whoami`,
`sudo`, `clear`, `retro`, `modern`, `exit`.

**Features:** command history (up/down, preserves a half-typed draft), tab
completion for commands, post slugs and skin names, "did you mean"
suggestions via Levenshtein distance, a boot sequence that plays once per
browser, allowlisted `?cmd=` deep links, four colour skins
(matrix/amber/paper/netscape) persisted to `localStorage`, and tap buttons
so it is usable without a keyboard.

**Post data** is embedded as JSON at build time rather than fetched, so it
cannot go stale and needs no extra request. Titles, dates, slugs and
90-word excerpts, roughly 31 KB for 37 posts. `grep` searches that same
data, so full-text search costs 158 bytes of page weight.

**Degrades:** `<noscript>` renders a plain linked list of every post, so
the route is still usable with JavaScript disabled.

### `/retro/`: the blog as it would have looked in 1998

Table layout, `3px ridge` borders, Times New Roman, rainbow `<hr>` bars,
colour-cycling status strip, hazard-tape "under construction" banner,
four individually coloured sidebar boxes, six mismatched 88x31-style
badges, a fictional web ring, and a green-on-black hit counter.

Deliberately **standalone**: it loads none of the site's SCSS. The modern
stylesheet sets Inter, link glows, transitions and rounded corners on
`a`/`table`/`hr`/`body`, all of which a 1998 page needs the opposite of, so
overriding them would have been more code than not loading them. Keeping
them separate also means this page cannot regress the real site.

No images were added: the tiled background, hazard tape and rainbow rules
are all CSS gradients.

`noindex` + `sitemap: false`, so a joke page does not compete with real
content in search. A footer line states plainly that the counter and the
web ring are decorative.

### View switching

- `_includes/view-switch.html` renders the three-way switcher and is
  shared by the modern and terminal routes, so the set of modes is defined
  once. The current mode renders as a non-link with `aria-current`.
- Chips appear in the site header beside the existing theme/a11y/rain
  buttons, styled to match `.icon-btn`.
- `/retro/` hand-rolls a period-styled equivalent, since it loads no site
  CSS.
- Footer rewritten from a centre-dot link chain into a sentence.
- Terminal gains `modern` and `retro` commands so the views are reachable
  by typing.

### Security and accessibility

- **No `innerHTML` for post-derived data** in `terminal.js`; every line is
  built with `textContent`/`createTextNode`.
- Both novelty routes escape all interpolated values. This was found the
  hard way: `| jsonify` alone does **not** escape `</script>`, so a post
  titled `foo </script><img onerror=...>` terminated the JSON block and
  injected live HTML. Fixed by escaping `<` to `\u003c` in the data block
  and `| escape` on every HTML context, then re-verified with probe posts
  carrying hostile titles and category names.
- `hasOwnProperty` guards on all command/alias lookups, so typing
  `constructor` cannot resolve an inherited `Object` member.
- `grep` uses `indexOf`, not a `RegExp` built from user input, so there is
  no catastrophic-backtracking surface.
- Deep links are allowlisted against the real command table and never
  `eval`'d; `?cmd=rm -rf /`, `?cmd=eval(1)` and path traversal are ignored.
- Every animation (caret blink, boot sequence, colour cycling, 90s blink)
  is gated behind `prefers-reduced-motion`.
- `role="log"` + `aria-live` on terminal output, a visually hidden label
  on the input, and a11y mode honoured throughout.

### Testing

A headless DOM harness exercises the terminal without a browser: **79
assertions**, covering every command, bad input, aliases, history,
completion, deep links, skins, the XSS cases and the prototype-pollution
guards. Kept outside the repo so it does not ship.

Also verified per build: all routes 200, post-count parity between the
embedded JSON, the `<noscript>` list and `_posts/`, `node --check` on all
JS, and a built-site diff to confirm only the intended files were added.

---

## Files in Repository


| File | Purpose |
|------|---------|
| `_config.yml` | Jekyll/Chirpy site configuration |
| `_includes/metadata-hook.html` | All custom CSS + Matrix rain JavaScript |
| `_tabs/about.md` | About page content |
| `_tabs/archives.md` | Archives tab configuration |
| `_tabs/categories.md` | Categories tab configuration |
| `_tabs/tags.md` | Tags tab configuration |
| `_posts/*.md` | 37 blog posts in Markdown |
| `assets/img/avatar.jpg` | Profile photo |
| `.github/workflows/pages-deploy.yml` | GitHub Actions build/deploy workflow |
| `terminal.html` | `/terminal/` console route (embedded post JSON + noscript fallback) |
| `retro.html` | `/retro/` 1998 route, self-contained CSS |
| `_layouts/terminal.html` | Full-bleed layout for the console route |
| `_includes/view-switch.html` | Shared modern/terminal/1998 switcher |
| `_sass/_terminal.scss` | Console styling + the four colour skins |
| `assets/js/terminal.js` | Terminal command loop (vanilla, no deps) |
| `Gemfile` | Ruby gem dependencies |
| `index.html` | Homepage (Chirpy home layout) |
| `README.md` | Repository documentation |
| `CHANGELOG.md` | This file |

---

## Build Date

Initial build completed: **24-25 March 2026**

Rebuilt from scratch as a custom Jekyll theme: **May 2026**

Three view modes (terminal + 1998 retro) added: **16 August 2026**
