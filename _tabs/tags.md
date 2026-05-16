---
layout: page
title: Tags
permalink: /tags/
description: Browse posts by tag.
---

{%- assign tags = site.tags | sort -%}
<section class="tag-cloud">
  {%- for t in tags -%}
    <a class="tag" href="{{ '/tags/' | append: t[0] | downcase | append: '/' | relative_url }}">
      #{{ t[0] }}<span class="tag-count">·{{ t[1].size }}</span>
    </a>
  {%- endfor -%}
</section>
