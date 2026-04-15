/**
 * api.signup-reward-status.jsx
 * Returns which signup reward levels have been claimed by a user.
 *
 * GET /api/signup-reward-status?user_id=<uuid>
 */

import { supabase } from "../supabase.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");

  if (!userId) {
    return json({ error: "user_id is required" }, { status: 400 });
  }

  const { data: claims, error } = await supabase
    .from("signup_rewards_claimed")
    .select("reward_level, amount_coins, claimed_at")
    .eq("user_id", userId)
    .order("claimed_at");

  if (error) {
    console.error("[reward-status] query failed:", error.message);
    return json({ error: "Could not fetch reward status." }, { status: 500 });
  }

  const claimed = {};
  let totalCoins = 0;
  (claims || []).forEach(c => {
    claimed[c.reward_level] = { coins: c.amount_coins, claimed_at: c.claimed_at };
    totalCoins += c.amount_coins;
  });

  return json({
    claimed,
    total_coins_earned: totalCoins,
    levels: {
      signup: { coins: 10, claimed: !!claimed.signup },
      set_1:  { coins: 20, claimed: !!claimed.set_1 },
      set_2:  { coins: 30, claimed: !!claimed.set_2 },
      set_3:  { coins: 0,  claimed: false, coming_soon: true },
      set_4:  { coins: 0,  claimed: false, coming_soon: true },
    }
  });
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
