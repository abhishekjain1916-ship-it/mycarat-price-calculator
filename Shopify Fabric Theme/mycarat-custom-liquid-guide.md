# MyCarat Custom Liquid Sections — Customisation Guide

Both sections live in the Shopify Customizer under **Custom Liquid** blocks.
To edit: Customizer → click the section → edit the HTML in the liquid text area → Save.

---

## 1. MyCarat Assurance Section

### What it does
A 2-column (mobile) / 4-column (desktop) grid of 8 trust icons with short labels.
Appears after the Collections bento section.

### Structure of each item
```html
<div class="mc-assurance__item">
  <div class="mc-assurance__icon">
    <!-- SVG icon here -->
  </div>
  <p class="mc-assurance__label">Label text here</p>
</div>
```

### How to customise

**Change an icon label:**
Find the `<p class="mc-assurance__label">` inside the relevant `mc-assurance__item` div and edit the text.

**Swap an icon SVG:**
Replace the `<svg>…</svg>` block inside `mc-assurance__icon`. Keep width/height at 32px.
Free icon sources: [heroicons.com](https://heroicons.com), [phosphoricons.com](https://phosphoricons.com)

**Change the section title:**
```html
<h2 class="mc-assurance__title">MyCarat <span>Assurance</span></h2>
```
The text inside `<span>` renders in teal (#81D8D0). The rest is white/dark depending on colour scheme.

**Change the subtitle:**
```html
<p class="mc-assurance__subtitle">Our promise to you</p>
```

**Add or remove an item:**
Copy one full `<div class="mc-assurance__item">…</div>` block and paste inside `mc-assurance__grid`.
The grid auto-adjusts — keep total count even (2, 4, 6, 8) for clean layout.

**Change icon circle colour:**
In the `<style>` block, find:
```css
.mc-assurance__icon { background: #EAF7F6; border: 2px solid #81D8D0; }
```
Replace `#81D8D0` with any hex colour.

### Current 8 assurance items (edit text as needed)
1. BIS Hallmarked Gold
2. Certified Diamonds
3. Free Shipping
4. Easy 15-Day Returns
5. Lifetime Exchange
6. Secure Packaging
7. Custom Orders Welcome
8. Price Transparency

---

## 2. Promo Cards Section

### What it does
Two side-by-side promotional cards with headings, subtext, and clickable CTA buttons.
Mobile: stacks vertically. Desktop (750px+): side by side.

### Full code (for reference / re-pasting)

```html
<div class="mc-promo-grid">

  <!-- Card 1 -->
  <div class="mc-promo-card mc-promo-card--centered">
    <div class="mc-promo-card__icon">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="20" r="19" stroke="#81D8D0" stroke-width="2"/>
        <path d="M20 10 L20 20 L26 26" stroke="#005F5C" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <h3 class="mc-promo-card__heading">Crafted-to-order.<br><strong>100% yours.</strong></h3>
    <p class="mc-promo-card__subtext">Every piece made to your exact specs</p>
    <a class="mc-promo-card__link" href="/pages/how-it-works">How it works &rsaquo;</a>
  </div>

  <!-- Card 2 -->
  <div class="mc-promo-card mc-promo-card--accent">
    <h3 class="mc-promo-card__tag">#GiftMyCarat</h3>
    <p class="mc-promo-card__body">Breathtaking gifts for your loved ones</p>
    <p class="mc-promo-card__price">STARTING AT ₹15,000</p>
    <a class="mc-promo-card__btn" href="/collections/gift-ideas">Explore Now &rsaquo;</a>
  </div>

</div>

<style>
  .mc-promo-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 32px 16px;
    max-width: 1200px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  @media (min-width: 750px) {
    .mc-promo-grid {
      grid-template-columns: 1fr 1fr;
      padding: 48px 32px;
    }
  }

  .mc-promo-card {
    border-radius: 20px;
    padding: 40px 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
  }

  /* Card 1: centered, teal outline */
  .mc-promo-card--centered {
    background: #F7FFFE;
    border: 1.5px solid #81D8D0;
    align-items: center;
    text-align: center;
  }

  .mc-promo-card__icon { margin-bottom: 4px; }

  .mc-promo-card__heading {
    font-size: 20px;
    font-weight: 400;
    color: #1a1a1a;
    margin: 0;
    line-height: 1.4;
  }

  .mc-promo-card__heading strong { color: #005F5C; }

  .mc-promo-card__subtext { font-size: 14px; color: #555; margin: 0; }

  .mc-promo-card__link {
    font-size: 13px;
    font-weight: 600;
    color: #00827F;
    text-decoration: none;
    letter-spacing: 0.04em;
    margin-top: 8px;
  }

  .mc-promo-card__link:hover { text-decoration: underline; }

  /* Card 2: teal left-border accent */
  .mc-promo-card--accent {
    background: #EAF7F6;
    border-left: 5px solid #81D8D0;
    align-items: flex-start;
    justify-content: center;
  }

  .mc-promo-card__tag {
    font-size: 26px;
    font-weight: 700;
    color: #005F5C;
    margin: 0;
    line-height: 1.2;
  }

  .mc-promo-card__body { font-size: 15px; color: #333; margin: 0; }

  .mc-promo-card__price {
    font-size: 12px;
    font-weight: 600;
    color: #00827F;
    letter-spacing: 0.08em;
    margin: 0;
  }

  .mc-promo-card__btn {
    margin-top: 12px;
    display: inline-block;
    padding: 12px 24px;
    border: 1.5px solid #005F5C;
    border-radius: 50px;
    font-size: 14px;
    color: #005F5C;
    text-decoration: none;
    font-weight: 500;
    transition: background 0.2s, color 0.2s;
  }

  .mc-promo-card__btn:hover { background: #005F5C; color: #fff; }
</style>
```

### How to customise

#### Card 1 (centered, outline border)

| What to change | Where in code |
|---|---|
| Main heading | `<h3 class="mc-promo-card__heading">` — edit text, use `<strong>` for teal bold |
| Small subtext | `<p class="mc-promo-card__subtext">` |
| CTA link text | `<a class="mc-promo-card__link">` — edit the visible text |
| CTA destination | `href="/pages/how-it-works"` → change to your page URL |
| Icon | Replace the `<svg>` block inside `mc-promo-card__icon` |
| Hide icon | Delete the entire `<div class="mc-promo-card__icon">…</div>` |

#### Card 2 (accent left border)

| What to change | Where in code |
|---|---|
| Hashtag heading | `<h3 class="mc-promo-card__tag">` |
| Body text | `<p class="mc-promo-card__body">` |
| Price callout | `<p class="mc-promo-card__price">` — delete this `<p>` entirely to hide it |
| Button text | `<a class="mc-promo-card__btn">` — edit the visible text |
| Button destination | `href="/collections/gift-ideas"` → change to your collection/page URL |

#### Colours (in `<style>` block)

| Element | CSS property to change |
|---|---|
| Card 1 background | `.mc-promo-card--centered { background: #F7FFFE; }` |
| Card 1 border | `.mc-promo-card--centered { border: 1.5px solid #81D8D0; }` |
| Card 2 background | `.mc-promo-card--accent { background: #EAF7F6; }` |
| Card 2 left accent | `.mc-promo-card--accent { border-left: 5px solid #81D8D0; }` |
| Heading colour | `.mc-promo-card__tag { color: #005F5C; }` |

#### Layout

**Change gap between cards:**
```css
.mc-promo-grid { gap: 16px; }   /* increase to 24px or 32px for more breathing room */
```

**Change desktop breakpoint (default 750px):**
```css
@media (min-width: 750px) { … }
```

**Make cards equal height on desktop:**
Already default — both cards stretch to the same height automatically.

---

---

## 3. MyCarat Experience Section

### What it does
Section heading with two inline subtitle links, followed by two images side by side (desktop) / stacked (mobile), with a caption CTA below the second image.

**Status: Template — images are placeholders. Replace URLs when images are ready.**

### How to add images when ready
1. Shopify Admin → **Content → Files → Upload** your image
2. Click the uploaded file → copy the full URL
3. In the Custom Liquid, find `PASTE-IMAGE-1-URL-HERE` / `PASTE-IMAGE-2-URL-HERE` and replace with that URL
4. Also swap the placeholder `<div class="mc-experience__placeholder">` block for a real `<img>` tag (see swap instructions below)

### Full code (template — with placeholders)

```html
<div class="mc-experience">

  <div class="mc-experience__header">
    <h2 class="mc-experience__title">The MyCarat Experience</h2>
    <p class="mc-experience__subtitle">
      <a href="/pages/our-studio">Visit our Studio</a> or
      <a href="/pages/book-consultation">Book a Virtual Consultation</a>
    </p>
  </div>

  <div class="mc-experience__grid">

    <!-- Image 1 — replace placeholder div with <img> when image is ready -->
    <div class="mc-experience__card">
      <div class="mc-experience__img-wrap">
        <!-- TEMPLATE: remove this placeholder div and uncomment the <img> below when image is ready -->
        <div class="mc-experience__placeholder">Our Studio<br><span>Upload image → paste URL here</span></div>
        <!-- <img src="PASTE-IMAGE-1-URL-HERE" alt="MyCarat Studio" loading="lazy"> -->
      </div>
    </div>

    <!-- Image 2 — replace placeholder div with <img> when image is ready -->
    <div class="mc-experience__card">
      <div class="mc-experience__img-wrap">
        <!-- TEMPLATE: remove this placeholder div and uncomment the <img> below when image is ready -->
        <div class="mc-experience__placeholder">Book an Appointment<br><span>Upload image → paste URL here</span></div>
        <!-- <img src="PASTE-IMAGE-2-URL-HERE" alt="Book an Appointment" loading="lazy"> -->
      </div>
      <a class="mc-experience__caption" href="/pages/book-consultation">
        Book an Appointment &rarr;
      </a>
    </div>

  </div>

</div>

<style>
  .mc-experience {
    padding: 40px 16px;
    max-width: 1200px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .mc-experience__header { margin-bottom: 24px; }

  .mc-experience__title {
    font-size: 22px;
    font-weight: 500;
    color: #1a1a1a;
    margin: 0 0 6px 0;
  }

  .mc-experience__subtitle {
    font-size: 13px;
    color: #555;
    margin: 0;
  }

  .mc-experience__subtitle a {
    color: #00827F;
    text-decoration: underline;
    font-weight: 500;
  }

  .mc-experience__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 750px) {
    .mc-experience__grid { grid-template-columns: 1fr 1fr; }
  }

  .mc-experience__img-wrap {
    width: 100%;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border-radius: 12px;
  }

  /* Placeholder — remove once real images are added */
  .mc-experience__placeholder {
    width: 100%;
    height: 100%;
    background: #EAF7F6;
    border: 2px dashed #81D8D0;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    color: #005F5C;
    text-align: center;
    padding: 16px;
    box-sizing: border-box;
  }

  .mc-experience__placeholder span {
    font-size: 11px;
    font-weight: 400;
    color: #555;
    margin-top: 6px;
  }

  /* Real image styles (active once <img> is uncommented) */
  .mc-experience__img-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.4s ease;
  }

  .mc-experience__img-wrap img:hover { transform: scale(1.03); }

  .mc-experience__caption {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    font-size: 14px;
    color: #1a1a1a;
    text-decoration: none;
    font-weight: 400;
  }

  .mc-experience__caption:hover { color: #00827F; }
</style>
```

### How to swap a placeholder for a real image

**Before (placeholder):**
```html
<div class="mc-experience__img-wrap">
  <div class="mc-experience__placeholder">Our Studio<br><span>...</span></div>
  <!-- <img src="PASTE-IMAGE-1-URL-HERE" alt="MyCarat Studio" loading="lazy"> -->
</div>
```

**After (real image):**
```html
<div class="mc-experience__img-wrap">
  <img src="https://cdn.shopify.com/s/files/1/xxxx/yourimage.jpg" alt="MyCarat Studio" loading="lazy">
</div>
```
Delete the placeholder `<div>` and uncomment the `<img>` line (remove `<!--` and `-->`).

### How to customise

| What to change | Where in code |
|---|---|
| Section title | `<h2 class="mc-experience__title">` |
| Subtitle link 1 text | First `<a>` in `mc-experience__subtitle` |
| Subtitle link 1 URL | `href="/pages/our-studio"` |
| Subtitle link 2 text | Second `<a>` in `mc-experience__subtitle` |
| Subtitle link 2 URL | `href="/pages/book-consultation"` |
| Caption CTA text | `<a class="mc-experience__caption">` |
| Caption CTA URL | `href="/pages/book-consultation"` on that same `<a>` |
| Add caption to Image 1 | Copy the `<a class="mc-experience__caption">` block into the first `mc-experience__card` |
| Image aspect ratio | `.mc-experience__img-wrap { aspect-ratio: 4 / 3; }` — try `3/2`, `1/1`, or `3/4` |

---

## Colour reference

| Variable | Hex | Used for |
|---|---|---|
| Tiffany / primary teal | `#81D8D0` | Borders, rings, accents |
| Teal dark | `#00827F` | Hover states, links |
| Teal deep | `#005F5C` | Headings, button borders |
| Teal light | `#EAF7F6` | Card backgrounds, icon circles |
