---
layout: page
title: Categories
permalink: /categories/
description: Browse posts by category.
---

{%- assign categories = site.categories | sort -%}
<section class="category-grid">
  {%- for cat in categories -%}
    <a class="category-card"
       href="{{ '/categories/' | append: cat[0] | downcase | append: '/' | relative_url }}">
      <h2 class="category-card-name">{{ cat[0] }}</h2>
      <p class="category-card-count">
        {{ cat[1].size }} post{% if cat[1].size != 1 %}s{% endif %}
      </p>
    </a>
  {%- endfor -%}
</section>
