# Joshua Mein — Tech Blog

🌐 **Live:** [joshwaamein.github.io](https://joshwaamein.github.io)

A custom-built Jekyll blog with no external theme — same Matrix-green design language as the [portfolio site](https://joshwaamein.github.io/portfolio-site/).

Every line of HTML, SCSS, and JS lives in this repo (no third-party theme, no Bootstrap, no `!important` wars). Inspired structurally by the portfolio.

## Features

- Vanilla Jekyll 4 with custom layouts/includes/SCSS — no theme dependency
- Matrix-green / GitHub-dark palette + light + WCAG high-contrast a11y mode
- Toggleable Matrix-rain canvas background (respects `prefers-reduced-motion`)
- Header toggles for theme / a11y / rain (no-flash localStorage init)
- Auto-generated TOC for posts with 3+ `<h2>` headings
- Categories index + per-category pages, tag cloud + per-tag pages, year-grouped archive
- Pagination, prev/next post navigation, RSS feed
- GitHub Pages deploy via existing GitHub Actions workflow (Ruby 3.3)

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
├── _layouts/             # default, home, page, post, archive, category, tag
├── _includes/            # head, header, nav, footer, post-card, pagination, toc
├── _sass/                # tokens, base, layout, components, post, syntax
├── _posts/               # 36 blog posts (markdown)
├── _tabs/                # top-nav pages (about, archives, categories, tags)
├── assets/
│   ├── css/main.scss     # imports the SCSS partials
│   ├── js/app.js         # tab/theme/a11y/rain toggles
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
