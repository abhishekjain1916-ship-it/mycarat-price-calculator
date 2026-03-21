# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

**MyCarat Price Calculator** is a Shopify embedded admin app for a jewellery store. It lets merchants:
1. Configure per-product material specs (metal, melee diamonds, solitaires, gemstones)
2. Set daily metal rates (IBJA gold/silver — manual entry)
3. Pre-compute a price cache and delta table per product

A **Theme App Extension** (`extensions/price-calculator/blocks/price-calculator.liquid`) renders a price calculator widget on the storefront product page. It fetches cached prices for instant Lab/Natural price cards, and calls the live API only when the customer clicks "Apply Changes" on a custom configuration.

**Price formula (Phase 1):** Sum of raw material costs only (metal + diamonds + solitaires + gemstones). Making charge, handling, discount, GST to be added in later phases.

**Live store:** `my-carat-exquisite-diamond-boutique.myshopify.com` (dev store retired — all work on live store only)

---

## Commands

```bash
# Local development (MUST use this exact command — see IPv6 issue below)
cd ~/mycarat-app/mycarat-price-calculator && export NODE_OPTIONS="--dns-result-order=ipv4first" && npm run dev

npm run build          # Production build
npm run start          # Serve production build
npm run setup          # prisma generate + prisma migrate deploy (first-time or after schema changes)
npm run lint           # ESLint
npm run typecheck      # React Router typegen + tsc --noEmit
shopify app deploy     # Deploy config and extensions to Shopify (required after liquid file changes)
shopify theme push --store my-carat-exquisite-diamond-boutique --theme 149078835383  # Deploy theme to live store
```

**Test cache recalculation:**
```bash
curl -X POST https://YOUR-TUNNEL-URL/api/recalculate-cache \
  -H "Content-Type: application/json" \
  -d "{\"product_id\": \"gid://shopify/Product/7797570699350\", \"trigger\": \"manual\"}"
```

**Test product:** `gid://shopify/Product/7797570699350` — "Test Classic Tiffany's Solitaire Ring" — has all 4 components (metal: 18KT 3g + 14KT 2g, diamonds, solitaires, gemstones). No 9KT.

---

## Architecture

### Dual-database design

| Store | Purpose |
|-------|---------|
| **SQLite via Prisma** (`prisma/schema.prisma`) | Shopify session storage only — one `Session` model |
| **Supabase** (`app/supabase.server.js`) | All business data: rates, specs, price cache, delta cache |

The Supabase client is in `app/supabase.server.js` — reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from environment variables (`.env` locally, Fly.io secrets in production). Supabase now uses the `sb_secret_...` key format — legacy JWT keys (`eyJhbGci...`) are disabled. All server routes import `{ supabase }` from there.

### Supabase table reference

| Table | Key columns |
|-------|-------------|
| `metal_rates` | `metal`, `rate_per_gram` (**string!**), `fetched_at`, `source` |
| `product_specs_metal` | `product_id`, `metal_type`, `purity`, `weight_grams` (**string!**) |
| `product_specs_diamonds` | `product_id`, `diamond_group_ref`, `shape`, `size_bucket`, `diamond_count`, `total_weight_ct` |
| `product_specs_solitaires` | `product_id`, `solitaire_ref`, `shape`, `weight_range`, `actual_weight_ct` |
| `product_specs_gemstones` | `product_id`, `gemstone_group_ref`, `gemstone_name`, `size_bucket`, `gemstone_count`, `actual_weight_ct` |
| `diamond_rates_round` | `diamond_type` (**'Lab Grown'/'Natural'**), `colour_clarity`, `size_bucket`, `price_per_carat` |
| `diamond_rates_fancy` | same + `shape` column |
| `solitaire_rates_core` | `diamond_type` (**'Lab'/'Natural' — NOT 'Lab Grown'!**), `colour`, `clarity`, `weight_range`, `price_per_carat` |
| `solitaire_modifiers` | `modifier_type` (`shape`/`fluorescence`/`certification`/`cut_pol_sym`), `modifier_value`, `modifier_pct` |
| `gemstone_rates_natural` | `gemstone_name`, `size_bucket`, `quality`, `price_per_carat` |
| `gemstone_rates_synth_lab` | `gemstone_type`, `size_bucket`, `quality`, `price_per_carat` |
| `product_price_cache` | `product_id`, `lab_default_price`, `lab_min_price`, `lab_max_price`, `natural_*` — all **strings!** |
| `product_delta_cache` | `product_id`, `diamond_type` (**'Lab'/'Natural'**), `component`, `option_value`, `delta_amount` |

---

## CRITICAL: Naming Inconsistencies (Active Source of Bugs)

These differences are baked into the existing DB and code — do not "fix" them without a coordinated migration:

| Context | Lab type string |
|---------|----------------|
| `diamond_rates_round`, `diamond_rates_fancy` | `'Lab Grown'` |
| `solitaire_rates_core`, `product_delta_cache` | `'Lab'` |
| `api.calculate-price.jsx` action | Converts: `diamond_type === "Lab" ? "Lab Grown" : "Natural"` for diamond queries |

**All numeric DB values are stored as strings** — always call `parseFloat()` when reading `rate_per_gram`, `weight_grams`, `price_per_carat`, `delta_amount`, and all price cache columns.

**Round vs Fancy diamonds:** Round queries `diamond_rates_round` with NO shape filter. Fancy queries `diamond_rates_fancy` WITH a shape filter. Both are currently duplicated in `api.calculate-price.jsx` and `api.recalculate-cache.jsx`.

**Solitaire modifier_type for cut is `cut_pol_sym`**, not `cut`.

---

## Pricing Formulas

- **Metal (gold):** `rate_per_gram × (purity_number / 24) × weight_grams`
- **Metal (silver):** `rate_per_gram × (purity_number / 1000) × weight_grams`
- **Melee diamonds:** `total_weight_ct × price_per_carat`
- **Solitaires:** `actual_weight_ct × core_ppc × (1 + shape_mod) × (1 + fluor_mod) × (1 + cert_mod) × (1 + cut_mod)` (modifiers are `modifier_pct / 100`)
- **Gemstones:** `actual_weight_ct × price_per_carat`
- All prices in **INR**, rounded to 2 decimal places

### Default configurations (used for cache calculation)

| Parameter | Lab Grown | Natural |
|-----------|-----------|---------|
| Metal | 18KT | 18KT |
| Diamond | EF VVS | FG VS |
| Solitaire Colour | E | H |
| Solitaire Clarity | VVS2 | VS2 |
| Solitaire Cut | 3EX | 3VG+ |
| Solitaire Fluorescence | None | Faint |
| Solitaire Certification | IGI | IGI |
| Gemstone Quality | Premium | Premium |

### Customer option lists

- **Metal:** Derived from `product_specs_metal` per product — NOT hardcoded. Min price uses cheapest available purity, not always 9KT.
- **Diamond Lab:** EF VVS, EF VS, FG VS
- **Diamond Natural:** EF VVS, EF VS, FG VVS, FG VS, GH VS, GH SI
- **Solitaire Colour Lab:** D, E, F
- **Solitaire Colour Natural:** E, F, G, H, I, J
- **Solitaire Clarity Lab:** FL, IF, VVS1, VVS2, VS1, VS2
- **Solitaire Clarity Natural:** VVS1, VVS2, VS1, VS2, SI1, SI2
- **Solitaire Cut (Natural only):** 3EX, 3VG+, Others
- **Solitaire Fluorescence (Natural only):** None, Faint, Others
- **Solitaire Certification (Natural only):** IGI, GIA, Others
- **Gemstone Lab/Synthetic:** Classic, Premium
- **Gemstone Natural:** Classic, Premium, World Class, Heirloom, Royalty

---

## App Routes (`app/routes/`)

| Route file | URL | Purpose |
|-----------|-----|---------|
| `app.jsx` | `/app/*` layout | Nav shell, `AppProvider`, auth gate |
| `app._index.jsx` | `/app` | Template demo (keep as-is) |
| `app.metal-rates.jsx` | `/app/metal-rates` | View/update IBJA gold & silver rates |
| `app.specs-metal.jsx` | `/app/specs-metal` | Manage per-product metal specs |
| `app.specs-diamonds.jsx` | `/app/specs-diamonds` | Manage per-product melee diamond specs |
| `app.specs-solitaires.jsx` | `/app/specs-solitaires` | Manage per-product solitaire specs |
| `app.specs-gemstones.jsx` | `/app/specs-gemstones` | Manage per-product gemstone specs |
| `api.calculate-price.jsx` | `/api/calculate-price` | **Public CORS POST** — live price calculation |
| `api.product-prices.jsx` | `/api/product-prices` | **Public CORS GET** — cached prices + deltas |
| `api.recalculate-cache.jsx` | `/api/recalculate-cache` | Internal POST — rebuild price/delta cache |

Routes are discovered via `flatRoutes()` in `app/routes.js`. All `/app/*` routes call `authenticate.admin(request)` in every loader and action.

### Specs page pattern (all four specs pages follow this)

1. **Search intent** → Shopify Admin GraphQL to find products by title
2. **Load intent** → fetch existing specs from Supabase for selected product
3. **Save intent** → delete + re-insert specs in Supabase, then POST to `/api/recalculate-cache`

### CORS on public API routes

`api.calculate-price.jsx` and `api.product-prices.jsx` must both have CORS headers. React Router only routes GET→`loader` and POST→`action` — OPTIONS preflight requests go to the `loader`. Both routes export an explicit `loader` that returns 204 with CORS headers to handle preflight.

---

## Cache System

`api.recalculate-cache.jsx` pre-computes and stores:
- Default, min, max prices for Lab and Natural configurations
- A delta row for every selectable option across all components

**Cache uses `delete` + `insert`, not `upsert`** — to remove stale rows when specs are removed.

Cache is triggered server-side from specs save actions. It is **NOT** auto-triggered when metal rates change — currently requires manual curl or a future "Recalculate All" button.

---

## Theme Extension

**Location:** `extensions/price-calculator/blocks/price-calculator.liquid`

### APP_URL — permanently set to Fly.io

`APP_URL` in the liquid file is permanently set to `https://mycarat-price-calc.fly.dev`. No updates needed after dev restarts.

Local dev still uses the Cloudflare tunnel for the admin app (via `npm run dev`), but the storefront widget always calls the production Fly.io URL.

### Widget flow

1. On load → `GET /api/product-prices?product_id=gid://shopify/Product/…` (cached data)
2. On "Customise" → renders option boxes from delta data (no API call)
3. On "Apply Changes" → `POST /api/calculate-price` with full configuration
4. On "Add to Cart" → Shopify `/cart/add.js` with line-item properties (Stone Type, Metal Purity, Diamond Quality, Solitaire Colour/Clarity, Calculated Price)

### Widget design rules (must follow exactly)

- **Product ID from Liquid `{{ product.id }}`** returns just the number — must prepend `gid://shopify/Product/` in EVERY API call (both `loadPrices` and `mcApplyChanges`)
- **`renderOptions(type)`** is called ONCE when the panel opens — NEVER call it on option click (resets all state)
- **`makeOptionBox` on click**: update `selections[selectionKey] = value`, update border/bg of clicked box, reset siblings visually, call `updateDeltaTotal(activeType)` — do NOT re-render
- **Inner divs in option boxes** must have `pointer-events:none` so clicks always land on the outer `[data-value]` box
- **`if (data.total !== undefined)`** — NOT `if (data.total)` — zero is a valid calculated price
- **`mcAddToCart(type, btn)`** — `btn` is passed explicitly via `this` in the `onclick` attribute, NOT via `event.target`
- Widget currently hardcodes `id: {{ product.variants.first.id }}` — assumes single variant per product

---

## UI Components

Uses **Shopify Polaris web components** (`<s-page>`, `<s-section>`, `<s-stack>`, `<s-button>`, `<s-text-field>`, etc.) — NOT the React Polaris package. Registered globally by `AppProvider`.

For embedded-app navigation: use `<s-link href="…">` not `<a>`. Use `redirect` from `authenticate.admin`, not from `react-router`.

---

## Local Dev Gotchas

### IPv6 / Supabase connection timeout

Indian ISPs block IPv6 traffic to Supabase (Singapore region). **Always start with:**
```bash
export NODE_OPTIONS="--dns-result-order=ipv4first" && npm run dev
```
Also set DNS to `8.8.8.8` / `1.1.1.1` on the network adapter. This is a local-only issue — cloud hosting won't have it.

### Windows ARM64 Prisma

If Prisma fails to load: `set PRISMA_CLIENT_ENGINE_TYPE=binary`

---

## Known Issues & Technical Debt

These are documented issues — understand them before making changes in related areas:

| Issue | Severity | Notes |
|-------|----------|-------|
| APP_URL in liquid | ~~CRITICAL~~ RESOLVED | Permanently set to `https://mycarat-price-calc.fly.dev` |
| Cache not auto-triggered on rate changes | HIGH | Daily IBJA rate changes require manual recalculation for all products |
| N+1 queries in recalculate-cache | HIGH (scale) | ~200–500 DB round trips per product. Fix: batch-fetch all rates into memory once |
| No auth on `/api/recalculate-cache` | HIGH | Anyone can trigger expensive recalculations. Fix: add `RECALCULATE_SECRET` check |
| Public APIs have no rate limiting | HIGH (scale) | `/api/calculate-price` open to abuse. Fix: rate limit + validate product_id exists |
| Diamond type naming mismatch (`'Lab Grown'` vs `'Lab'`) | HIGH | Active bug source — see table above. Fix requires DB migration |
| All numeric values stored as strings | MEDIUM | Always `parseFloat()` — easy to miss, causes silent wrong prices |
| Business logic duplicated | MEDIUM | `calculatePrice()` exists independently in both `api.calculate-price.jsx` and `api.recalculate-cache.jsx`. Fix: shared utility at `app/utils/calculatePrice.server.js` |
| No DB indexes | MEDIUM (scale) | Needed on `product_delta_cache(product_id, diamond_type, component)`, all `product_specs_*` on `product_id`, rate lookup columns |
| `calculatePrice()` returns 0 silently | MEDIUM | Missing rate data returns 0, which gets cached — no alert. Fix: add validation + Sentry |
| Single variant assumption | MEDIUM | Widget adds `product.variants.first.id` — breaks if product has ring sizes |
| No job queue for bulk recalculation | HIGH (scale) | 5,000 products × 500 DB queries = not feasible synchronously |

---

## GitHub Repos (public)

| Repo | URL |
|------|-----|
| Shopify app (this repo) | `https://github.com/abhishekjain1916-ship-it/mycarat-price-calculator` |
| Storefront theme | `https://github.com/abhishekjain1916-ship-it/mycarat-front-end` *(if published)* |

Secrets are never committed — all in `.env` locally and Fly.io secrets in production.

---

## Session Log — 2026-03-21

### What was done

**Security audit & secret rotation**
- Found hardcoded Supabase URL, service role key (`eyJhbGci...` JWT), and Shopify admin token (`shpat_...`) in 19 source files (12 `.cjs` scripts + `app/supabase.server.js`)
- Moved all secrets to `.env` (gitignored); replaced every hardcoded value with `process.env.*`
- Added `.claude/`, `*.cjs`, image folders, data files, and artefacts to `.gitignore`
- Deleted entire git history (`rm -rf .git && git init`) to remove secrets from all past commits
- Pushed clean initial commit to public GitHub repo

**Supabase key migration**
- Supabase auto-disabled legacy JWT keys on 2026-03-21
- Migrated to new `sb_secret_...` format key
- Updated both local `.env` and Fly.io secret (`SUPABASE_SERVICE_ROLE_KEY`)
- Also added missing `SUPABASE_URL` Fly.io secret (was never set — caused all API calls to silently return "Price data not found")
- Ran `flyctl deploy` to rebuild with updated `supabase.server.js` (old build had hardcoded key baked into bundle)

**Infrastructure confirmed working**
- `https://mycarat-price-calc.fly.dev/api/product-prices` returning full price + delta data ✓
- `product_price_cache` has 464 rows ✓
- Dev store retired; active store is `my-carat-exquisite-diamond-boutique.myshopify.com`
- Active theme ID: `149078835383`

### Current status

| Area | Status |
|------|--------|
| Fly.io app | Live, healthy, Supabase connected |
| Supabase | 464 products cached, new `sb_secret_` key active |
| GitHub | Both repos public, secrets clean |
| Theme | On live store, theme ID `149078835383` |
| Dev store | Retired — `.shopify/` folder deleted |

### Next tasks to pick up

- [ ] Rotate Shopify admin token — `shpat_06d5716f...` was in old git history, needs regenerating in Shopify Admin → Settings → Apps. Update `.env` + `SHOPIFY_ACCESS_TOKEN` Fly.io secret
- [ ] Add `RECALCULATE_SECRET` auth to `/api/recalculate-cache` — currently open to anyone
- [ ] Add rate limiting to `/api/calculate-price`
- [ ] Fix diamond type naming mismatch (`'Lab Grown'` vs `'Lab'`) — requires DB migration
- [ ] Add "Recalculate All" button in admin UI to rebuild cache after daily metal rate changes
- [ ] Consolidate duplicate `calculatePrice()` logic into shared `app/utils/calculatePrice.server.js`

---

## Key Configuration Files

- `shopify.app.toml` — App config, scopes (`write_metaobject_definitions`, `write_metaobjects`, `write_products`), webhook subscriptions
- `app/shopify.server.js` — Shopify app init, `ApiVersion.October25`, expiring offline tokens enabled
- `app/supabase.server.js` — Supabase client (reads from `process.env.SUPABASE_URL` + `process.env.SUPABASE_SERVICE_ROLE_KEY`)
- `.mcp.json` — Shopify Dev MCP configuration
