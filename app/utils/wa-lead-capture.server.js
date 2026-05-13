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

  // Profile row with lead flag.
  // `profiles.user_id` is NOT NULL (separate from `id`), so set both.
  const { error: profErr } = await supabase
    .from("profiles")
    .insert({
      id:                 userId,
      user_id:            userId,
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

/**
 * Look up an existing auth.users row by email (case-insensitive). Returns the
 * uuid or null. Wraps the existing `get_user_id_by_email` RPC (also used by
 * webhooks.orders.paid.jsx).
 */
export async function findUserIdByEmail(email) {
  if (!email) return null;
  const { data, error } = await supabase
    .rpc("get_user_id_by_email", { p_email: email.toLowerCase().trim() });
  if (error) {
    console.warn("[wa-lead-capture] user lookup by email failed:", error.message);
    return null;
  }
  return data || null;
}

/**
 * Email-collision merge: re-link a phone + all WA-created data from the
 * synthetic auth user to an existing (real-email) auth user, then delete
 * the synthetic. Idempotent; safe to call when realUserId === syntheticUserId
 * (no-op).
 *
 * @param {string} phone — E.164 ("+91...")
 * @param {string} syntheticUserId — the auth.users row created by captureLeadIfNew
 * @param {string} realUserId — the existing auth.users row matching the email
 * @returns {{ ok: boolean, mergedRewards: number, mergedCoins: number }}
 */
export async function mergePhoneIntoExistingUser(phone, syntheticUserId, realUserId) {
  if (syntheticUserId === realUserId) {
    return { ok: true, mergedRewards: 0, mergedCoins: 0, noOp: true };
  }

  // 1. Re-link phone mapping
  const { error: mapErr } = await supabase
    .from("auth_phone_users")
    .update({ user_id: realUserId })
    .eq("phone", phone);
  if (mapErr) {
    console.error("[wa-lead-capture/merge] auth_phone_users relink failed:", mapErr.message);
  }

  // 2. Migrate signup_rewards_claimed (dedupe against UNIQUE(user_id, reward_level))
  let mergedRewards = 0;
  const { data: synthRewards } = await supabase
    .from("signup_rewards_claimed")
    .select("*")
    .eq("user_id", syntheticUserId);
  for (const r of synthRewards || []) {
    const { data: dupe } = await supabase
      .from("signup_rewards_claimed")
      .select("id")
      .eq("user_id", realUserId)
      .eq("reward_level", r.reward_level)
      .maybeSingle();
    if (dupe) {
      // Existing real user already claimed this level — drop the synth row
      await supabase.from("signup_rewards_claimed").delete().eq("id", r.id);
    } else {
      // Re-attribute to canonical user
      await supabase
        .from("signup_rewards_claimed")
        .update({ user_id: realUserId })
        .eq("id", r.id);
      mergedRewards += 1;
    }
  }

  // 3. Migrate goldback_transactions wholesale (no uniqueness constraint)
  await supabase
    .from("goldback_transactions")
    .update({ user_id: realUserId })
    .eq("user_id", syntheticUserId);

  // 4. Merge wallets — sum balances onto canonical user, drop synth wallet
  let mergedCoins = 0;
  const { data: synthWallet } = await supabase
    .from("goldback_wallet")
    .select("balance_coins")
    .eq("user_id", syntheticUserId)
    .maybeSingle();
  if (synthWallet && parseInt(synthWallet.balance_coins || 0) > 0) {
    mergedCoins = parseInt(synthWallet.balance_coins);
    const { data: realWallet } = await supabase
      .from("goldback_wallet")
      .select("balance_coins")
      .eq("user_id", realUserId)
      .maybeSingle();
    if (realWallet) {
      await supabase
        .from("goldback_wallet")
        .update({
          balance_coins: parseInt(realWallet.balance_coins || 0) + mergedCoins,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", realUserId);
    } else {
      await supabase
        .from("goldback_wallet")
        .insert({ user_id: realUserId, balance_coins: mergedCoins });
    }
  }
  await supabase.from("goldback_wallet").delete().eq("user_id", syntheticUserId);

  // 5. Merge profile — fill any gaps on the canonical profile from the synth,
  //    then delete the synth profile. (We do NOT overwrite real profile fields
  //    that are already populated.)
  const { data: synthProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", syntheticUserId)
    .maybeSingle();
  if (synthProfile) {
    const { data: realProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", realUserId)
      .maybeSingle();
    const mergeable = [
      "full_name", "gender", "date_of_birth", "anniversary", "profession",
      "wa_first_seen_at", "wa_first_seen_page", "wa_first_intent",
    ];
    if (realProfile) {
      const updates = {};
      for (const key of mergeable) {
        if (synthProfile[key] && !realProfile[key]) updates[key] = synthProfile[key];
      }
      // forced_from_lead = TRUE if either side was lead-originated
      if (synthProfile.forced_from_lead && !realProfile.forced_from_lead) {
        updates.forced_from_lead = true;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from("profiles").update(updates).eq("user_id", realUserId);
      }
      await supabase.from("profiles").delete().eq("user_id", syntheticUserId);
    } else {
      // No real profile — re-key the synth profile onto the real user
      await supabase
        .from("profiles")
        .update({ id: realUserId, user_id: realUserId })
        .eq("user_id", syntheticUserId);
    }
  }

  // 6. Drop the synthetic auth.users row (last so FK cascades don't surprise)
  const { error: delErr } = await supabase.auth.admin.deleteUser(syntheticUserId);
  if (delErr) {
    console.warn("[wa-lead-capture/merge] synth auth delete failed:", delErr.message);
  }

  console.log(`[wa-lead-capture/merge] phone=${phone} merged synth=${syntheticUserId} into real=${realUserId} (rewards=${mergedRewards} coins=${mergedCoins})`);
  return { ok: true, mergedRewards, mergedCoins };
}
