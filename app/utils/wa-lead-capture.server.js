/**
 * WhatsApp lead capture (Phase 2b).
 *
 * Called on every inbound WhatsApp message. The first time a phone number
 * messages us, this:
 *   1. Creates a Supabase auth user (phone-confirmed, no OTP)
 *   2. Maps phone -> user_id in auth_phone_users
 *   3. Inserts a profile row with forced_from_lead = TRUE
 *   4. Initializes goldback_wallet
 *   5. Grants the 'signup' reward (10 GC) — same logic as
 *      api.claim-signup-reward.jsx so both paths converge on the same ledger
 *
 * Subsequent calls for the same phone return { isNew: false } and do nothing.
 *
 * Idempotency: signup_rewards_claimed has UNIQUE (user_id, reward_level), so
 * even if this function double-fires it cannot double-grant.
 */

import { supabase } from "../supabase.server";

const SIGNUP_REWARD_COINS = 10;

/**
 * @param {string} rawPhone — phone in any format (with or without leading +)
 * @param {object} opts — { name?, page?, intent? }
 * @returns {{ isNew: boolean, userId: string|null, error?: string }}
 */
export async function captureLeadIfNew(rawPhone, opts = {}) {
  const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;

  // Already mapped?
  const { data: existing } = await supabase
    .from("auth_phone_users")
    .select("user_id")
    .eq("phone", phone)
    .maybeSingle();

  if (existing?.user_id) {
    return { isNew: false, userId: existing.user_id };
  }

  // Mirror the existing OTP-flow pattern (api.verify-phone-otp.jsx):
  // synthetic deterministic email + phone metadata. Works even when Supabase's
  // phone-auth provider is disabled (only email is the actual auth method).
  const virtualEmail = `phone_${phone.replace("+", "")}@phone.auth.mycarat`;

  let userId = null;

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email:         virtualEmail,
    email_confirm: true,
    phone:         phone,
    phone_confirm: true,
    user_metadata: { phone, signup_method: "wa_first_contact" },
  });

  if (createErr) {
    // Race condition with the OTP flow — user may exist already by virtualEmail
    if (createErr.message?.includes("already been registered")) {
      const { data: { users } } = await supabase.auth.admin.listUsers();
      const found = users.find(u => u.email === virtualEmail);
      if (found) {
        userId = found.id;
      } else {
        console.error("[wa-lead-capture] createUser failed (and listUsers didn't find):", createErr.message);
        return { isNew: false, userId: null, error: createErr.message };
      }
    } else {
      console.error("[wa-lead-capture] createUser failed:", createErr.message);
      return { isNew: false, userId: null, error: createErr.message };
    }
  } else {
    userId = created.user.id;
  }

  if (!userId) {
    return { isNew: false, userId: null, error: "no userId resolved" };
  }

  // Map phone -> user_id (UNIQUE on phone — race-safe)
  const { error: mapErr } = await supabase
    .from("auth_phone_users")
    .insert({ phone, user_id: userId });
  if (mapErr && mapErr.code !== "23505") {
    console.error("[wa-lead-capture] auth_phone_users insert failed:", mapErr.message);
    // Continue anyway — non-fatal
  }

  // Profile row with lead flag
  const { error: profErr } = await supabase
    .from("profiles")
    .insert({
      id:                 userId,
      forced_from_lead:   true,
      wa_first_seen_at:   new Date().toISOString(),
      wa_first_seen_page: opts.page  || null,
      wa_first_intent:    opts.intent || null,
      full_name:          opts.name  || null,
    });
  if (profErr) {
    console.error("[wa-lead-capture] profiles insert failed:", profErr.message);
  }

  // Initialise wallet
  const { error: walletErr } = await supabase
    .from("goldback_wallet")
    .insert({ user_id: userId, balance_coins: 0 });
  if (walletErr) {
    console.error("[wa-lead-capture] goldback_wallet insert failed:", walletErr.message);
  }

  // Grant signup reward
  await grantSignupReward(userId);

  console.log(`[wa-lead-capture] new lead captured — phone=${phone} userId=${userId}`);
  return { isNew: true, userId };
}

/**
 * Mirrors the award path in api.claim-signup-reward.jsx for the 'signup'
 * level. UNIQUE (user_id, reward_level) makes this idempotent.
 */
async function grantSignupReward(userId) {
  const { error: claimErr } = await supabase
    .from("signup_rewards_claimed")
    .insert({
      user_id:      userId,
      reward_level: "signup",
      amount_coins: SIGNUP_REWARD_COINS,
    });

  if (claimErr) {
    if (claimErr.code === "23505") {
      console.log("[wa-lead-capture] signup reward already claimed for", userId);
      return;
    }
    console.error("[wa-lead-capture] reward ledger insert failed:", claimErr.message);
    return;
  }

  // Log transaction (best-effort)
  await supabase
    .from("goldback_transactions")
    .insert({
      user_id:      userId,
      type:         "earn",
      amount_coins: SIGNUP_REWARD_COINS,
      description:  "Signup reward: signup (10 Gold Coins) — auto from WhatsApp first contact",
    })
    .then(({ error }) => {
      if (error) console.error("[wa-lead-capture] txn log failed:", error.message);
    });

  // Increment wallet balance
  const { data: wallet } = await supabase
    .from("goldback_wallet")
    .select("balance_coins")
    .eq("user_id", userId)
    .single();

  if (wallet) {
    const newBalance = parseInt(wallet.balance_coins || 0) + SIGNUP_REWARD_COINS;
    await supabase
      .from("goldback_wallet")
      .update({ balance_coins: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else {
    await supabase
      .from("goldback_wallet")
      .insert({ user_id: userId, balance_coins: SIGNUP_REWARD_COINS });
  }
}
