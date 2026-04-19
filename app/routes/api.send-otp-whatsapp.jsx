/**
 * api.send-otp-whatsapp.jsx
 * Step 1 of phone auth — generate OTP, store it, deliver via WhatsApp.
 *
 * POST /api/send-otp-whatsapp
 * Body: { phone }  — e.164 format e.g. +919876543210
 */

import crypto from "crypto";
import { supabase } from "../supabase.server";

const ACCESS_TOKEN    = process.env.WA_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const GRAPH_URL       = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

const OTP_EXPIRY_MINUTES = 10;

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

  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return json({ error: "Invalid phone number. Use international format e.g. +919876543210" }, { status: 400 });
  }

  // Rate limit — max 3 OTPs per phone per 10 minutes
  const { count } = await supabase
    .from("phone_otps")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .gt("expires_at", new Date().toISOString());

  if (count >= 3) {
    return json({ error: "Too many OTP requests. Please wait before trying again." }, { status: 429 });
  }

  // Generate 6-digit OTP
  const otp     = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = crypto.createHash("sha256").update(otp + phone).digest("hex");
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  // Delete any existing OTPs for this phone before inserting new one
  await supabase.from("phone_otps").delete().eq("phone", phone);

  // Store hashed OTP
  const { error: insertError } = await supabase
    .from("phone_otps")
    .insert({ phone, otp_hash: otpHash, expires_at: expiresAt });

  if (insertError) {
    console.error("[OTP] Failed to store OTP:", insertError.message);
    return json({ error: "Could not generate OTP. Please try again." }, { status: 500 });
  }

  // Send via WhatsApp using approved authentication template
  try {
    const res = await fetch(GRAPH_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: "mycarat_otp",
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: otp }]
            },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: otp }]
            }
          ]
        }
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[OTP] WhatsApp send failed:", JSON.stringify(data));
      await supabase.from("phone_otps").delete().eq("phone", phone);
      return json({ error: "Could not send WhatsApp message. Check that this number has WhatsApp." }, { status: 502 });
    }

    console.log(`[OTP] Sent to ${phone} — wa message id: ${data?.messages?.[0]?.id}`);
    return json({ success: true, expires_in: OTP_EXPIRY_MINUTES * 60 });

  } catch (err) {
    console.error("[OTP] Unexpected error:", err.message);
    await supabase.from("phone_otps").delete().eq("phone", phone);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
