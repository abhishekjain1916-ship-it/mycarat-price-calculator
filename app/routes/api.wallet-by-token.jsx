/**
 * GET /api/wallet-by-token?token=<signed-wallet-token>
 *
 * Read-only wallet snapshot for one user, authenticated by a short-lived
 * HMAC token issued in `wallet-token.server.js`. Used by the storefront
 * goldback-wallet page to render the right balance/history when a user
 * lands from a WhatsApp deep link (where no Supabase session cookie
 * exists).
 *
 * Returns:
 *   { balance_coins, transactions: [...], claimed_rewards: {...}, profile: {full_name, email} }
 */

import { supabase } from "../supabase.server";
import { verifyWalletToken } from "../utils/wallet-token.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",   // wallet page is on mycarat.in (cross-origin)
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url   = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  const userId = verifyWalletToken(token);
  if (!userId) {
    return json({ error: "Invalid or expired token" }, { status: 401 });
  }

  // ── 1. Wallet balance
  const { data: wallet } = await supabase
    .from("goldback_wallet")
    .select("balance_coins, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  // ── 2. Transactions (last 20, newest first)
  const { data: txns } = await supabase
    .from("goldback_transactions")
    .select("type, amount_coins, description, order_id, created_at, unlocks_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  // ── 3. Claimed rewards (so the page can decide whether to nudge for more)
  const { data: claimed } = await supabase
    .from("signup_rewards_claimed")
    .select("reward_level, amount_coins, claimed_at")
    .eq("user_id", userId);

  const claimedMap = {};
  for (const c of claimed || []) {
    claimedMap[c.reward_level] = { amount_coins: c.amount_coins, claimed_at: c.claimed_at };
  }

  // ── 4. Profile (for greeting + completeness hint)
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, gender, date_of_birth, anniversary, profession")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  const email = authUser?.user?.email && !authUser.user.email.endsWith("@phone.auth.mycarat")
    ? authUser.user.email
    : null;

  return json({
    user_id:         userId,
    balance_coins:   wallet?.balance_coins || 0,
    updated_at:      wallet?.updated_at || null,
    transactions:    txns || [],
    claimed_rewards: claimedMap,
    profile_complete: !!(profile?.full_name && profile?.gender && profile?.profession),
    profile: {
      full_name:     profile?.full_name || null,
      email,
    },
  });
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
