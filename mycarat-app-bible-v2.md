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
- **Dev Environment:** Git Bash (commands) + VS Code (editing)

## Local Dev Setup
- **App folder:** `~/mycarat-app/mycarat-price-calculator`
- **Start command:** `cd ~/mycarat-app/mycarat-price-calculator && export NODE_OPTIONS="--dns-result-order=ipv4first" && npm run dev`
- **Deploy extension:** `cd ~/mycarat-app/mycarat-price-calculator && shopify app deploy`
- **CRITICAL:** Must disable IPv6 on Windows network adapter OR use the export command above — Indian ISP blocks Supabase via IPv6
- **DNS must be:** 8.8.8.8 / 1.1.1.1 (Google DNS) — not ISP default
- **Supabase URL:** `gyzgjckmeowmsosqgwkr.supabase.co`

## Cloudflare Tunnel (CRITICAL)
- Every `npm run dev` restart gives a NEW tunnel URL
- Must update `APP_URL` in `extensions/price-calculator/blocks/price-calculator.liquid` after every restart
- After updating liquid file, must run `shopify app deploy` to push to storefront
- Server-side files (routes/) hot-reload automatically — no deploy needed
- Only liquid file changes require `shopify app deploy`

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
| `api.calculate-price.jsx` | POST — calculates raw material price. Has CORS headers. Has loader export for OPTIONS preflight |
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

### Metal: derived from product_specs_metal (NOT hardcoded — varies per product)
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
  - Update every time app restarts, then run `shopify app deploy`

### Widget Flow (4 Stages)
1. **Price Anchor Pills** — "Lab Grown from ₹X" | "Natural from ₹Y"
2. **Made to Order Message** — sets context
3. **Two Price Cards** — Lab Grown / Natural with Add to Cart + Customise buttons
4. **Customisation Panel** — option boxes showing delta from default per option

### Widget Design Decisions
- Option boxes update visual state IN-PLACE (no re-render on click)
- `pointer-events:none` on inner divs so clicks always land on outer box with `data-value`
- `makeOptionBox(containerId, selectionKey, value, delta, isSelected)` — new signature
- `renderOptions(type)` only called ONCE when panel opens, not on every click
- Custom price shown below Apply Changes button (Option B)
- `mcAddToCart(type, btn)` — btn passed explicitly via `this` in onclick, NOT via event.target
- `if (data.total !== undefined)` — NOT `if (data.total)` — total can legitimately be 0

### Product ID Handling
- Liquid `{{ product.id }}` returns just the number (e.g. `7797570699350`)
- Must prepend `gid://shopify/Product/` before sending to ANY API call
- In loadPrices: `const fullProductId = \`gid://shopify/Product/\${productId}\`;`
- In mcApplyChanges: `product_id: \`gid://shopify/Product/\${productId}\``  ← easy to forget!

---

## CORS Setup (api.calculate-price.jsx)
- Must export `loader` function to handle OPTIONS preflight (React Router doesn't route OPTIONS to action)
- `CORS_HEADERS` constant shared across loader, action OPTIONS handler, and final response
- Both `api.calculate-price.jsx` and `api.product-prices.jsx` need CORS headers

---

## Cache Recalculation
- After changing any product spec, must manually trigger recalculate-cache
- Metal deltas are generated only for purities that exist in product_specs_metal (NOT hardcoded)
- Cache uses delete + insert (not upsert) to avoid stale entries from removed specs
- Min price uses cheapest available purity (not hardcoded 9KT)

### Recalculate Cache Command
```bash
curl -X POST https://YOUR-TUNNEL-URL/api/recalculate-cache -H "Content-Type: application/json" -d "{\"product_id\": \"gid://shopify/Product/7797570699350\", \"trigger\": \"manual\"}"
```

---

## Current Status

### ✅ WORKING
- All admin pages (metal rates, product specs for all 4 components)
- Price calculation API (`api.calculate-price.jsx`)
- Cache recalculation engine (`api.recalculate-cache.jsx`)
- Public prices API (`api.product-prices.jsx`) with CORS
- Widget renders on product page
- Prices load (Lab/Natural default, min, max)
- Customise panel opens
- Option selection works with in-place visual feedback
- Estimated adjustment updates correctly on selection
- Metal options filtered to product specs only (no hardcoded 9KT)
- Apply Changes shows correct customised price (Option B — below panel)
- Add to Cart works (passes Stone Type, Metal Purity, Diamond Quality, Solitaire details, Calculated Price as cart properties)

### ❌ NOT WORKING / TODO
- Nothing critical on widget currently
- Add to Cart on default cards not yet verified end-to-end in cart
- No webhook to auto-trigger cache recalculation when rates change
- APP_URL still hardcoded (changes every restart) — long term fix: app proxy or metafield

---

## Test Product
- **Product ID:** `gid://shopify/Product/7797570699350`
- **Name:** Test Classic Tiffany's Solitaire Ring
- **Metal specs:** 18KT (3g), 14KT (2g) — NO 9KT
- Has all 4 components: metal, diamonds, solitaires, gemstones

---

## Key Learnings / Gotchas
1. All DB numeric values stored as strings — always parseFloat()
2. Diamond type naming: 'Lab Grown' in diamond tables, 'Lab' in solitaire tables
3. Fancy diamonds need shape in query, round diamonds don't
4. solitaire_modifiers uses `cut_pol_sym` not `cut` as modifier_type
5. IPv6 causes Supabase connection timeout — must disable or force IPv4
6. Cloudflare tunnel URL changes every app restart — update liquid file + deploy each time
7. Product ID from Liquid is just number — must add `gid://shopify/Product/` prefix in ALL API calls
8. CORS headers needed on all public API routes — export loader for OPTIONS preflight
9. React Router only routes GET→loader, POST→action. OPTIONS preflight needs explicit loader export
10. `makeOptionBox` click handlers must NOT call `renderOptions` — causes state reset
11. Inner divs in option boxes need `pointer-events:none` so clicks land on outer box
12. `if (data.total !== undefined)` not `if (data.total)` — zero is a valid price
13. `event.target` unreliable in onclick handlers — pass `this` explicitly
14. Cache upsert doesn't remove stale rows — use delete + insert for clean recalculation
15. Metal options must be derived from product_specs_metal, not hardcoded
16. Newline inside JS string literal causes SyntaxError — watch for accidental Enter in APP_URL

---

## Claude Code Setup
```bash
npm install -g @anthropic-ai/claude-code
cd ~/mycarat-app/mycarat-price-calculator
claude
```
