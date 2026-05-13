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
import {
  createSchedule,
  cancelLatestSchedule,
  confirmLatestSchedule,
  sendGoldbackWelcomeTemplate,
  sendGoldbackCreditedTemplate,
} from "../utils/wa-scheduler.server";
import {
  captureLeadIfNew,
  findUserIdByEmail,
  mergePhoneIntoExistingUser,
} from "../utils/wa-lead-capture.server";

const VERIFY_TOKEN    = process.env.WA_VERIFY_TOKEN   || "mycarat_wa_verify";
const ACCESS_TOKEN    = process.env.WA_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const FLOW_ID_SCHEDULE = "1936816750291662";   // mc_scheduling_v1
const FLOW_ID_PROFILE  = process.env.WA_FLOW_ID_PROFILE || "1296305858545931"; // mc_profile_v1
const SIGNUP_GC        = 10;
const SET_1_GC         = 20;
const SET_2_GC         = 30;

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
          const contact = value.contacts?.find(c => c.wa_id === msg.from) || null;
          await handleIncomingMessage(msg, contact);
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
async function handleIncomingMessage(msg, contact) {
  const from    = msg.from;
  const msgType = msg.type;
  const waName  = contact?.profile?.name || null;

  console.log(`[WA] Message from ${from} — type: ${msgType}`);

  // ── Lead capture (Phase 2b) ─────────────────────────────────────────────
  // First-time WA contact = auto-create user + grant 10 GC signup reward.
  // For new leads we infer page/intent from the pre-filled context text if
  // present (text messages only; for non-text first contacts, intent is null).
  let inferredPage   = null;
  let inferredIntent = null;
  if (msgType === "text") {
    const ctx = detectPageContext(msg.text?.body || "");
    if (ctx) {
      inferredPage   = ctx.page;
      inferredIntent = ctx.category || ctx.product || null;
    }
  }
  const leadResult = await captureLeadIfNew(from, {
    name:   waName,
    page:   inferredPage,
    intent: inferredIntent,
  });

  // First-time lead → send the goldback_welcome template (Flow + URL buttons).
  // Template survives the 24h-window restriction and includes the
  // "Earn +50 GC" Flow trigger that opens mc_profile_v1.
  if (leadResult.isNew) {
    await sendGoldbackWelcomeTemplate(from, waName, SIGNUP_GC).catch(err =>
      console.error("[WA] goldback_welcome template send failed:", err)
    );
  }

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

  // ── Flow completion — routes by payload shape (mc_profile_v1 or mc_scheduling_v1)
  if (msgType === "interactive" && msg.interactive?.type === "nfm_reply") {
    await handleFlowCompletion(from, msg.interactive.nfm_reply);
    return;
  }

  // ── Button reply (interactive — buttons we sent in free-form messages) ──
  if (msgType === "interactive" && msg.interactive?.type === "button_reply") {
    const buttonId = msg.interactive.button_reply.id;
    if (buttonId === "show_home_menu") {
      await sendHomeMenu(from);
    } else if (buttonId === "have_question") {
      await sendTextMessage(from,
        "Of course! 😊 Go ahead and type your question — we're here to help."
      );
    } else if (buttonId === "schedule_retry") {
      await sendSchedulingFlow(from);
    }
    return;
  }

  // ── Template quick-reply button tapped (template messages) ──
  if (msgType === "button") {
    const payload = msg.button?.payload;
    await handleTemplateButtonTap(from, payload);
    return;
  }

  // ── List reply (user picked a row in one of our page menus) ──
  if (msgType === "interactive" && msg.interactive?.type === "list_reply") {
    const rowId    = msg.interactive.list_reply.id;
    const rowTitle = msg.interactive.list_reply.title;
    await handleListReply(from, rowId, rowTitle);
    return;
  }

  // ── Text message — try page-context match first, else welcome ──
  if (msgType === "text") {
    // First-contact suppression: the goldback_welcome template (sent above
    // for isNew leads) already carries the right CTAs. Skip the page-menu /
    // welcome-message routing so the lead doesn't see two back-to-back
    // messages from us on first contact.
    if (leadResult.isNew) return;

    const text = msg.text?.body || "";
    const ctx  = detectPageContext(text);
    if (ctx) {
      if (ctx.page === "home")     await sendHomeMenu(from);
      else if (ctx.page === "listing") await sendListingMenu(from, ctx.category);
      else if (ctx.page === "product") await sendProductMenu(from, ctx.product);
      else if (ctx.page === "checkout") await sendCheckoutMenu(from);
      return;
    }
    await sendWelcomeMessage(from);
  }
}

// ── Handle flow completion ───────────────────────────────────────────────────
async function handleFlowCompletion(waNumber, nfmReply) {
  let payload;
  try {
    payload = JSON.parse(nfmReply.response_json);
  } catch {
    console.error("[WA] Failed to parse flow response JSON");
    return;
  }

  console.log(`[WA] Flow completed by ${waNumber}:`, payload);

  // Route by payload shape:
  //   - mc_profile_v1    has `flow === "mc_profile_v1"` + email + full_name
  //   - mc_scheduling_v1 has `mode` + `date` + `time`
  if (payload.flow === "mc_profile_v1") {
    return handleProfileFlowCompletion(waNumber, payload);
  }
  if (payload.mode && payload.date && payload.time) {
    return handleSchedulingFlowCompletion(waNumber, payload);
  }

  console.warn(`[WA] Unknown flow payload shape from ${waNumber}:`, payload);
}

// ── Handle template quick-reply button taps ──────────────────────────────────
//
// When templates are created via Meta Business Manager UI, the `payload`
// sent on tap defaults to the BUTTON TEXT (the UI doesn't let you set a
// separate payload). So we match by intent — strip emoji/punctuation,
// lowercase, then keyword-match.
async function handleTemplateButtonTap(waNumber, payload) {
  const norm = (payload || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")    // strip emoji/punctuation
    .trim();

  // CANCEL — only if explicitly cancel (don't match "reschedule" which contains other words)
  if (norm === "cancel" || norm === "schedule_cancel") {
    const cancelled = await cancelLatestSchedule(waNumber);
    if (cancelled) {
      await sendTextMessage(
        waNumber,
        "Your schedule is cancelled. Want to book a new time? Just say so and I'll set it up. 💛"
      );
    } else {
      await sendTextMessage(
        waNumber,
        "I couldn't find an active schedule to cancel. If you'd like to book a new time, just say so."
      );
    }
    return;
  }

  // RESCHEDULE — matches "Reschedule", "Need to reschedule", or our custom payload
  if (norm.includes("reschedule")) {
    await cancelLatestSchedule(waNumber);   // best-effort cancel old
    await sendSchedulingFlow(waNumber);
    return;
  }

  // READY — sent 15 min before call ("I'm ready 💍")
  if (norm.includes("ready") || norm === "schedule_ready") {
    await sendTextMessage(
      waNumber,
      "Wonderful! See you in 15 minutes 💍"
    );
    return;
  }

  // GREAT — user re-affirms booking from confirmation template
  // Promote schedule from pending -> confirmed.
  if (norm === "great" || norm === "schedule_confirm" || norm.startsWith("great")) {
    const confirmed = await confirmLatestSchedule(waNumber);
    if (confirmed) {
      await sendTextMessage(
        waNumber,
        "Lovely — looking forward to chatting with you. 💛 We'll send a reminder 15 minutes before."
      );
    } else {
      await sendTextMessage(
        waNumber,
        "Lovely — looking forward to chatting with you. 💛"
      );
    }
    return;
  }

  console.warn(`[WA] Unknown template button payload: ${payload}`);
}

// ── Schedule rejection prompt — interactive button to retry the Flow ─────────
async function sendScheduleRetryPrompt(to, reason) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: `Hmm — ${reason}\n\nTap below to pick a different time.`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "schedule_retry", title: "Try again 📅" } },
        ],
      },
    },
  };
  await sendToMeta(payload);
}

// ── Send scheduling flow trigger ─────────────────────────────────────────────
async function sendSchedulingFlow(to) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      body: {
        text: "Let's pick a new time! Choose how you'd like us to reach you and when. ✨",
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id:     FLOW_ID_SCHEDULE,
          flow_cta:    "Schedule a chat",
          flow_action: "navigate",
          flow_action_payload: {
            screen: "MODE",
          },
        },
      },
    },
  };
  await sendToMeta(payload);
}

// ── Page-context detection from pre-filled wa.me text ────────────────────────
const CTX_HOME     = /exploring your store/i;
const CTX_LISTING  = /Hi MyCarat\s*[-—–:]\s*browsing\s+(.+)/i;
const CTX_PRODUCT  = /Hi MyCarat\s*[-—–:]\s*about\s+(.+)/i;
const CTX_CHECKOUT = /(?:order help|need help with my order)/i;

function detectPageContext(text) {
  if (!text) return null;
  if (CTX_HOME.test(text))    return { page: "home" };
  let m = text.match(CTX_LISTING);
  if (m) return { page: "listing", category: m[1].trim() };
  m = text.match(CTX_PRODUCT);
  if (m) return { page: "product", product: m[1].trim() };
  if (CTX_CHECKOUT.test(text)) return { page: "checkout" };
  return null;
}

// ── Per-page list menus ─────────────────────────────────────────────────────
async function sendHomeMenu(to) {
  return sendListMessage(to, {
    body: "Hi! 👋 How can we help today?",
    button: "Choose an option",
    rows: [
      { id: "home_about_us", title: "About us",          description: "Our story, founders, mission" },
      { id: "home_trust",    title: "Trust & safety",    description: "BIS, IGI, secured shipping" },
      { id: "home_goldback", title: "Earn Goldback",     description: "Rewards for signup & profile" },
      { id: "home_human",    title: "Talk to a human",   description: "Schedule a quick chat with us" },
    ],
  });
}

async function sendListingMenu(to, category) {
  const cat = (category || "").trim() || "jewellery";
  return sendListMessage(to, {
    body: `Browsing ${cat}? Here's how we can help.`,
    button: "Choose an option",
    rows: [
      { id: "listing_faqs",   title: "FAQs",                       description: "Sizes, payments, returns" },
      { id: "listing_expert", title: "Talk to a jewellery expert", description: "Schedule a chat with our gemologist" },
      { id: "listing_design", title: "Share my design",            description: "Send us a sketch / photo" },
      { id: "listing_human",  title: "Talk to a human",            description: "Schedule a chat with us" },
    ],
  });
}

async function sendProductMenu(to, productTitle) {
  const prod = (productTitle || "").trim().slice(0, 40) || "this piece";
  return sendListMessage(to, {
    body: `About ${prod} — how can we help?`,
    button: "Choose an option",
    rows: [
      { id: "product_expert",  title: "Talk to expert",      description: "Schedule a chat about this piece" },
      { id: "product_buy",     title: "How do I buy this",   description: "Step-by-step purchase walkthrough" },
      { id: "product_modify",  title: "Modify this piece",   description: "Different gold, stone or size" },
      { id: "product_similar", title: "Explore similar",     description: "See related pieces" },
      { id: "product_human",   title: "Talk to a human",     description: "Schedule a chat with us" },
    ],
  });
}

async function sendCheckoutMenu(to) {
  return sendListMessage(to, {
    body: "Let's get you through checkout.",
    button: "Choose an option",
    rows: [
      { id: "checkout_expert",   title: "Talk to expert",       description: "Schedule a chat about my order" },
      { id: "checkout_trust",    title: "Trust & safety",       description: "BIS, IGI, insurance" },
      { id: "checkout_payment",  title: "Payment process",      description: "How payments work" },
      { id: "checkout_returns",  title: "Return & exchange",    description: "Our 14-day refund + lifetime exchange" },
      { id: "checkout_modify",   title: "Order modification",   description: "Change something on a placed order" },
      { id: "checkout_human",    title: "Talk to a human",      description: "Schedule a chat with us" },
    ],
  });
}

// ── Generic list-message sender ─────────────────────────────────────────────
async function sendListMessage(to, { body, button, rows }) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body:   { text: body },
      action: {
        button:   button || "Select",
        sections: [{ title: "Quick help", rows }],
      },
    },
  };
  return sendToMeta(payload);
}

// ── List reply router ───────────────────────────────────────────────────────
async function handleListReply(to, rowId, rowTitle) {
  // STATIC INFO + URL button
  if (rowId === "home_about_us") {
    return sendStaticInfo(to,
      "MyCarat is built by Abhishek and Ankuja Jain — graduates of IIT Roorkee and NIT Surat. We started MyCarat to bring honest, transparent fine jewellery to India. Every piece is BIS Hallmarked and IGI / GIA certified.",
      "Read full story", "https://mycarat.in/pages/our-story");
  }
  if (rowId === "home_trust" || rowId === "checkout_trust") {
    return sendStaticInfo(to,
      "Every MyCarat piece comes with:\n• BIS Hallmark on every gold piece (HUID engraved)\n• IGI / GIA certification on every diamond and solitaire\n• Insured shipping pan-India\n• 14-day full refund\n• Lifetime exchange & buyback",
      "Trust & safety", "https://mycarat.in/pages/trust");
  }
  if (rowId === "home_goldback") {
    return sendStaticInfo(to,
      "Earn Gold Coins (GC) for every action you take with MyCarat:\n• Sign up — get GC instantly\n• Complete your profile — earn more\n• Each GC reduces your gold weight when you buy a piece",
      "View my Goldback wallet", "https://mycarat.in/pages/goldback-wallet");
  }
  if (rowId === "listing_faqs") {
    return sendStaticInfo(to,
      "Common questions answered: sizing, payments, certifications, returns, exchange, delivery timeline, and more.",
      "See all FAQs", "https://mycarat.in/pages/faqs");
  }
  if (rowId === "product_buy") {
    return sendStaticInfo(to,
      "Buying a MyCarat piece:\n1. Customise gold purity, stones, size, engraving on the product page\n2. Add to cart and place order\n3. Our concierge calls in 1-2 business days to confirm\n4. We craft (5-7 days) → QC (3-5 days) → ship (3-5 days)",
      "Open contact page", "https://mycarat.in/pages/contact");
  }
  if (rowId === "checkout_payment") {
    return sendTextMessage(to,
      "How payment works:\n\n1. Pay 20% advance via UPI or bank transfer\n2. We start manufacturing\n3. Pay balance via UPI / bank transfer once your piece is ready for QC\n4. Insured delivery follows\n\nNeed details? Just ask.");
  }
  if (rowId === "checkout_returns") {
    return sendStaticInfo(to,
      "Our return promise:\n• 14-day full refund — every piece, no questions\n• Free insured pickup\n• Refund to original payment method within 7 business days",
      "Full refund policy", "https://mycarat.in/policies/refund-policy");
  }

  // FLOW actions — scheduling (the universal "talk to human / expert" flow)
  if (
    rowId === "home_human"     ||
    rowId === "listing_expert" || rowId === "listing_human" ||
    rowId === "product_expert" || rowId === "product_human" ||
    rowId === "checkout_expert" || rowId === "checkout_human"
  ) {
    return sendSchedulingFlow(to);
  }

  // Phase 3 not built — route through scheduling for now
  if (
    rowId === "listing_design"  ||   // share my design
    rowId === "product_modify"  ||   // modify product
    rowId === "checkout_modify"      // order modification
  ) {
    await sendTextMessage(to, "Our concierge will help you with this. Pick a time that works:");
    return sendSchedulingFlow(to);
  }

  // WEBSITE LINK
  if (rowId === "product_similar") {
    return sendStaticInfo(to,
      "Explore our full catalogue of curated pieces:",
      "View collection", "https://mycarat.in/collections/all");
  }

  // Fallback
  console.warn(`[WA] Unknown list row id: ${rowId} (${rowTitle})`);
  await sendTextMessage(to, "Got it! One of our experts will reach out shortly. 💛");
}

// ── Static-info helper: text + single CTA URL button ────────────────────────
async function sendStaticInfo(to, bodyText, btnLabel, url) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body:   { text: bodyText },
      action: {
        name: "cta_url",
        parameters: { display_text: btnLabel.slice(0, 20), url },
      },
    },
  };
  return sendToMeta(payload);
}

// ── Handle profile flow (mc_profile_v1) ──────────────────────────────────────
//
// Submitted payload (from flows/mc_profile_v1.json terminal screen):
//   { flow: "mc_profile_v1", email, full_name, gender,
//     date_of_birth?, anniversary?, profession }
//
// Server-side: mirrors api.claim-signup-reward.jsx validation, then claims
// set_1 (20 GC) + set_2 (30 GC) atomically and confirms via goldback_credited.
async function handleProfileFlowCompletion(waNumber, payload) {
  const phone = waNumber.startsWith("+") ? waNumber : `+${waNumber}`;

  // 1. Look up user_id (lead capture should have created this on first contact)
  const { data: phoneRow } = await supabase
    .from("auth_phone_users")
    .select("user_id")
    .eq("phone", phone)
    .maybeSingle();

  if (!phoneRow?.user_id) {
    console.error("[profile-flow] no user found for phone", phone);
    await sendTextMessage(waNumber, "Hmm — we couldn't find your account. Please send us a quick 'hi' to start over.");
    return;
  }
  // `userId` may be reassigned later if an email-collision merge swaps us
  // onto a canonical (existing-web-user) account.
  let userId = phoneRow.user_id;

  // 2. Validate all fields server-side
  const email      = (payload.email || "").trim().toLowerCase();
  const fullName   = (payload.full_name || "").trim();
  const gender     = payload.gender;
  const dob        = (payload.date_of_birth || "").trim() || null;
  const anniv      = (payload.anniversary   || "").trim() || null;
  const profession = payload.profession;

  const VALID_GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
  const VALID_PROFESSIONS = [
    "Business Owner", "Corporate Professional", "Doctor / Medical",
    "Lawyer / Legal", "Engineer / Tech", "Finance / Banking",
    "Government / Public Sector", "Creative / Design", "Education / Academic",
    "Homemaker", "Student", "Retired", "Other",
  ];

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith("@phone.auth.mycarat")) {
    await sendTextMessage(waNumber, "That email looks off — please try the form again with a real email address.");
    return;
  }
  if (fullName.length < 2 || !/^[a-zA-Z\s.''-]+$/.test(fullName)) {
    await sendTextMessage(waNumber, "Please use letters only in your name (no numbers or emoji). Try the form again.");
    return;
  }
  if (!VALID_GENDERS.includes(gender)) {
    await sendTextMessage(waNumber, "Gender field is missing — please run the form again.");
    return;
  }
  if (!VALID_PROFESSIONS.includes(profession)) {
    await sendTextMessage(waNumber, "Profession field is missing — please run the form again.");
    return;
  }
  if (!dob && !anniv) {
    await sendTextMessage(waNumber, "Please add at least one of birthday or anniversary so we can plan something. Tap the form again to add one.");
    return;
  }
  if (dob) {
    const ageMs = Date.now() - new Date(dob).getTime();
    const age   = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 15 || age > 100) {
      await sendTextMessage(waNumber, "Birthday must indicate an age between 15 and 100. Please re-enter.");
      return;
    }
  }
  if (anniv && new Date(anniv) > new Date()) {
    await sendTextMessage(waNumber, "Anniversary date can't be in the future. Please re-enter.");
    return;
  }

  // 3. Email collision check — if `email` already belongs to another Supabase
  //    user (e.g., the user signed up via web earlier), merge our WA lead into
  //    that canonical user instead of orphaning them on the synthetic email.
  //    Otherwise: just update the synthetic email to the real one.
  const existingUid = await findUserIdByEmail(email);
  if (existingUid && existingUid !== userId) {
    const mergeRes = await mergePhoneIntoExistingUser(phone, userId, existingUid);
    if (!mergeRes.ok) {
      console.error("[profile-flow] merge failed; continuing on synthetic user");
    } else {
      userId = existingUid;   // switch to canonical user for all subsequent ops
    }
  } else {
    const { error: emailErr } = await supabase.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (emailErr && !emailErr.message?.includes("already")) {
      console.error("[profile-flow] auth email update failed:", emailErr.message);
    }
  }

  // 4. Persist profile fields (upsert — after merge, the canonical user may
  //    not have a profiles row yet; in the no-collision path the row already
  //    exists from captureLeadIfNew).
  const { error: profErr } = await supabase
    .from("profiles")
    .upsert({
      id:            userId,
      user_id:       userId,
      full_name:     fullName,
      gender,
      date_of_birth: dob,
      anniversary:   anniv,
      profession,
    }, { onConflict: "id" });
  if (profErr) {
    console.error("[profile-flow] profile update failed:", profErr.message);
    await sendTextMessage(waNumber, "Couldn't save your profile right now. Please try again in a minute.");
    return;
  }

  // 5. Claim set_1 + set_2 (idempotent via UNIQUE constraint)
  let totalAwarded = 0;
  for (const [level, coins] of [["set_1", SET_1_GC], ["set_2", SET_2_GC]]) {
    const { error } = await supabase
      .from("signup_rewards_claimed")
      .insert({ user_id: userId, reward_level: level, amount_coins: coins });
    if (error) {
      if (error.code === "23505") {
        console.log(`[profile-flow] ${level} already claimed for ${userId}`);
        continue;
      }
      console.error(`[profile-flow] ${level} claim failed:`, error.message);
      continue;
    }
    await supabase.from("goldback_transactions").insert({
      user_id:      userId,
      type:         "earn",
      amount_coins: coins,
      description:  `Signup reward: ${level} (${coins} Gold Coins) — via WhatsApp profile Flow`,
    });
    totalAwarded += coins;
  }

  // 6. Update wallet
  let newBalance = 0;
  const { data: wallet } = await supabase
    .from("goldback_wallet")
    .select("balance_coins")
    .eq("user_id", userId)
    .single();
  if (wallet) {
    newBalance = parseInt(wallet.balance_coins || 0) + totalAwarded;
    await supabase
      .from("goldback_wallet")
      .update({ balance_coins: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else {
    newBalance = totalAwarded;
    await supabase.from("goldback_wallet").insert({ user_id: userId, balance_coins: newBalance });
  }

  console.log(`[profile-flow] user=${userId} awarded=${totalAwarded} balance=${newBalance}`);

  // 7. Confirmation: template if anything was newly claimed, else free-form note
  if (totalAwarded > 0) {
    await sendGoldbackCreditedTemplate(
      phone,
      fullName.split(" ")[0] || null,
      totalAwarded,
      "for completing your profile",
      newBalance,
    ).catch(err => console.error("[profile-flow] credited template send failed:", err));
  } else {
    await sendTextMessage(waNumber, "Your profile is already complete — we have your 50 Gold Coins on file. 💛");
  }
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
    await sendScheduleRetryPrompt(waNumber, result.error);
    return;
  }

  // Confirmation template was already sent by createSchedule().
  // Send a friendly free-form follow-up too (we're inside the 24-hr window).
  await sendTextMessage(
    waNumber,
    "All set! 📅 You'll get a reminder 15 minutes before our chat. Looking forward to it!"
  );
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
          { type: "reply", reply: { id: "show_home_menu", title: "Show me options 💍" } },
          { type: "reply", reply: { id: "have_question",  title: "I have a question" } },
        ],
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
