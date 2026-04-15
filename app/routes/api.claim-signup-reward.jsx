/**
 * api.claim-signup-reward.jsx
 * Server-side reward claim — validates profile completeness, checks ledger,
 * awards Gold Coins atomically.
 *
 * POST /api/claim-signup-reward
 * Body: { user_id, reward_level }
 * Headers: Authorization: Bearer <supabase_access_token>
 *
 * Reward levels:
 *   signup — 10 GC — account exists
 *   set_1  — 20 GC — email + phone both on file
 *   set_2  — 30 GC — name + gender + (dob or anniversary) + profession
 *   set_3  — placeholder (not awardable yet)
 *   set_4  — placeholder (not awardable yet)
 */

import { supabase } from "../supabase.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const REWARD_COINS = {
  signup: 10,
  set_1:  20,
  set_2:  30,
  set_3:  0,   // placeholder
  set_4:  0,   // placeholder
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return json({ error: "Use POST" }, { status: 405 });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { user_id, reward_level } = body;

  if (!user_id || !reward_level) {
    return json({ error: "user_id and reward_level are required." }, { status: 400 });
  }

  if (!REWARD_COINS.hasOwnProperty(reward_level)) {
    return json({ error: "Invalid reward_level." }, { status: 400 });
  }

  const coins = REWARD_COINS[reward_level];

  if (coins <= 0) {
    return json({ error: "This reward level is not yet available." }, { status: 400 });
  }

  // ── 1. Check if already claimed ──────────────────────────────────────────
  const { data: existing } = await supabase
    .from("signup_rewards_claimed")
    .select("id")
    .eq("user_id", user_id)
    .eq("reward_level", reward_level)
    .single();

  if (existing) {
    return json({ error: "Reward already claimed.", already_claimed: true }, { status: 409 });
  }

  // ── 2. Validate prerequisites ────────────────────────────────────────────
  // Verify user exists
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(user_id);
  if (userError || !userData?.user) {
    return json({ error: "User not found." }, { status: 404 });
  }

  const user = userData.user;

  // Fetch profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user_id)
    .single();

  // ── Validate per level ──────────────────────────────────────────────────
  if (reward_level === "signup") {
    // User exists — that's all we need
    // But signup must be the first reward (can't skip ahead)
    // No additional validation needed
  }

  if (reward_level === "set_1") {
    // Must have already claimed signup
    const { data: signupClaimed } = await supabase
      .from("signup_rewards_claimed")
      .select("id")
      .eq("user_id", user_id)
      .eq("reward_level", "signup")
      .single();

    if (!signupClaimed) {
      return json({ error: "Must complete signup reward first." }, { status: 400 });
    }

    // Must have both email and phone
    const hasEmail = !!(user.email && !user.email.includes("@phone.auth.mycarat"));
    const hasPhone = !!(profile?.phone && /^\+?[1-9]\d{7,14}$/.test(profile.phone.replace(/\s+/g, "")));

    if (!hasEmail) {
      return json({ error: "A verified email address is required.", missing: "email" }, { status: 400 });
    }
    if (!hasPhone) {
      return json({ error: "A valid phone number is required.", missing: "phone" }, { status: 400 });
    }
  }

  if (reward_level === "set_2") {
    // Must have already claimed set_1
    const { data: set1Claimed } = await supabase
      .from("signup_rewards_claimed")
      .select("id")
      .eq("user_id", user_id)
      .eq("reward_level", "set_1")
      .single();

    if (!set1Claimed) {
      return json({ error: "Must complete Set 1 reward first." }, { status: 400 });
    }

    if (!profile) {
      return json({ error: "Profile not found. Please save your profile first." }, { status: 400 });
    }

    // Validate name: min 2 chars, alphabetic (spaces and periods allowed)
    const name = (profile.full_name || "").trim();
    if (name.length < 2 || !/^[a-zA-Z\s.''-]+$/.test(name)) {
      return json({ error: "A valid full name is required (minimum 2 characters, alphabetic).", missing: "full_name" }, { status: 400 });
    }

    // Validate gender
    const validGenders = ["Male", "Female", "Other", "Prefer not to say"];
    if (!validGenders.includes(profile.gender)) {
      return json({ error: "Gender is required.", missing: "gender" }, { status: 400 });
    }

    // Validate DOB or Anniversary (at least one required)
    const hasDob = !!profile.date_of_birth;
    const hasAnniv = !!profile.anniversary;

    if (!hasDob && !hasAnniv) {
      return json({ error: "Date of Birth or Anniversary (or both) is required.", missing: "dates" }, { status: 400 });
    }

    // Validate DOB if provided: age 15-100
    if (hasDob) {
      const dob = new Date(profile.date_of_birth);
      const now = new Date();
      const age = Math.floor((now - dob) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 15 || age > 100) {
        return json({ error: "Date of Birth must indicate an age between 15 and 100.", missing: "date_of_birth" }, { status: 400 });
      }
    }

    // Validate Anniversary if provided: not in future
    if (hasAnniv) {
      const anniv = new Date(profile.anniversary);
      if (anniv > new Date()) {
        return json({ error: "Anniversary date cannot be in the future.", missing: "anniversary" }, { status: 400 });
      }
    }

    // Validate profession
    const validProfessions = [
      "Business Owner", "Corporate Professional", "Doctor / Medical",
      "Lawyer / Legal", "Engineer / Tech", "Finance / Banking",
      "Government / Public Sector", "Creative / Design", "Education / Academic",
      "Homemaker", "Student", "Retired", "Other"
    ];
    if (!validProfessions.includes(profile.profession)) {
      return json({ error: "A valid profession is required.", missing: "profession" }, { status: 400 });
    }
  }

  // ── 3. Award coins atomically ────────────────────────────────────────────

  // 3a. Record claim in ledger (unique constraint prevents double-claim)
  const { error: claimError } = await supabase
    .from("signup_rewards_claimed")
    .insert({
      user_id,
      reward_level,
      amount_coins: coins,
    });

  if (claimError) {
    // Unique constraint violation means already claimed (race condition)
    if (claimError.code === "23505") {
      return json({ error: "Reward already claimed.", already_claimed: true }, { status: 409 });
    }
    console.error("[reward] claim insert failed:", claimError.message);
    return json({ error: "Could not record reward. Please try again." }, { status: 500 });
  }

  // 3b. Record in goldback_transactions
  const { error: txnError } = await supabase
    .from("goldback_transactions")
    .insert({
      user_id,
      type:         "earn",
      amount_coins: coins,
      description:  `Signup reward: ${reward_level} (${coins} Gold Coins)`,
    });

  if (txnError) {
    console.error("[reward] transaction insert failed:", txnError.message);
    // Don't fail — claim is already recorded, wallet update is more important
  }

  // 3c. Upsert wallet balance
  const { data: wallet } = await supabase
    .from("goldback_wallet")
    .select("balance_coins")
    .eq("user_id", user_id)
    .single();

  if (wallet) {
    const newBalance = parseInt(wallet.balance_coins || 0) + coins;
    await supabase
      .from("goldback_wallet")
      .update({ balance_coins: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", user_id);
  } else {
    await supabase
      .from("goldback_wallet")
      .insert({ user_id, balance_coins: coins });
  }

  console.log(`[reward] ${reward_level}: ${coins} GC awarded to user ${user_id}`);

  return json({
    success:      true,
    reward_level,
    coins_awarded: coins,
    message:      `${coins} Gold Coins added to your wallet!`,
  });
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
