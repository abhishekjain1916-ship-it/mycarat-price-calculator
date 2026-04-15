-- MyCarat — Phone Auth Migration
-- Run in: https://supabase.com/dashboard/project/gyzgjckmeowmsosqgwkr/sql/new
-- 2026-04-15

-- ── phone_otps ────────────────────────────────────────────────────────────────
-- Temporary OTP store. Records are deleted on use or expiry.

CREATE TABLE IF NOT EXISTS public.phone_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  otp_hash    text NOT NULL,       -- SHA-256(otp + phone) — never store raw OTP
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Only one active OTP per phone at a time
CREATE UNIQUE INDEX IF NOT EXISTS phone_otps_phone_idx ON public.phone_otps(phone);

-- Row level security — only service role can read/write (no client access)
ALTER TABLE public.phone_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phone_otps: service only"
  ON public.phone_otps
  USING (false);   -- blocks all anon/user access; service role bypasses RLS


-- ── auth_phone_users ──────────────────────────────────────────────────────────
-- Maps phone number → Supabase user UUID.
-- Needed because Supabase doesn't expose a direct phone lookup without phone auth enabled.

CREATE TABLE IF NOT EXISTS public.auth_phone_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text NOT NULL UNIQUE,
  user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_phone_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_phone_users: service only"
  ON public.auth_phone_users
  USING (false);   -- service role only


-- ── Cleanup function — remove expired OTPs ───────────────────────────────────
-- Optional: run via a cron job or pg_cron if available on your plan.
-- Can also be triggered manually:
--   SELECT cleanup_expired_otps();

CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.phone_otps WHERE expires_at < now();
$$;
