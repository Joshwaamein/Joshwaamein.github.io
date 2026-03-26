# Joshua Mein — Tech Blog

🌐 **Live:** [joshwaamein.github.io](https://joshwaamein.github.io)

A tech blog covering homelabs, DevOps, cloud computing, networking, security, and IoT — built with Jekyll and the Chirpy theme, customised with a Matrix-inspired design.

---

## 🎨 Theme Customisations

All custom styling is in **`_includes/metadata-hook.html`** — Chirpy's extension point for injecting custom CSS and JS into the `<head>`.

### Colour Scheme

| Element | Default State | Hover/Active State |
|---------|--------------|-------------------|
| Body text | Chirpy default (grey/white) | — |
| Links | `#c9d1d9` (light grey) | `#00ff41` (Matrix green) |
| Buttons/Tags | `#c9d1d9` border `#30363d` | `#00ff41` with green glow bg |
| TOC active | — | `#00ff41` |
| Sidebar nav | `#008f11` (dark green) | `#00ff41` (bright green) |
| Sidebar title | `#00ff41` with glow | — |
| Sidebar subtitle | `#00cc33` | — |

### Sidebar

- **Background:** Black-to-dark-green gradient (`#000000` → `#001a00`)
- **Font:** Fira Code monospace (loaded via Google Fonts)
- **Site title:** Neon green (`#00ff41`) with text-shadow glow
- **Nav links:** Dark green default, bright green on hover/active with glow

### Matrix Rain Animation

A JavaScript canvas animation renders falling Matrix-style characters (katakana + alphanumeric) behind all content.

- **Position:** Fixed, behind content (`z-index: 0`)
- **Opacity:** 0.12 (subtle background atmosphere)
- **Characters:** Katakana (ア-ン) + 0-9 + A-Z
- **Font size:** 14px monospace
- **Speed:** 60ms interval
- **Brightness:** Varies randomly between `#008f11`, `#00ff41`, `#39ff14`

### CSS Overrides

The theme overrides Chirpy's default Bootstrap blue (`#0d6efd`) and orange (`#d2603a`) accent colours:

**Bootstrap variables overridden:**
- `--bs-link-color`, `--bs-link-hover-color`
- `--bs-primary`, `--bs-primary-rgb`
- `--bs-btn-*` (hover, active, focus colours)
- `--link-color`, `--toc-highlight`, `--tag-hover`

**Chirpy-specific selectors overridden** (these use `!important` in the compiled CSS):
- `#page-category a:hover`, `#page-tag a:hover` — orange → green
- `.content a:not(.img-link):hover` — orange → green
- `footer a:hover`, `#access-lastmod a:hover` — orange → green
- `.btn.btn-outline-primary:not(.disabled):hover` — blue border → green

### Avatar

Custom CSS zooms out the avatar image to show more of the photo:
```css
#sidebar #avatar img {
  object-fit: cover;
  object-position: center 20%;
  transform: scale(0.8);
}
```

---

## 📁 Site Structure

```
├── _config.yml          # Site configuration (title, URL, theme settings)
├── _includes/
│   └── metadata-hook.html  # All custom CSS + Matrix rain JS
├── _tabs/
│   ├── about.md         # About page
│   ├── archives.md      # Archives page
│   ├── categories.md    # Categories page
│   └── tags.md          # Tags page
├── _posts/              # 22 blog posts (Markdown)
├── assets/
│   └── img/
│       └── avatar.jpg   # Profile photo
├── .github/
│   └── workflows/
│       └── pages-deploy.yml  # GitHub Actions build workflow
├── Gemfile              # Ruby dependencies
├── index.html           # Homepage
└── README.md            # This file
```

---

## 🏷️ Taxonomy

**6 Categories:** Homelab, DevOps, Cloud, Networking, Security, Code

**Tags:** linux, automation, proxmox, ansible, aws, docker, networking, raspberry-pi, unifi, bedrock, python, monitoring, ssh, tailscale, vpn, and more.

---

## 🚀 Deployment

The site builds automatically via **GitHub Actions** on every push to `main`. The workflow:

1. Checks out the repo
2. Sets up Ruby 3.3 with Bundler
3. Runs `bundle exec jekyll build`
4. Deploys to GitHub Pages

**Build time:** ~30-40 seconds

---

## 🛠️ Local Development

```bash
# Install Ruby and Bundler, then:
bundle install
bundle exec jekyll serve
```

Visit `http://localhost:4000` to preview.

---

## 📝 Adding New Posts

Create a file in `_posts/` with the format `YYYY-MM-DD-title-slug.md`:

```yaml
---
layout: post
title: "Your Post Title"
date: 2026-01-01
categories: ["Homelab", "DevOps"]
tags: ["linux", "docker", "automation"]
description: "A brief description of the post."
---

Your content here...
```

Push to `main` and it deploys automatically.

---

## 📜 History

- **Migrated from:** [joshuamein.wordpress.com](https://joshuamein.wordpress.com/)
- **Theme:** [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) v7.5
- **Hosted on:** GitHub Pages
