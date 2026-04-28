/**
 * WhatsApp Business API — Webhook
 * Last updated: 2026-04-11
 *
 * GET  /api/whatsapp-webhook  — Meta verification handshake
 * POST /api/whatsapp-webhook  — Incoming messages + status updates
 *
 * Meta docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 */

import { supabase } from "../supabase.server";
import { createSchedule } from "../utils/wa-scheduler.server";

const VERIFY_TOKEN    = process.env.WA_VERIFY_TOKEN   || "mycarat_wa_verify";
const ACCESS_TOKEN    = process.env.WA_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const FLOW_ID_FIND    = "4318987678414529";

const GRAPH_URL = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

// ── GET: Meta webhook verification ──────────────────────────────────────────
export const loader = async ({ request }) => {
  const url       = new URL(request.url);
  const mode      = url.searchParams.get("hub.mode");
  const token     = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[WA webhook] Verified successfully");
    return new Response(challenge, { status: 200 });
  }

  console.warn("[WA webhook] Verification failed — token mismatch or wrong mode");
  return new Response("Forbidden", { status: 403 });
};

// ── POST: Incoming messages + delivery status updates ───────────────────────
export const action = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const entries = body?.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value;

      if (value?.messages?.length) {
        for (const msg of value.messages) {
          await handleIncomingMessage(msg, value.metadata);
        }
      }

      if (value?.statuses?.length) {
        for (const status of value.statuses) {
          handleStatusUpdate(status);
        }
      }
    }
  }

  return new Response("OK", { status: 200 });
};

// ── Handle incoming message ──────────────────────────────────────────────────
async function handleIncomingMessage(msg, metadata) {
  const from    = msg.from;
  const msgType = msg.type;

  console.log(`[WA] Message from ${from} — type: ${msgType}`);

  // Ensure conversation record exists
  const conversation = await upsertConversation(from);

  // Save inbound message
  await saveMessage({
    conversationId: conversation.id,
    waMessageId:    msg.id,
    direction:      "inbound",
    messageType:    msgType,
    body:           msg.text?.body || null,
    metadata:       msg,
  });

  // ── Flow completion (customer submitted the Find Something form) ──
  if (msgType === "interactive" && msg.interactive?.type === "nfm_reply") {
    await handleFlowCompletion(from, conversation.id, msg.interactive.nfm_reply);
    return;
  }

  // ── Button reply ──
  if (msgType === "interactive" && msg.interactive?.type === "button_reply") {
    const buttonId = msg.interactive.button_reply.id;
    if (buttonId === "find_something") {
      await sendFlow(from);
    } else if (buttonId === "have_question") {
      await sendTextMessage(from,
        "Of course! 😊 Go ahead and type your question — we're here to help."
      );
    }
    return;
  }

  // ── First text message — send welcome ──
  if (msgType === "text") {
    await sendWelcomeMessage(from);
  }
}

// ── Handle flow completion ───────────────────────────────────────────────────
async function handleFlowCompletion(waNumber, conversationId, nfmReply) {
  let payload;
  try {
    payload = JSON.parse(nfmReply.response_json);
  } catch {
    console.error("[WA] Failed to parse flow response JSON");
    return;
  }

  console.log(`[WA] Flow completed by ${waNumber}:`, payload);

  // Route by payload shape — mc_scheduling_v1 has `mode` + `date` + `time`
  if (payload.mode && payload.date && payload.time) {
    return handleSchedulingFlowCompletion(waNumber, payload);
  }

  // Otherwise — original Find Something flow handler (FLOW_ID_FIND)
  const { category, budget, diamond_style, occasions, free_text } = payload;

  // Calculate lead score
  let score = 0;
  if (category && category !== "surprise") score += 5;
  if (budget && budget !== "skip")         score += 15;
  if (diamond_style)                       score += 5;
  if (occasions && occasions.length > 0)   score += 10;
  if (free_text && free_text.trim())       score += 10;

  const agentFollowup = score >= 25;

  // Save lead to Supabase
  await supabase.from("wa_leads").insert({
    conversation_id: conversationId,
    wa_number:       waNumber,
    flow_id:         FLOW_ID_FIND,
    category,
    occasions:       Array.isArray(occasions) ? occasions.join(",") : (occasions || ""),
    budget,
    diamond_style,
    free_text:       free_text || null,
    lead_score:      score,
    agent_followup:  agentFollowup,
    raw_payload:     payload,
  });

  console.log(`[WA] Lead saved — score: ${score}, followup: ${agentFollowup}`);

  // Build collection URL
  const collectionUrl = buildCollectionUrl(category, budget, diamond_style);

  // Send reply
  const reply = buildReplyMessage(category, budget, collectionUrl, agentFollowup);
  await sendTextMessage(waNumber, reply);
}

// ── Handle scheduling flow (mc_scheduling_v1) ────────────────────────────────
async function handleSchedulingFlowCompletion(waNumber, payload) {
  const result = await createSchedule({
    waPhone:        waNumber.startsWith("+") ? waNumber : `+${waNumber}`,
    waName:         null,                       // we don't get name in flow payload reliably
    payload,
    triggerContext: payload._context || null,   // optional context attached by client
  });

  if (!result.ok) {
    await sendTextMessage(waNumber, `Hmm — ${result.error} Please try again.`);
    return;
  }

  // Confirmation template was already sent by createSchedule().
  // Send a friendly free-form follow-up too (we're inside the 24-hr window).
  await sendTextMessage(
    waNumber,
    "All set! 📅 You'll get a reminder 15 minutes before our chat. Looking forward to it!"
  );
}

// ── Build filtered collection URL ────────────────────────────────────────────
function buildCollectionUrl(category, budget, diamondStyle) {
  const base = category && category !== "surprise"
    ? `https://mycarat.in/collections/all-${category}`
    : "https://mycarat.in/collections/all";

  const params = new URLSearchParams();
  if (budget && budget !== "skip")                      params.set("price", budget);
  if (diamondStyle && diamondStyle !== "no-preference") params.set("style", diamondStyle === "solitaire" ? "solitaire" : "");

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ── Build reply message ───────────────────────────────────────────────────────
function buildReplyMessage(category, budget, collectionUrl, agentFollowup) {
  const categoryLabel = category && category !== "surprise"
    ? category.charAt(0).toUpperCase() + category.slice(1)
    : "jewellery";

  let msg = `Thank you so much! 🥰 We loved learning what you're looking for.\n\n`;

  if (budget && budget !== "skip") {
    msg += `Here's a curated selection of ${categoryLabel} in your budget 💎\n${collectionUrl}\n\n`;
  } else {
    msg += `Here's our ${categoryLabel} collection for you to explore ✨\n${collectionUrl}\n\n`;
  }

  if (agentFollowup) {
    msg += `One of our jewellery experts will reach out to you shortly with personalised picks 🌟`;
  } else {
    msg += `Feel free to ask us anything — we're always here to help! 💛`;
  }

  return msg;
}

// ── Send welcome message ──────────────────────────────────────────────────────
async function sendWelcomeMessage(to) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "Hi! Welcome to MyCarat 👋\n\nWe're here to help you find the perfect diamond jewellery.\n\nWhat brings you here today?",
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "find_something", title: "Find something 💍" } },
          { type: "reply", reply: { id: "have_question",  title: "I have a question" } },
        ],
      },
    },
  };
  await sendToMeta(payload);
}

// ── Send flow trigger message ─────────────────────────────────────────────────
async function sendFlow(to) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      body: {
        text: "Let's find the perfect piece for you! ✨\n\nAnswer a few quick questions and we'll curate picks just for you.",
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id:     FLOW_ID_FIND,
          flow_cta:    "Let's go! 💍",
          flow_action: "navigate",
          flow_action_payload: {
            screen: "CATEGORY",
          },
        },
      },
    },
  };
  await sendToMeta(payload);
}

// ── Send plain text message ───────────────────────────────────────────────────
async function sendTextMessage(to, text) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  await sendToMeta(payload);
}

// ── POST to Meta Graph API ────────────────────────────────────────────────────
async function sendToMeta(payload) {
  try {
    const res = await fetch(GRAPH_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[WA] Meta API error:", JSON.stringify(data));
    } else {
      console.log("[WA] Message sent:", data?.messages?.[0]?.id);
    }
  } catch (err) {
    console.error("[WA] sendToMeta failed:", err.message);
  }
}

// ── Upsert conversation ───────────────────────────────────────────────────────
async function upsertConversation(waNumber) {
  const { data, error } = await supabase
    .from("wa_conversations")
    .upsert({ wa_number: waNumber, last_message_at: new Date().toISOString() }, { onConflict: "wa_number" })
    .select()
    .single();

  if (error) console.error("[WA] upsertConversation error:", error.message);
  return data;
}

// ── Save message ──────────────────────────────────────────────────────────────
async function saveMessage({ conversationId, waMessageId, direction, messageType, body, metadata }) {
  const { error } = await supabase.from("wa_messages").insert({
    conversation_id: conversationId,
    wa_message_id:   waMessageId,
    direction,
    message_type:    messageType,
    body,
    metadata,
  });
  if (error) console.error("[WA] saveMessage error:", error.message);
}

// ── Handle status update ──────────────────────────────────────────────────────
function handleStatusUpdate(status) {
  console.log(`[WA] Status update — message ${status.id}: ${status.status}`);
}
