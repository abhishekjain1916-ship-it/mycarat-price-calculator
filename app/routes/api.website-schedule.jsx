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
 *   }
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
import { createSchedule, formatIstDatetime } from "../utils/wa-scheduler.server";

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

export const loader = () => json({ error: "Use POST" }, { status: 405 });

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

  const name  = String(body.name  || "").trim();
  const phone = normalizePhone(body.phone);
  const email = String(body.email || "").trim() || null;
  const mode  = String(body.mode  || "").trim();
  const date  = String(body.date  || "").trim();
  const time  = String(body.time  || "").trim();
  const topic = String(body.topic || "").trim();
  const note  = String(body.note  || "").trim();

  if (!name)  return json({ ok: false, error: "Please enter your name." }, { status: 400 });
  if (!phone) return json({ ok: false, error: "Please enter a valid phone (10 digits or +91…)." }, { status: 400 });
  if (!mode)  return json({ ok: false, error: "Please pick a contact mode." }, { status: 400 });
  if (!date || !time) return json({ ok: false, error: "Please pick a date and time." }, { status: 400 });

  const customerId = await resolveCustomerId(request);

  // Compose notes: topic prefix + free-text + email (if any)
  const noteParts = [];
  if (topic) noteParts.push(`Topic: ${topic}`);
  if (note)  noteParts.push(note);
  if (email) noteParts.push(`Email: ${email}`);
  const composedNotes = noteParts.join(" · ") || null;

  const result = await createSchedule({
    waPhone:  phone,
    waName:   name,
    payload:  { mode, date, time, notes: composedNotes },
    triggerContext: {
      source: "website",
      topic,
      email,
    },
    channel:    "web",
    customerId,
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: 400 });
  }

  return json({
    ok: true,
    scheduledAtIst: formatIstDatetime(new Date(result.schedule.scheduled_at)),
    scheduleId: result.schedule.id,
  });
};
