/**
 * api.verify-phone-otp.jsx
 * Step 2 of phone auth — verify OTP, create/get Supabase user, return magic token.
 *
 * POST /api/verify-phone-otp
 * Body: { phone, otp }
 *
 * Returns: { virtual_email, token } — frontend uses these to call
 *   supabase.auth.verifyOtp({ email: virtual_email, token, type: 'magiclink' })
 *   which establishes a real Supabase session.
 */

import crypto from "crypto";
import { supabase } from "../supabase.server";

const MAX_ATTEMPTS = 5;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

  const phone = (body.phone || "").replace(/\s+/g, "");
  const otp   = (body.otp   || "").replace(/\D/g, "");

  if (!phone || !otp || otp.length !== 6) {
    return json({ error: "Phone and 6-digit OTP are required." }, { status: 400 });
  }

  // Fetch stored OTP record
  const { data: record, error: fetchError } = await supabase
    .from("phone_otps")
    .select("*")
    .eq("phone", phone)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (fetchError || !record) {
    return json({ error: "OTP expired or not found. Please request a new one." }, { status: 400 });
  }

  // Check attempt limit
  if (record.attempts >= MAX_ATTEMPTS) {
    await supabase.from("phone_otps").delete().eq("phone", phone);
    return json({ error: "Too many incorrect attempts. Please request a new OTP." }, { status: 400 });
  }

  // Verify hash
  const expectedHash = crypto.createHash("sha256").update(otp + phone).digest("hex");

  if (record.otp_hash !== expectedHash) {
    // Increment attempts
    await supabase
      .from("phone_otps")
      .update({ attempts: record.attempts + 1 })
      .eq("phone", phone);
    const remaining = MAX_ATTEMPTS - record.attempts - 1;
    return json({ error: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` }, { status: 400 });
  }

  // OTP valid — delete it immediately (one-time use)
  await supabase.from("phone_otps").delete().eq("phone", phone);

  // ── Create or retrieve Supabase user ────────────────────────────────────────
  // Phone users get a deterministic virtual email (never shown to them)
  const virtualEmail = `phone_${phone.replace("+", "")}@phone.auth.mycarat`;

  let userId;

  // Check if user already exists by phone metadata
  const { data: existing } = await supabase
    .from("auth_phone_users")
    .select("user_id")
    .eq("phone", phone)
    .single();

  if (existing?.user_id) {
    userId = existing.user_id;
  } else {
    // Create new Supabase user
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email:          virtualEmail,
      email_confirm:  true,
      phone:          phone,
      phone_confirm:  true,
      user_metadata:  { phone, signup_method: "phone_whatsapp" },
    });

    if (createError) {
      // User may already exist with this virtual email (race condition) — look them up
      if (createError.message?.includes("already been registered")) {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const found = users.find(u => u.email === virtualEmail);
        if (!found) {
          console.error("[OTP] Could not create or find user:", createError.message);
          return json({ error: "Account setup failed. Please try again." }, { status: 500 });
        }
        userId = found.id;
      } else {
        console.error("[OTP] User creation failed:", createError.message);
        return json({ error: "Account setup failed. Please try again." }, { status: 500 });
      }
    } else {
      userId = created.user.id;

      // Record phone → userId mapping
      await supabase.from("auth_phone_users").insert({ phone, user_id: userId });
    }
  }

  // ── Generate session directly ────────────────────────────────────────────────
  // Magic link token exchange doesn't work with sb_publishable keys.
  // Instead, use admin.generateLink to verify the email, then return the
  // action_link URL. Frontend redirects to it — Supabase handles the session.
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type:    "magiclink",
    email:   virtualEmail,
    options: { redirectTo: "https://mycarat.in/pages/account" },
  });

  if (linkError) {
    console.error("[OTP] generateLink failed:", linkError.message);
    return json({ error: "Session creation failed. Please try again." }, { status: 500 });
  }

  const actionLink = linkData.properties?.action_link || "";

  if (!actionLink) {
    console.error("[OTP] No action_link returned");
    return json({ error: "Session creation failed. Please try again." }, { status: 500 });
  }

  console.log(`[OTP] Phone auth success for ${phone} — user ${userId}`);

  return json({
    success:     true,
    action_link: actionLink,
  });
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
