/**
 * api.send-otp-whatsapp.jsx
 * Custom SMS sender for Supabase phone auth — delivers OTP via WhatsApp.
 *
 * Supabase calls this endpoint when a phone OTP needs to be sent.
 * Payload from Supabase: { phone, otp }
 *
 * POST /api/send-otp-whatsapp
 */

const ACCESS_TOKEN    = process.env.WA_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const GRAPH_URL       = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { phone, otp } = body;

  if (!phone || !otp) {
    return new Response(JSON.stringify({ error: "Missing phone or otp" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Normalise phone — Supabase sends e.164 format e.g. +919876543210
  const to = phone.replace(/\s+/g, "");

  const message = `Your MyCarat verification code is *${otp}*.\n\nValid for 10 minutes. Do not share this with anyone.`;

  try {
    const res = await fetch(GRAPH_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[OTP] WhatsApp send failed:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "WhatsApp delivery failed", detail: data }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[OTP] Sent to ${to} — message id: ${data?.messages?.[0]?.id}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[OTP] Unexpected error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
