-- ============================================================
-- MyCarat — Supabase Schema
-- Run in: https://supabase.com/dashboard/project/gyzgjckmeowmsosqgwkr/sql/new
--
-- Covers:
--   MC-46  goldback_wallet + goldback_transactions
--   MC-47  wishlists
--   MC-49  shopify_orders (order sync from Shopify webhook)
--   MC-50  goldback accrual (unlocks_at, handled in webhook)
--   MC-48  bespoke_leads (bespoke capture funnel)
--
-- Run this entire file once. Safe to re-run — uses IF NOT EXISTS.
-- ============================================================


-- ──────────────────────────────────────────────
-- 0. bespoke_leads  (MC-48)
-- ──────────────────────────────────────────────
-- Storage bucket: create manually in Supabase dashboard
--   Storage > New bucket > Name: bespoke-uploads > Public: false
--   Then add policy: allow insert for all (anon + authenticated)

CREATE TABLE IF NOT EXISTS public.bespoke_leads (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at          TIMESTAMPTZ   DEFAULT now() NOT NULL,

  -- Which path the user chose
  path                TEXT          NOT NULL,
    -- 'this_product' | 'another_product' | 'something_else'

  -- This product path
  product_handle      TEXT,
  product_title       TEXT,
  product_url         TEXT,
  product_image_url   TEXT,

  -- Another mycarat product path (URL or name — one field, user enters either)
  reference_input     TEXT,

  -- Something else path
  reference_url       TEXT,         -- external URL pasted by user
  reference_image_url TEXT,         -- Supabase Storage path after upload

  -- Notes (optional, all paths)
  bespoke_notes       TEXT,

  -- Contact (compulsory)
  contact_name        TEXT          NOT NULL,
  contact_phone       TEXT          NOT NULL,
  contact_email       TEXT          NOT NULL,

  -- Preferred time to connect
  preferred_day       TEXT,         -- 'Today' | 'Tomorrow' | 'This week' | 'Weekend'
  preferred_time      TEXT,         -- 'Morning (9–12)' | 'Afternoon (12–5)' | 'Evening (5–8)'

  -- Auth — auto-captured if logged in
  customer_id         TEXT,         -- Shopify customer ID
  customer_email      TEXT,         -- from session

  -- Source
  source_page         TEXT,         -- URL of page where funnel was triggered

  -- Admin
  status              TEXT          NOT NULL DEFAULT 'new'
    -- 'new' | 'contacted' | 'in_progress' | 'closed'
);

-- RLS: service_role writes (via API route); authenticated users can read their own rows
ALTER TABLE public.bespoke_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access on bespoke_leads" ON public.bespoke_leads;
CREATE POLICY "service_role full access on bespoke_leads"
  ON public.bespoke_leads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users read own bespoke leads" ON public.bespoke_leads;
CREATE POLICY "users read own bespoke leads"
  ON public.bespoke_leads
  FOR SELECT
  TO authenticated
  USING (customer_email = auth.jwt() ->> 'email');


-- ──────────────────────────────────────────────
-- 1. shopify_orders  (MC-49)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shopify_orders (
  id                 UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id   TEXT         UNIQUE NOT NULL,
  user_id            UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  order_number       TEXT         NOT NULL,
  order_date         TIMESTAMPTZ  NOT NULL,
  status             TEXT         NOT NULL DEFAULT 'processing',
    -- processing | shipped | delivered | cancelled
  fulfillment_status TEXT,
  total_price        NUMERIC(12,2) DEFAULT 0,
  currency           TEXT          DEFAULT 'INR',
  line_items         JSONB         NOT NULL DEFAULT '[]',
    -- [{product_id, variant_id, title, image_url, quantity, price,
    --   properties, ingredient_breakdown, certificate}]
  tracking_number    TEXT,
  tracking_url       TEXT,
  carrier            TEXT,
  estimated_delivery DATE,          -- populated by admin / fulfilment team
  created_at         TIMESTAMPTZ   DEFAULT now(),
  updated_at         TIMESTAMPTZ   DEFAULT now()
);

-- Add columns that may be missing if table already existed
ALTER TABLE public.shopify_orders ADD COLUMN IF NOT EXISTS estimated_delivery DATE;
ALTER TABLE public.shopify_orders ADD COLUMN IF NOT EXISTS tracking_number    TEXT;
ALTER TABLE public.shopify_orders ADD COLUMN IF NOT EXISTS tracking_url       TEXT;
ALTER TABLE public.shopify_orders ADD COLUMN IF NOT EXISTS carrier            TEXT;

CREATE INDEX IF NOT EXISTS shopify_orders_user_id_idx
  ON public.shopify_orders (user_id);

CREATE INDEX IF NOT EXISTS shopify_orders_order_date_idx
  ON public.shopify_orders (order_date DESC);

-- RLS: users can only read their own orders
ALTER TABLE public.shopify_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own orders" ON public.shopify_orders;
CREATE POLICY "Users read own orders"
  ON public.shopify_orders FOR SELECT
  USING (auth.uid() = user_id);

-- Webhook handler uses service_role key → bypasses RLS for INSERT/UPDATE


-- ──────────────────────────────────────────────
-- 2. goldback_wallet  (MC-46)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goldback_wallet (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID         UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_inr NUMERIC(12,2) DEFAULT 0,
  created_at  TIMESTAMPTZ  DEFAULT now(),
  updated_at  TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE public.goldback_wallet ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own wallet" ON public.goldback_wallet;
CREATE POLICY "Users read own wallet"
  ON public.goldback_wallet FOR SELECT
  USING (auth.uid() = user_id);

-- Webhook handler uses service_role → bypasses RLS for INSERT/UPDATE


-- ──────────────────────────────────────────────
-- 3. goldback_transactions  (MC-46 / MC-50)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goldback_transactions (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id    TEXT,                      -- Shopify order ID (nullable for manual/redeems)
  type        TEXT         NOT NULL DEFAULT 'earn',
    -- earn | redeem
  amount_inr  NUMERIC(12,2) NOT NULL,
  description TEXT,
  unlocks_at  TIMESTAMPTZ  DEFAULT (now() + INTERVAL '30 days'),
    -- MC-50: earned Goldback is locked for 30 days
  created_at  TIMESTAMPTZ  DEFAULT now()
);

-- Add unlocks_at if table already existed without it
ALTER TABLE public.goldback_transactions
  ADD COLUMN IF NOT EXISTS unlocks_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days');

CREATE INDEX IF NOT EXISTS goldback_txn_user_id_idx
  ON public.goldback_transactions (user_id);

CREATE INDEX IF NOT EXISTS goldback_txn_unlocks_at_idx
  ON public.goldback_transactions (unlocks_at);

ALTER TABLE public.goldback_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own transactions" ON public.goldback_transactions;
CREATE POLICY "Users read own transactions"
  ON public.goldback_transactions FOR SELECT
  USING (auth.uid() = user_id);


-- ──────────────────────────────────────────────
-- 4. wishlists  (MC-47)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wishlists (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shopify_product_id  TEXT         NOT NULL,
  product_handle      TEXT,
  product_title       TEXT,
  product_image_url   TEXT,
  lg_price            NUMERIC(12,2),
  natural_price       NUMERIC(12,2),
  added_at            TIMESTAMPTZ  DEFAULT now(),

  UNIQUE (user_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS wishlists_user_id_idx
  ON public.wishlists (user_id);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own wishlist" ON public.wishlists;
CREATE POLICY "Users read own wishlist"
  ON public.wishlists FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own wishlist" ON public.wishlists;
CREATE POLICY "Users manage own wishlist"
  ON public.wishlists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ──────────────────────────────────────────────
-- 5. recalc_queue  (INF-07 — background price rebuild queue)
-- ──────────────────────────────────────────────
-- Written by the admin UI and daily cron; processed by recalc-worker.server.js
CREATE TABLE IF NOT EXISTS public.recalc_queue (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id   TEXT         NOT NULL,
  status       TEXT         NOT NULL DEFAULT 'pending',
    -- pending | processing | done | failed
  priority     INTEGER      DEFAULT 0,
    -- 0 = normal (daily cron / rate save), 1 = high (manual per-product)
  attempted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recalc_queue_status_priority_idx
  ON public.recalc_queue (status, priority DESC, created_at ASC);

-- No RLS needed — only accessed via service_role key from the app server
-- Old done/failed rows can be pruned periodically; they are not user-facing


-- ──────────────────────────────────────────────
-- 6. Webhook helper function  (already in supabase_webhook_helpers.sql)
--    Included here for completeness — safe to re-run.
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE email = p_email LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;


-- ──────────────────────────────────────────────
-- Done.
-- After running this:
--   1. Verify tables exist in Supabase Table Editor
--   2. Reinstall price calculator app (INF-06) to register webhooks on live store
--   3. Place a test order to verify orders/paid webhook fires
-- ──────────────────────────────────────────────
