# MyCarat — Known Issues, Workarounds & Scale Readiness Report

## Document Purpose
This document tracks all known issues, makeshift arrangements, schema inconsistencies, and architectural concerns that need to be resolved before scaling to 5,000 products and 50,000 daily visitors.

---

## SECTION 1: Active Workarounds (Must Fix Before Production)

### 1.1 Cloudflare Tunnel URL — Hardcoded in Liquid File
**Severity: CRITICAL**
**Current workaround:** Every time `npm run dev` restarts, a new Cloudflare tunnel URL is generated. Developer must manually:
1. Copy the new URL from terminal
2. Update `APP_URL` in `extensions/price-calculator/blocks/price-calculator.liquid`
3. Run `shopify app deploy` to push to storefront

**Problem at scale:** This is a dev-only issue but means the widget breaks on every restart. Any team member working on the app will break the live storefront if they restart without updating.

**Proper fix:** 
- Deploy the app to a permanent hosting provider (Fly.io or Railway) with a fixed URL
- OR use Shopify App Proxy to route requests through a fixed Shopify URL
- OR store APP_URL in a Shopify metafield and read it dynamically in the liquid file

---

### 1.2 IPv6 Blocking Supabase Connection
**Severity: HIGH**
**Current workaround:** Must manually disable IPv6 on Windows network adapter before starting the app, OR prepend the start command with:
```bash
export NODE_OPTIONS="--dns-result-order=ipv4first"
```
Full start command:
```bash
cd ~/mycarat-app/mycarat-price-calculator && export NODE_OPTIONS="--dns-result-order=ipv4first" && npm run dev
```

**Root cause:** Indian ISPs route IPv6 traffic in a way that causes Supabase (Singapore region) connection timeouts. Node.js defaults to IPv6 which fails silently.

**Problem at scale:** When deployed to production (Fly.io/Railway), this may not be an issue since cloud servers typically have proper IPv6 routing. However, any new developer on Windows/Indian ISP will face this issue locally.

**Proper fix:**
- Add `NODE_OPTIONS=--dns-result-order=ipv4first` to `.env` file permanently
- OR switch Supabase project to a region with better Indian ISP routing (Mumbai)
- OR use a connection pooler like Supabase's pgBouncer which handles this

---

### 1.3 DNS Configuration Required
**Severity: MEDIUM**
**Current workaround:** Developer must manually set DNS on their network adapter to:
- Primary: `8.8.8.8` (Google)
- Secondary: `1.1.1.1` (Cloudflare)

Default ISP DNS in India causes Supabase hostname resolution to fail.

**Proper fix:** Same as 1.2 — resolves itself on production cloud hosting. For local dev, document this in onboarding guide for all new developers.

---

## SECTION 2: Schema Inconsistencies

### 2.1 Diamond Type Naming Mismatch
**Severity: HIGH — active source of bugs**

| Table | Value used for Lab type |
|-------|------------------------|
| `diamond_rates_round` | `'Lab Grown'` |
| `diamond_rates_fancy` | `'Lab Grown'` |
| `solitaire_rates_core` | `'Lab'` |
| `solitaire_modifiers` | N/A |
| `product_delta_cache` | `'Lab'` |
| `api.calculate-price.jsx` | Converts: `diamond_type === "Lab" ? "Lab Grown" : "Natural"` |

**Problem:** Two different naming conventions for the same concept across the same database. Any new query written without knowing this will silently return no results.

**Proper fix:** Standardise all tables to use `'Lab Grown'` / `'Natural'` OR `'Lab'` / `'Natural'`. Requires a migration script to update all existing rows and update all queries.

---

### 2.2 All Numeric Values Stored as Strings
**Severity: MEDIUM**

The following columns store numbers as strings (VARCHAR/TEXT) instead of numeric types:
- `metal_rates.rate_per_gram`
- `product_specs_metal.weight_grams`
- `product_price_cache.lab_default_price` (and all price columns)

**Current workaround:** Every read requires `parseFloat()` in code. If forgotten, arithmetic silently produces wrong results (string concatenation instead of addition).

**Problem at scale:** With 5,000 products, a single missed `parseFloat()` produces wrong prices for all products using that code path — very hard to debug.

**Proper fix:** Migrate all numeric columns to `NUMERIC` or `DECIMAL` types in Supabase. Run a migration to cast existing string data to numbers.

---

### 2.3 Round vs Fancy Diamond Query Difference
**Severity: MEDIUM**

Round diamonds query `diamond_rates_round` with no shape filter. Fancy diamonds query `diamond_rates_fancy` with a shape filter. This logic is duplicated in both `api.calculate-price.jsx` and `api.recalculate-cache.jsx`.

**Problem at scale:** Any new developer adding a third query location will likely miss this distinction and produce wrong prices for fancy diamond products.

**Proper fix:** Extract diamond price lookup into a shared utility function used by both routes.

---

### 2.4 Cache Recalculation Not Triggered Automatically
**Severity: HIGH**

When metal rates, diamond rates, or product specs change in the admin, the `product_price_cache` and `product_delta_cache` are NOT automatically updated. Developer must manually run:
```bash
curl -X POST https://TUNNEL-URL/api/recalculate-cache -H "Content-Type: application/json" -d "{\"product_id\": \"gid://shopify/Product/PRODUCT_ID\", \"trigger\": \"manual\"}"
```

**Problem at scale:** With 5,000 products and daily rate changes (IBJA gold rates change every day), manually recalculating cache for every product is impossible.

**Proper fix:**
- Add webhook triggers in admin pages — when metal rates are saved, auto-trigger recalculate-cache for all products
- Add a "Recalculate All" button in admin that queues recalculation for all products
- Consider a scheduled job (cron) that recalculates all caches nightly after IBJA rate update

---

## SECTION 3: Scale Readiness Issues (5,000 Products / 50,000 Daily Visitors)

### 3.1 N+1 Query Problem in recalculate-cache
**Severity: HIGH for scale**

`api.recalculate-cache.jsx` makes an enormous number of sequential Supabase queries per product. For a product with all 4 components, a single recalculation makes approximately:
- ~50+ `calculatePrice()` calls (default + min + max + all deltas)
- Each `calculatePrice()` makes 4-10 Supabase queries
- **Total: ~200-500 database round trips per product recalculation**

At 5,000 products, a full recalculation would make ~1,000,000+ DB queries — this will timeout, exhaust connection limits, and take hours.

**Proper fix:**
- Batch-fetch all rates at start of recalculation (metal rates, diamond rates, solitaire rates, modifiers) into memory
- Pass rates as parameters to `calculatePrice()` instead of fetching inside
- This reduces DB queries from ~500 to ~15 per product recalculation
- Use Supabase connection pooling (pgBouncer)

---

### 3.2 Storefront Widget Makes API Call on Every Page Load
**Severity: HIGH for scale**

Every product page load triggers:
```javascript
fetch(`${APP_URL}/api/product-prices?product_id=...`)
```

At 50,000 daily visitors with average 3 product views each = **150,000 API calls/day** hitting your Fly.io/Railway server and then Supabase.

**Current situation:** This is fine for dev but will be expensive and slow at scale.

**Proper fix:**
- The `api.product-prices` endpoint already reads from `product_price_cache` (good) — ensure cache hit rate is near 100%
- Add HTTP caching headers to `api.product-prices` response (`Cache-Control: public, max-age=300`)
- Consider Shopify's CDN edge caching via App Proxy
- Long term: store prices directly in product metafields so no external API call is needed on page load

---

### 3.3 No Rate Limiting or Auth on Public API Endpoints
**Severity: HIGH for scale**

`/api/product-prices` and `/api/calculate-price` are completely open with `Access-Control-Allow-Origin: *`. Anyone can:
- Scrape all your product pricing
- Spam `/api/calculate-price` with arbitrary requests (expensive Supabase queries)
- DDOS your calculation endpoint

**Proper fix:**
- Add rate limiting middleware (e.g. 100 requests/minute per IP)
- For `calculate-price`, validate that `product_id` exists in your DB before running calculations
- Consider requiring a Shopify storefront token for API calls from the widget
- Add request signing (HMAC) between liquid widget and your API

---

### 3.4 recalculate-cache Has No Auth
**Severity: HIGH**

`/api/recalculate-cache` is a POST endpoint with no authentication. Anyone who knows the URL can trigger expensive recalculations for any product.

**Proper fix:** Add a secret key check:
```javascript
const { product_id, trigger, secret } = body;
if (secret !== process.env.RECALCULATE_SECRET) {
  return json({ success: false, error: 'Unauthorized' }, { status: 401 });
}
```

---

### 3.5 No Error Monitoring or Alerting
**Severity: MEDIUM**

If `calculatePrice()` fails silently (e.g. missing rate data), it returns `0` and the cache stores `0` as the price. Customers see ₹0 on the product page with no alert to the admin.

**Proper fix:**
- Add Sentry or similar error monitoring
- Add validation: if calculated price is 0 or suspiciously low, flag it and don't write to cache
- Add an admin dashboard showing cache health (last calculated, any errors)

---

### 3.6 Single Variant Assumption
**Severity: MEDIUM**

The widget hardcodes:
```javascript
id: {{ product.variants.first.id }}
```

This assumes every product has exactly one variant. If a product ever has multiple variants (e.g. ring sizes), the wrong variant may be added to cart.

**Proper fix:** Either enforce single-variant products in admin, or add variant selection to the widget before Add to Cart.

---

### 3.7 No Queue for Bulk Cache Recalculation
**Severity: HIGH for scale**

When gold rates change, ALL 5,000 products need cache recalculation. There is no queue system — attempting to recalculate all at once will:
- Exhaust Supabase connection limits
- Timeout the HTTP request
- Partially update cache (some products updated, some not)

**Proper fix:**
- Implement a job queue (e.g. Inngest, BullMQ, or Shopify's built-in background jobs)
- Process recalculations in batches of 50-100 products
- Show progress in admin UI

---

### 3.8 APP_URL Hardcoded — No Environment Variable
**Severity: MEDIUM**

`APP_URL` is hardcoded in the liquid file. There is no `.env`-based or metafield-based configuration.

**Proper fix:** Use Shopify App Proxy — requests go to `mystore.myshopify.com/apps/mycarat/api/...` which Shopify proxies to your server. URL never changes, no liquid file updates needed.

---

## SECTION 4: Code Quality Issues

### 4.1 Business Logic Duplicated Across Two Routes
`api.calculate-price.jsx` and `api.recalculate-cache.jsx` both implement the full price calculation logic independently. Any bug fix or business rule change must be made in two places.

**Fix:** Extract `calculatePrice()` into a shared utility at `app/utils/calculatePrice.server.js` and import it in both routes.

---

### 4.2 No Input Validation
Neither API route validates incoming parameters beyond checking if `product_id` is present. Invalid `metal_purity`, `diamond_type`, etc. cause silent failures.

**Fix:** Add Zod schema validation at the top of each action function.

---

### 4.3 No Database Indexes Documented
For 5,000 products, queries like:
```sql
SELECT * FROM product_delta_cache WHERE product_id = '...' 
SELECT * FROM solitaire_rates_core WHERE diamond_type = '...' AND colour = '...' AND clarity = '...' AND weight_range = '...'
```
will be slow without proper indexes.

**Fix:** Add indexes on:
- `product_delta_cache(product_id, diamond_type, component)`
- `product_price_cache(product_id)`
- `solitaire_rates_core(diamond_type, colour, clarity, weight_range)`
- `diamond_rates_round(diamond_type, colour_clarity, size_bucket)`
- `product_specs_metal(product_id)`
- All `product_specs_*` tables on `product_id`

---

## SECTION 5: Priority Order for Fixes

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | Deploy to permanent hosting (fix tunnel URL issue) | Medium | Unblocks everything |
| P0 | Auto-trigger cache recalculation on rate changes | Medium | Core business function |
| P1 | Batch DB queries in recalculate-cache | High | Required for 5K products |
| P1 | Add auth to recalculate-cache endpoint | Low | Security |
| P1 | Add rate limiting to public APIs | Low | Security + cost |
| P1 | Add DB indexes | Low | Performance |
| P2 | Standardise diamond type naming in DB | Medium | Schema hygiene |
| P2 | Migrate numeric columns from string to number | Medium | Data integrity |
| P2 | Extract shared calculatePrice utility | Low | Code maintainability |
| P2 | Add HTTP caching to product-prices API | Low | Performance |
| P3 | Add Sentry error monitoring | Low | Observability |
| P3 | Add input validation (Zod) | Medium | Reliability |
| P3 | Job queue for bulk recalculation | High | Scale requirement |
| P3 | Fix single variant assumption | Low | Correctness |
