/**
 * WhatsApp scheduler helpers
 *
 * Used by:
 *   - api.whatsapp-webhook (when mc_scheduling_v1 Flow completes)
 *   - wa-reminder-cron (every minute)
 *   - api.admin.schedules (list + status update)
 *   - api.cron.send-reminders (external trigger fallback)
 *
 * Decisions (from project_whatsapp_brainstorm.md):
 *   • 30-min slots within 11am–9pm IST · all 7 days
 *   • Min 1h lead, max 15 days lead
 *   • Off-hours bookings auto-shift to next 11:00 IST window
 *   • Reminder 15 min before scheduled_at
 */

import { supabase } from "../supabase.server";

const ACCESS_TOKEN    = process.env.WA_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const GRAPH_URL       = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

const OPS_EMAIL_TO    = process.env.OPS_EMAIL_TO || "mycarat.in@gmail.com";

// ── Working-hours config ────────────────────────────────────────────────────
const IST_OFFSET_MIN     = 5 * 60 + 30;     // +05:30
const WORKING_START_HOUR = 11;              // 11:00 IST
const WORKING_END_HOUR   = 21;              // 21:00 IST  (last slot 20:30)
const SLOT_MINUTES       = 30;
const MIN_LEAD_MS        = 60 * 60 * 1000;             // 1 hour
const MAX_LEAD_MS        = 15 * 24 * 60 * 60 * 1000;   // 15 days

const VALID_MODES = new Set(["text", "call", "zoom", "facetime", "wa_video"]);
const MODE_LABELS = {
  text:     "Text on WhatsApp",
  call:     "Phone call",
  zoom:     "Zoom call",
  facetime: "FaceTime",
  wa_video: "WhatsApp video call",
};

// ── Time helpers ────────────────────────────────────────────────────────────

/** Combine date + HH:MM (treated as IST) → UTC Date object. */
export function buildUtcFromIstDateTime(dateStr, timeStr) {
  // dateStr: 'YYYY-MM-DD' · timeStr: 'HH:MM' (24h, IST)
  const [y, m, d]  = dateStr.split("-").map(Number);
  const [hh, mm]   = timeStr.split(":").map(Number);
  // IST timestamp in epoch terms = UTC equivalent − IST offset
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000;
  return new Date(utcMs);
}

/** Get IST hour/min from a UTC Date. */
function istHourMin(utcDate) {
  const istMs = utcDate.getTime() + IST_OFFSET_MIN * 60_000;
  const ist   = new Date(istMs);
  return { hour: ist.getUTCHours(), min: ist.getUTCMinutes(), date: ist };
}

/** Format a Date as a friendly IST string for confirmations: "Mon, 30 Apr · 02:30 PM" */
export function formatIstDatetime(utcDate) {
  const istMs   = utcDate.getTime() + IST_OFFSET_MIN * 60_000;
  const ist     = new Date(istMs);
  const days    = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months  = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh24    = ist.getUTCHours();
  const mm      = String(ist.getUTCMinutes()).padStart(2, "0");
  const ampm    = hh24 >= 12 ? "PM" : "AM";
  const hh12    = ((hh24 + 11) % 12) + 1;
  return `${days[ist.getUTCDay()]}, ${ist.getUTCDate()} ${months[ist.getUTCMonth()]} · ${String(hh12).padStart(2, "0")}:${mm} ${ampm} IST`;
}

/**
 * Validate + auto-shift to next 11am IST if outside working hours.
 * Returns { ok: true, scheduledAtUtc } or { ok: false, reason }.
 */
export function normalizeScheduledAt(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) {
    return { ok: false, reason: "Invalid date or time format." };
  }

  let utc = buildUtcFromIstDateTime(dateStr, timeStr);
  const now = new Date();

  if (isNaN(utc.getTime())) return { ok: false, reason: "Could not parse date/time." };

  // Lead-time bounds checked AFTER any potential shift.
  const { hour, min } = istHourMin(utc);
  const slotOk = hour >= WORKING_START_HOUR && (hour < WORKING_END_HOUR || (hour === WORKING_END_HOUR - 1 && min <= 30));

  if (!slotOk) {
    // Shift to next IST 11:00 — same day if before 11:00, else next day
    const istShift = new Date(utc.getTime() + IST_OFFSET_MIN * 60_000);
    if (hour >= WORKING_END_HOUR) {
      istShift.setUTCDate(istShift.getUTCDate() + 1);
    }
    istShift.setUTCHours(WORKING_START_HOUR, 0, 0, 0);
    utc = new Date(istShift.getTime() - IST_OFFSET_MIN * 60_000);
  }

  if (utc - now < MIN_LEAD_MS) {
    return { ok: false, reason: "Please pick a time at least 1 hour from now." };
  }
  if (utc - now > MAX_LEAD_MS) {
    return { ok: false, reason: "Please pick a time within the next 15 days." };
  }

  return { ok: true, scheduledAtUtc: utc };
}

// ── Insert + send-confirmation ──────────────────────────────────────────────

/**
 * Save a schedule + send confirmation template + email ops.
 * `flowPayload` is the parsed JSON from the Meta Flow submit.
 */
export async function createSchedule({ waPhone, waName, payload, triggerContext }) {
  const mode = (payload.mode || "").trim();
  if (!VALID_MODES.has(mode)) {
    return { ok: false, error: "Please pick a valid contact mode." };
  }

  const v = normalizeScheduledAt(payload.date, payload.time);
  if (!v.ok) return { ok: false, error: v.reason };

  const { scheduledAtUtc } = v;

  // Try to attach customer_id by matching wa_phone (best-effort)
  const customerId = await lookupCustomerId(waPhone);

  const { data: row, error } = await supabase
    .from("wa_schedules")
    .insert({
      customer_id:     customerId,
      wa_phone:        waPhone,
      wa_name:         waName || null,
      trigger_context: triggerContext || null,
      preferred_mode:  mode,
      scheduled_at:    scheduledAtUtc.toISOString(),
      notes:           (payload.notes || "").trim() || null,
    })
    .select()
    .single();

  if (error) {
    // Unique-index conflict = duplicate active booking at same time
    if (error.code === "23505") {
      return { ok: false, error: "You already have a slot at that time." };
    }
    console.error("[wa-scheduler] insert failed:", error);
    return { ok: false, error: "Could not save your schedule. Please try again." };
  }

  // Fire-and-forget side effects
  await sendConfirmationTemplate(waPhone, waName, mode, scheduledAtUtc).catch(err =>
    console.error("[wa-scheduler] confirmation template failed:", err)
  );
  await markConfirmationSent(row.id);
  await emailOps(row).catch(err =>
    console.error("[wa-scheduler] ops email failed:", err)
  );

  return { ok: true, schedule: row };
}

async function lookupCustomerId(waPhone) {
  // best-effort lookup; column may be on customers or auth.users — wrap in try/catch
  try {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("wa_phone", waPhone)
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

async function markConfirmationSent(id) {
  await supabase
    .from("wa_schedules")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", id);
}

// ── Templates: confirmation + reminder ──────────────────────────────────────

async function sendConfirmationTemplate(waPhone, waName, mode, scheduledAtUtc) {
  const payload = {
    messaging_product: "whatsapp",
    to: waPhone.replace(/^\+/, ""),
    type: "template",
    template: {
      name: "schedule_confirmed",
      language: { code: "en" },
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: waName || "there" },
          { type: "text", text: MODE_LABELS[mode] || mode },
          { type: "text", text: formatIstDatetime(scheduledAtUtc) },
        ],
      }],
    },
  };
  return sendToMeta(payload);
}

export async function sendReminderTemplate(waPhone, waName, scheduledAtUtc) {
  const payload = {
    messaging_product: "whatsapp",
    to: waPhone.replace(/^\+/, ""),
    type: "template",
    template: {
      name: "schedule_reminder",
      language: { code: "en" },
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: waName || "there" },
          { type: "text", text: formatIstDatetime(scheduledAtUtc) },
        ],
      }],
    },
  };
  return sendToMeta(payload);
}

async function sendToMeta(payload) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error("[wa-scheduler] WA_ACCESS_TOKEN or WA_PHONE_NUMBER_ID not configured");
    return;
  }
  const res = await fetch(GRAPH_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[wa-scheduler] Meta send failed:", res.status, text.slice(0, 300));
  }
}

// ── Cancel latest active schedule for a phone ───────────────────────────────

/**
 * Find the most-imminent pending/confirmed schedule for this phone (in the
 * future) and mark it cancelled. Returns the cancelled row, or null if none.
 */
export async function cancelLatestSchedule(rawPhone) {
  const waPhone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
  const { data, error } = await supabase
    .from("wa_schedules")
    .select("id, scheduled_at, preferred_mode")
    .eq("wa_phone", waPhone)
    .in("status", ["pending", "confirmed"])
    .gt("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[wa-scheduler] cancelLatestSchedule query failed:", error);
    return null;
  }
  if (!data || data.length === 0) return null;

  const target = data[0];
  const { error: updErr } = await supabase
    .from("wa_schedules")
    .update({ status: "cancelled" })
    .eq("id", target.id);

  if (updErr) {
    console.error("[wa-scheduler] cancelLatestSchedule update failed:", updErr);
    return null;
  }
  return target;
}

// ── Reminder dispatch (called every minute) ─────────────────────────────────

export async function dispatchDueReminders() {
  const now      = new Date();
  const cutoff   = new Date(now.getTime() + 15 * 60 * 1000);
  const { data, error } = await supabase
    .from("wa_schedules")
    .select("id, wa_phone, wa_name, scheduled_at")
    .in("status", ["pending", "confirmed"])
    .is("reminder_sent_at", null)
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", cutoff.toISOString())
    .limit(50);

  if (error) {
    console.error("[wa-scheduler] dispatchDueReminders query failed:", error);
    return { sent: 0, errors: 1 };
  }

  let sent = 0, errors = 0;
  for (const r of data || []) {
    try {
      await sendReminderTemplate(r.wa_phone, r.wa_name, new Date(r.scheduled_at));
      await supabase
        .from("wa_schedules")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", r.id);
      sent++;
    } catch (e) {
      console.error("[wa-scheduler] reminder send failed:", r.id, e);
      errors++;
    }
  }
  return { sent, errors };
}

// ── Ops email (Resend) ──────────────────────────────────────────────────────

async function emailOps(row) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;  // silently skip if not configured

  // From address — falls back to Resend's shared sending domain so it works
  // before mycarat.in is verified at Resend.
  const fromAddress = process.env.RESEND_FROM || "onboarding@resend.dev";

  const subject = `[MyCarat] New schedule — ${MODE_LABELS[row.preferred_mode]} at ${formatIstDatetime(new Date(row.scheduled_at))}`;
  const lines = [
    `Customer: ${row.wa_name || "(unknown)"}`,
    `Phone:    ${row.wa_phone}`,
    `Mode:     ${MODE_LABELS[row.preferred_mode]}`,
    `Time:     ${formatIstDatetime(new Date(row.scheduled_at))}`,
    `Notes:    ${row.notes || "(none)"}`,
    `Context:  ${JSON.stringify(row.trigger_context || {})}`,
    "",
    `Schedule ID: ${row.id}`,
    `Status:      ${row.status}`,
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    fromAddress,
      to:      [OPS_EMAIL_TO],
      subject,
      text:    lines,
    }),
  });
}
