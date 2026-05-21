/**
 * POST /api/website-schedule
 *
 * Storefront-form entry point for "Talk to Experts" / "Visit Boutique" /
 * "Initiate Exchange" / "Upload Design" workflows. Inserts a row into
 * wa_schedules with channel='web' and (when an Authorization: Bearer
 * access-token is provided) the authenticated Supabase user_id.
 *
 * Body (JSON):
 *   {
 *     name:     string  required
 *     phone:    string  required, E.164
 *     email:    string  optional
 *     mode:     'text' | 'call' | 'zoom' | 'facetime' | 'wa_video'  required
 *     date:     'YYYY-MM-DD'  required
 *     time:     'HH:MM'  required, 24h IST
 *     topic:    string  optional — card label (e.g. "Fine Jewellery")
 *     note:     string  optional — extra user message
 *     file_url: string  optional — public Supabase Storage URL (Initiate
 *                                   Exchange / Upload Design)
 *   }
 *
 * If topic is in {Visit Boutique, Initiate Exchange, Upload Design} we treat
 * the row as a lead (rep will coordinate the call manually) and skip the
 * "Your call is scheduled for..." WhatsApp confirmation template.
 *
 * Header (optional):
 *   Authorization: Bearer <supabase access_token>
 *     If present and valid, we attach the user_id as customer_id.
 *
 * Response:
 *   200 { ok: true, scheduledAtIst: "Mon, 24 May · 11:00 AM IST" }
 *   400 { ok: false, error: "..." }
 *   500 { ok: false, error: "..." }
 */

import { supabase } from "../supabase.server";
import {
  createSchedule,
  formatIstDatetime,
  sendLeadReceivedTemplate,
} from "../utils/wa-scheduler.server";

// Phrases used in the lead_received WA template ({{2}} parameter). Keys
// must match LEAD_ONLY_TOPICS exactly.
const LEAD_TOPIC_PHRASE = {
  "Visit Boutique":    "your boutique visit",
  "Initiate Exchange": "your exchange inquiry",
  "Upload Design":     "your design submission",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function normalizePhone(raw) {
  const cleaned = String(raw || "").replace(/[\s\-()]/g, "");
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  // Default-india fallback: 10 digits -> +91XXXXXXXXXX
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^\d{12}$/.test(cleaned) && cleaned.startsWith("91")) return `+${cleaned}`;
  return null;
}

async function resolveCustomerId(request) {
  const authz = request.headers.get("authorization") || "";
  const match = authz.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const accessToken = match[1].trim();
  if (!accessToken) return null;

  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch (err) {
    console.error("[website-schedule] auth.getUser failed:", err);
    return null;
  }
}

/**
 * For lead-only topics where we synthesize scheduled_at on behalf of the
 * user, walk forward 30 minutes per collision (the wa_schedules unique
 * index on phone + scheduled_at fires error 23505). Cap at MAX_RETRIES
 * which covers ~3 working days of slots — comfortably beyond any plausible
 * test or rapid-submit scenario.
 */
async function createWithLeadRetry({
  waPhone, waName, startDate, startTime, notes, triggerContext, customerId,
}) {
  const MAX_RETRIES = 60;
  const WORK_START_H = 11;
  const WORK_END_H   = 20;
  const WORK_END_M   = 30;
  const pad = (n) => String(n).padStart(2, "0");

  let date = startDate;
  let time = startTime;

  for (let i = 0; i <= MAX_RETRIES; i++) {
    const result = await createSchedule({
      waPhone, waName,
      payload: { mode: "call", date, time, notes },
      triggerContext,
      channel: "web",
      customerId,
      skipConfirmationTemplate: true,
    });
    if (result.ok) return result;

    // Only loop on the unique-collision message. Surface anything else.
    if (!result.error || !/already have a slot/i.test(result.error)) {
      return result;
    }

    // Bump 30 minutes; roll to next day's 11:00 if past 20:30 IST.
    let [h, m] = time.split(":").map(Number);
    m += 30;
    if (m >= 60) { h += 1; m = 0; }
    if (h > WORK_END_H || (h === WORK_END_H && m > WORK_END_M)) {
      const [y, mo, d] = date.split("-").map(Number);
      const next = new Date(Date.UTC(y, mo - 1, d) + 86400000);
      date = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
      h = WORK_START_H;
      m = 0;
    }
    time = `${pad(h)}:${pad(m)}`;
  }
  return { ok: false, error: "Couldn't reserve a slot just now. Please WhatsApp us directly." };
}

export const loader = ({ request }) => {
  // Remix routes OPTIONS to the loader (not the action). Handle the CORS
  // preflight here so cross-origin POSTs from the storefront succeed.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return json({ error: "Use POST" }, { status: 405 });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const name    = String(body.name    || "").trim();
  const phone   = normalizePhone(body.phone);
  const email   = String(body.email   || "").trim() || null;
  const mode    = String(body.mode    || "").trim();
  const date    = String(body.date    || "").trim();
  const time    = String(body.time    || "").trim();
  const topic   = String(body.topic   || "").trim();
  const note    = String(body.note    || "").trim();
  const fileUrl = String(body.file_url || "").trim() || null;

  if (!name)  return json({ ok: false, error: "Please enter your name." }, { status: 400 });
  if (!phone) return json({ ok: false, error: "Please enter a valid phone (10 digits or +91…)." }, { status: 400 });
  if (!mode)  return json({ ok: false, error: "Please pick a contact mode." }, { status: 400 });
  if (!date || !time) return json({ ok: false, error: "Please pick a date and time." }, { status: 400 });

  const customerId = await resolveCustomerId(request);

  // Lead-gen flows: rep coordinates the call by hand, so suppress the
  // "Your call is scheduled for..." WhatsApp template. Talk to Experts
  // stays on the appointment path and fires the template as before.
  const LEAD_ONLY_TOPICS = new Set([
    "Visit Boutique",
    "Initiate Exchange",
    "Upload Design",
  ]);
  const isLeadOnly = LEAD_ONLY_TOPICS.has(topic);

  // Compose notes: topic prefix + free-text + email + file URL (if any)
  const noteParts = [];
  if (topic)   noteParts.push(`Topic: ${topic}`);
  if (note)    noteParts.push(note);
  if (email)   noteParts.push(`Email: ${email}`);
  if (fileUrl) noteParts.push(`File: ${fileUrl}`);
  const composedNotes = noteParts.join(" · ") || null;

  // For lead-only topics, the user didn't pick a time — we did. If the
  // synthesized slot collides with an existing row for the same phone
  // (e.g. user submitted multiple lead flows back-to-back), bump 30
  // minutes and retry transparently. For Talk to Experts we still
  // surface the collision since the user picked the slot deliberately.
  const result = isLeadOnly
    ? await createWithLeadRetry({
        waPhone: phone,
        waName:  name,
        startDate: date,
        startTime: time,
        notes: composedNotes,
        triggerContext: {
          source:   "website",
          topic,
          email,
          file_url: fileUrl,
        },
        customerId,
      })
    : await createSchedule({
        waPhone:  phone,
        waName:   name,
        payload:  { mode, date, time, notes: composedNotes },
        triggerContext: {
          source:   "website",
          topic,
          email,
          file_url: fileUrl,
        },
        channel:    "web",
        customerId,
        skipConfirmationTemplate: false,
      });

  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: 400 });
  }

  // Lead flows: fire the generic lead_received template (fire-and-forget).
  // schedule_confirmed was already suppressed inside createSchedule via
  // skipConfirmationTemplate, so this is the only WA message they get.
  if (isLeadOnly) {
    sendLeadReceivedTemplate(
      phone,
      name,
      LEAD_TOPIC_PHRASE[topic] || "your inquiry",
    ).catch(err =>
      console.error("[website-schedule] lead_received template failed:", err)
    );
  }

  return json({
    ok: true,
    scheduledAtIst: formatIstDatetime(new Date(result.schedule.scheduled_at)),
    scheduleId: result.schedule.id,
  });
};
