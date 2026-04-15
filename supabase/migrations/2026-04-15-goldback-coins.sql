-- MyCarat — Goldback Accounting Fix: INR → Coins
-- Run in: https://supabase.com/dashboard/project/gyzgjckmeowmsosqgwkr/sql/new
-- 2026-04-15
--
-- First principle: 1 Gold Coin = 1mg gold. Coins are awarded, not INR.
-- INR value is always derived: coins × (gold_rate_per_gram / 1000)
--
-- No data migration needed — no users have existing balances.

-- ── goldback_wallet: rename balance_inr → balance_coins ──────────────────────
ALTER TABLE public.goldback_wallet
  RENAME COLUMN balance_inr TO balance_coins;

COMMENT ON COLUMN public.goldback_wallet.balance_coins IS
  'Number of Gold Coins (1 coin = 1mg gold). INR value derived at display time.';

-- ── goldback_transactions: rename amount_inr → amount_coins ──────────────────
ALTER TABLE public.goldback_transactions
  RENAME COLUMN amount_inr TO amount_coins;

COMMENT ON COLUMN public.goldback_transactions.amount_coins IS
  'Number of Gold Coins earned or redeemed in this transaction.';
