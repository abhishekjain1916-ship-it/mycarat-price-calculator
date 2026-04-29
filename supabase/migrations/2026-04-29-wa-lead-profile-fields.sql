-- ────────────────────────────────────────────────────────────────────────────
-- Phase 2b — WhatsApp lead capture
--
-- Extend public.profiles with fields that mark a user as auto-created from
-- a WhatsApp first-contact (vs an explicit website signup), and capture the
-- page + intent context.
--
-- Purely additive — no DROPs, no destructive ops, all `IF NOT EXISTS`.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS forced_from_lead   BOOLEAN     NOT NULL DEFAULT FALSE;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wa_first_seen_at   TIMESTAMPTZ;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wa_first_seen_page TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wa_first_intent    TEXT;

-- Partial index so we can quickly find/segment lead-origin profiles
CREATE INDEX IF NOT EXISTS profiles_forced_from_lead_idx
  ON public.profiles (forced_from_lead)
  WHERE forced_from_lead = TRUE;

COMMENT ON COLUMN public.profiles.forced_from_lead IS
  'TRUE when the profile was auto-created from a WhatsApp first-contact (Phase 2b).';
COMMENT ON COLUMN public.profiles.wa_first_seen_at IS
  'UTC timestamp of the user''s first WhatsApp message to us.';
COMMENT ON COLUMN public.profiles.wa_first_seen_page IS
  'Which page the user was on when they tapped the WA icon (home/listing/product/checkout).';
COMMENT ON COLUMN public.profiles.wa_first_intent IS
  'Inferred first intent from page context (e.g. category name, product title).';
