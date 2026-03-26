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

## Files in Repository

| File | Purpose |
|------|---------|
| `_config.yml` | Jekyll/Chirpy site configuration |
| `_includes/metadata-hook.html` | All custom CSS + Matrix rain JavaScript |
| `_tabs/about.md` | About page content |
| `_tabs/archives.md` | Archives tab configuration |
| `_tabs/categories.md` | Categories tab configuration |
| `_tabs/tags.md` | Tags tab configuration |
| `_posts/*.md` | 22 blog posts in Markdown |
| `assets/img/avatar.jpg` | Profile photo |
| `.github/workflows/pages-deploy.yml` | GitHub Actions build/deploy workflow |
| `Gemfile` | Ruby gem dependencies |
| `index.html` | Homepage (Chirpy home layout) |
| `README.md` | Repository documentation |
| `CHANGELOG.md` | This file |

---

## Build Date

Initial build completed: **24-25 March 2026**
