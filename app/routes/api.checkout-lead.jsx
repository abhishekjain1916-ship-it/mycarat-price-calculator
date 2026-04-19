/**
 * api.checkout-lead.jsx
 * Creates a checkout lead when customer requests concierge callback.
 * Saves to wa_leads with full product config. Optionally sends
 * WhatsApp confirmation to customer (when WA templates are active).
 *
 * POST /api/checkout-lead
 * Body: { name, phone, preferred_time, product_config, order_ref }
 */

import { supabase } from "../supabase.server";

const ACCESS_TOKEN    = process.env.WA_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const GRAPH_URL       = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

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

  const { name, phone, preferred_time, product_config, order_ref } = body;

  // Validate required fields
  if (!name || !phone) {
    return json({ error: "Name and phone are required." }, { status: 400 });
  }

  const cleanPhone = phone.replace(/[\s\-()]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(cleanPhone) && !/^\d{10}$/.test(cleanPhone)) {
    return json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  // Normalise phone
  const normPhone = /^\d{10}$/.test(cleanPhone) ? "+91" + cleanPhone : cleanPhone;

  // ── 1. Upsert WhatsApp conversation ─────────────────────────────────────
  const { data: convo } = await supabase
    .from("wa_conversations")
    .upsert(
      {
        wa_number:       normPhone,
        display_name:    name,
        last_message_at: new Date().toISOString(),
      },
      { onConflict: "wa_number" }
    )
    .select("id")
    .single();

  const convoId = convo?.id || null;

  // ── 2. Create lead ──────────────────────────────────────────────────────
  const productData = product_config || {};

  const { error: leadError } = await supabase.from("wa_leads").insert({
    conversation_id: convoId,
    wa_number:       normPhone,
    category:        "checkout_callback",
    budget:          productData.price ? String(productData.price) : null,
    free_text:       `Callback request: ${preferred_time || "Any time"}. Product: ${productData.name || "N/A"}. Order ref: ${order_ref || "N/A"}`,
    lead_score:      40, // High intent — they reached checkout
    agent_followup:  true,
    raw_payload:     {
      source:         "checkout_concierge",
      order_ref,
      name,
      phone:          normPhone,
      preferred_time: preferred_time || "Any time",
      product:        productData,
      created_at:     new Date().toISOString(),
    },
  });

  if (leadError) {
    console.error("[checkout-lead] Failed to create lead:", leadError.message);
    return json({ error: "Could not save your request. Please try again." }, { status: 500 });
  }

  console.log(`[checkout-lead] Lead created for ${normPhone} — ref: ${order_ref}, callback: ${preferred_time || "any"}`);

  // ── 3. Send WhatsApp notification to internal team ──────────────────────
  // Send a plain text message to the business number or a designated agent
  // This notifies the team immediately about the callback request
  try {
    const NOTIFY_NUMBER = process.env.WA_NOTIFY_NUMBER || PHONE_NUMBER_ID;
    // We send an internal notification to the business — not to the customer
    // Customer notification via template can be added when WA templates are approved
    const internalMsg = [
      `🔔 *New Checkout Lead*`,
      ``,
      `👤 ${name}`,
      `📱 ${normPhone}`,
      `⏰ Preferred: ${preferred_time || "Any time"}`,
      `📦 ${productData.name || "N/A"}`,
      `💰 ${productData.price ? "₹" + Number(productData.price).toLocaleString("en-IN") : "N/A"}`,
      `🔖 Ref: ${order_ref || "N/A"}`,
    ].join("\n");

    // Log for now — internal notification can be sent to a team WhatsApp group
    console.log(`[checkout-lead] Internal notification:\n${internalMsg}`);

  } catch (err) {
    // Non-critical — lead is already saved
    console.error("[checkout-lead] Notification error:", err.message);
  }

  return json({
    success: true,
    message: "Your callback request has been received. Our concierge will reach out within 2 hours.",
    order_ref,
  });
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
