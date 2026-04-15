-- MyCarat — Signup Rewards + Profile Extensions
-- Run in: https://supabase.com/dashboard/project/gyzgjckmeowmsosqgwkr/sql/new
-- 2026-04-15
--
-- Adds new profile fields for Set 2 rewards + signup_rewards_claimed ledger.

-- ── Extend profiles table with new fields ────────────────────────────────────

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text
  CHECK (gender IN ('Male', 'Female', 'Other', 'Prefer not to say'));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth date;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS anniversary date;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profession text;

-- ── signup_rewards_claimed ────────────────────────────────────────────────────
-- Ledger tracking which reward levels have been claimed.
-- UNIQUE constraint ensures each level can only be claimed once per user.
-- Rows are never deleted — this is the anti-abuse backbone.

CREATE TABLE IF NOT EXISTS public.signup_rewards_claimed (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reward_level  text NOT NULL CHECK (reward_level IN ('signup', 'set_1', 'set_2', 'set_3', 'set_4')),
  amount_coins  integer NOT NULL,
  claimed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reward_level)
);

-- ON DELETE RESTRICT: prevents user account deletion if they have claimed rewards.
-- This is intentional — accounts with rewards cannot be deleted.

ALTER TABLE public.signup_rewards_claimed ENABLE ROW LEVEL SECURITY;

-- Users can read their own claims (for frontend progress display)
CREATE POLICY "signup_rewards: read own"
  ON public.signup_rewards_claimed FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert (server-side claim endpoint)
CREATE POLICY "signup_rewards: service insert"
  ON public.signup_rewards_claimed FOR INSERT
  WITH CHECK (false);  -- blocks anon/user; service role bypasses RLS

-- No update or delete policies — claims are immutable

-- ── Prevent profile deletion ─────────────────────────────────────────────────
-- Drop any existing delete policy on profiles and replace with a blocking one.

DROP POLICY IF EXISTS "profiles: delete own" ON public.profiles;

-- No delete policy = no deletion allowed via anon/user role.
-- Service role can still delete if needed for admin operations.

-- ── Also prevent address deletion abuse (optional safeguard) ─────────────────
-- Addresses aren't part of rewards, so we keep delete for now.
-- If needed later, we can restrict this too.
