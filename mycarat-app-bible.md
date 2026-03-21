# MyCarat App Bible — Context Document for New Chats

## Project Overview
Shopify custom app for jewellery e-commerce (MyCarat) enabling customers to customize products by selecting raw materials.
**Price Formula:** Sum of Raw Materials + making charge + handling - discount + GST (Phase 1: Raw Materials only)

---

## Tech Stack
- **Framework:** Shopify Remix App (React Router v7, NOT Remix)
- **Database:** Supabase (PostgreSQL) — project: `mycarat-app` (Singapore region)
- **Hosting:** Fly.io/Railway (not yet deployed)
- **Storefront Widget:** Vanilla JS in Theme App Extension (Liquid)
- **UI (Admin):** Shopify Polaris components
- **Dev Store:** mycarat-dev.myshopify.com

## Local Dev Setup
- **App folder:** `~/mycarat-app/mycarat-price-calculator`
- **Start command:** `export NODE_OPTIONS="--dns-result-order=ipv4first" && npm run dev`
- **CRITICAL:** Must disable IPv6 on Windows network adapter OR use the export command above — Indian ISP blocks Supabase via IPv6
- **DNS must be:** 8.8.8.8 / 1.1.1.1 (Google DNS) — not ISP default
- **Supabase URL:** `gyzgjckmeowmsosqgwkr.supabase.co`

---

## Database Schema (14 Tables in Supabase)

### Rate Tables
| Table | Purpose |
|-------|---------|
| `metal_rates` | Gold/Silver rates (manual IBJA entry). Columns: metal, rate_per_gram (stored as string!), fetched_at, source |
| `diamond_rates_round` | Round diamond PPC. Columns: diamond_type ('Lab Grown'/'Natural'), colour_clarity, size_bucket, price_per_carat |
| `diamond_rates_fancy` | Fancy diamond PPC. Same + shape column |
| `solitaire_rates_core` | Solitaire base PPC. Columns: diamond_type ('Lab'/'Natural' — NOT 'Lab Grown'!), colour, clarity, weight_range, price_per_carat |
| `solitaire_modifiers` | % adjustments. Columns: modifier_type (shape/fluorescence/certification/cut_pol_sym), modifier_value, modifier_pct |
| `gemstone_rates_natural` | Natural gemstone PPC. Columns: gemstone_name, size_bucket, quality, price_per_carat |
| `gemstone_rates_synth_lab` | Lab/Synthetic gemstone PPC. Columns: gemstone_type, size_bucket, quality, price_per_carat |

### Product Spec Tables
| Table | Purpose |
|-------|---------|
| `product_specs_metal` | Per product: product_id, metal_type, purity, weight_grams (stored as string!) |
| `product_specs_diamonds` | Per product: product_id, diamond_group_ref, shape, size_bucket, diamond_count, total_weight_ct |
| `product_specs_solitaires` | Per product: product_id, solitaire_ref, shape, weight_range, actual_weight_ct |
| `product_specs_gemstones` | Per product: product_id, gemstone_group_ref, gemstone_name, size_bucket, gemstone_count, actual_weight_ct |

### Cache Tables
| Table | Purpose |
|-------|---------|
| `product_price_cache` | Lab/Natural default/min/max prices per product (all stored as strings!) |
| `product_delta_cache` | Delta from default for each option. Columns: product_id, diamond_type ('Lab'/'Natural'), component, option_value, delta_amount |

---

## CRITICAL Naming Inconsistencies
- Diamond tables: type = `'Lab Grown'` / `'Natural'`
- Solitaire tables: type = `'Lab'` / `'Natural'` (NOT 'Lab Grown')
- All numeric values stored as strings in DB — always use `parseFloat()` when reading
- Round diamonds: NO shape column in query. Fancy diamonds: include shape in query

---

## App Routes (in `app/routes/`)
| File | Purpose |
|------|---------|
| `api.calculate-price.jsx` | POST — calculates raw material price. Has CORS headers |
| `api.recalculate-cache.jsx` | POST — recalculates and stores all cached prices/deltas for a product |
| `api.product-prices.jsx` | GET — public endpoint for storefront. Returns cached prices + deltas. Has CORS headers |
| `app.metal-rates.jsx` | Admin: manual metal rate entry |
| `app.specs-metal.jsx` | Admin: product metal specs |
| `app.specs-diamonds.jsx` | Admin: product diamond specs |
| `app.specs-solitaires.jsx` | Admin: product solitaire specs |
| `app.specs-gemstones.jsx` | Admin: product gemstone specs |

---

## Business Logic

### Metal Price
- PPG (gold) = rate_per_gram × (purity/24)
- PPG (silver) = rate_per_gram × (purity/1000)
- Price = PPG × weight_grams

### Diamond (Melee ≤0.20ct) Price
- Round: lookup diamond_rates_round by type, colour_clarity, size_bucket
- Fancy: lookup diamond_rates_fancy by type, colour_clarity, size_bucket, shape
- Price = total_weight_ct × price_per_carat

### Solitaire (>0.20ct) Price
- Core PPC from solitaire_rates_core
- Modifiers: shape, fluorescence, certification, cut_pol_sym (all % adjustments)
- Adjusted PPC = core × (1+shape%) × (1+fluor%) × (1+cert%) × (1+cut%)
- Price = actual_weight_ct × adjusted_ppc

### Gemstone Price
- Natural: lookup gemstone_rates_natural by name, size_bucket, quality
- Lab/Synthetic: lookup gemstone_rates_synth_lab by type, size_bucket, quality
- Price = actual_weight_ct × price_per_carat

---

## Default Configurations (for cache calculation)

| Parameter | Lab Grown Default | Natural Default |
|-----------|------------------|-----------------|
| Metal | 18KT | 18KT |
| Diamond | EF VVS | FG VS |
| Solitaire Colour | E | H |
| Solitaire Clarity | VVS2 | VS2 |
| Solitaire Cut | 3EX | 3VG+ |
| Solitaire Fluorescence | None | Faint |
| Solitaire Certification | IGI | IGI |
| Gemstone Quality | Premium | Premium |

---

## Customer Option Lists

### Metal: 9KT, 14KT, 18KT
### Diamond Lab: EF VVS, EF VS, FG VS
### Diamond Natural: EF VVS, EF VS, FG VVS, FG VS, GH VS, GH SI
### Solitaire Colour Lab: D, E, F
### Solitaire Colour Natural: E, F, G, H, I, J
### Solitaire Clarity Lab: FL, IF, VVS1, VVS2, VS1, VS2
### Solitaire Clarity Natural: VVS1, VVS2, VS1, VS2, SI1, SI2
### Solitaire Cut (Natural only): 3EX, 3VG+, Others
### Solitaire Fluorescence (Natural only): None, Faint, Others
### Solitaire Certification (Natural only): IGI, GIA, Others
### Gemstone Lab/Synthetic: Classic, Premium
### Gemstone Natural: Classic, Premium, World Class, Heirloom, Royalty

---

## Theme App Extension (Storefront Widget)
- **Location:** `extensions/price-calculator/blocks/price-calculator.liquid`
- **Type:** Theme App Extension (Vanilla JS + Liquid)
- **CRITICAL:** APP_URL must be hardcoded to current Cloudflare tunnel URL (changes every restart!)
  - Find: `const APP_URL = 'https://XXXX.trycloudflare.com';`
  - Update every time app restarts

### Widget Flow (4 Stages)
1. **Price Anchor Pills** — "Lab Grown from ₹X" | "Natural from ₹Y"
2. **Made to Order Message** — sets context
3. **Two Price Cards** — Lab Grown / Natural with Add to Cart + Customise buttons
4. **Customisation Panel** — carousels showing delta from default per option

### Product ID Issue
- Liquid `{{ product.id }}` returns just the number (e.g. `7797570699350`)
- Must prepend `gid://shopify/Product/` before sending to API
- In widget JS: `const fullProductId = \`gid://shopify/Product/\${productId}\`;`

---

## Current Status (as of last session)

### ✅ WORKING
- All admin pages (metal rates, product specs for all 4 components)
- Price calculation API (`api.calculate-price.jsx`)
- Cache recalculation engine (`api.recalculate-cache.jsx`)
- Public prices API (`api.product-prices.jsx`) with CORS
- Widget renders on product page
- Prices load (Lab/Natural default, min, max show correctly)
- Customise panel opens

### ❌ NOT WORKING (Current Task)
- **Option selection in customise panel** — clicking options does nothing
- **Delta total not updating** — stays at ₹0
- **Root cause:** `makeOptionBox` function calls `renderOptions` on every click which re-renders everything and resets state
- **Fix needed:** Rewrite `makeOptionBox` to update selection and visual state in-place WITHOUT re-rendering

### Fix Strategy for makeOptionBox
New signature: `makeOptionBox(component, value, delta, isSelected)`
On click: update `selections[component] = value`, update border/bg of clicked box, reset siblings, call `updateDeltaTotal(activeType)`
Do NOT call `renderOptions` on click.

---

## Key Learnings / Gotchas
1. All DB numeric values stored as strings — always parseFloat()
2. Diamond type naming: 'Lab Grown' in diamond tables, 'Lab' in solitaire tables
3. Fancy diamonds need shape in query, round diamonds don't
4. solitaire_modifiers uses `cut_pol_sym` not `cut` as modifier_type
5. IPv6 causes Supabase connection timeout — must disable or force IPv4
6. Cloudflare tunnel URL changes every app restart — update liquid file each time
7. Product ID from Liquid is just number — must add `gid://shopify/Product/` prefix
8. CORS headers needed on all public API routes (product-prices, calculate-price)
9. `renderOptions` re-renders all boxes on selection — causes click handler loss

---

## Test Product
- **Product ID:** `gid://shopify/Product/7797570699350`
- **Name:** Test Classic Tiffany's Solitaire Ring
- Has all 4 components: metal, diamonds, solitaires, gemstones

## Test Curl Command (recalculate cache)
```bash
curl -X POST http://localhost:PORT/api/recalculate-cache -H "Content-Type: application/json" -d "{\"product_id\": \"gid://shopify/Product/7797570699350\", \"trigger\": \"manual\"}"
```
