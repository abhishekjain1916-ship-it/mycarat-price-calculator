/**
 * Website lead-gen helpers — Visit Boutique / Initiate Exchange / Upload
 * Design. These are NOT appointments (no scheduled_at, no reminders); the
 * rep coordinates the call by hand after the lead lands. See
 * supabase/migrations/2026-07-04-create-lead-tables.sql.
 *
 * Used by:
 *   - api.website-schedule (routes Visit Boutique / Initiate Exchange /
 *     Upload Design submissions here instead of wa_schedules)
 */

import { supabase } from "../supabase.server";
import {
  lookupCustomerId,
  sendLeadReceivedTemplate,
  sendLeadAdminAlertTemplate,
} from "./wa-scheduler.server";

const OPS_EMAIL_TO = process.env.OPS_EMAIL_TO || "mycarat.in@gmail.com";

// ── Visit Boutique ───────────────────────────────────────────────────────────

export async function createBoutiqueVisitLead({
  waPhone,
  waName,
  email,
  notes,
  visitWindow,
  triggerContext,
  channel = "web",
  customerId: providedCustomerId = null,
}) {
  const customerId = providedCustomerId || (await lookupCustomerId(waPhone));

  const { data: row, error } = await supabase
    .from("boutique_visit_leads")
    .insert({
      customer_id:     customerId,
      wa_phone:        waPhone,
      wa_name:         waName || null,
      email:           email || null,
      visit_window:    visitWindow || null,
      notes:           (notes || "").trim() || null,
      trigger_context: triggerContext || null,
      channel,
    })
    .select()
    .single();

  if (error) {
    console.error("[wa-leads] boutique_visit_leads insert failed:", error);
    return { ok: false, error: "Could not save your request. Please try again." };
  }

  await emailOpsLead("Visit Boutique", row).catch(err =>
    console.error("[wa-leads] ops email failed:", err)
  );

  return { ok: true, lead: row };
}

// ── Initiate Exchange / Upload Design ───────────────────────────────────────

export async function createExchangeLead({
  waPhone,
  waName,
  email,
  notes,
  fileUrl,
  topic,
  triggerContext,
  channel = "web",
  customerId: providedCustomerId = null,
}) {
  const customerId = providedCustomerId || (await lookupCustomerId(waPhone));

  const { data: row, error } = await supabase
    .from("exchange_leads")
    .insert({
      customer_id:     customerId,
      wa_phone:        waPhone,
      wa_name:         waName || null,
      email:           email || null,
      topic,
      notes:           (notes || "").trim() || null,
      file_url:        fileUrl || null,
      trigger_context: triggerContext || null,
      channel,
    })
    .select()
    .single();

  if (error) {
    console.error("[wa-leads] exchange_leads insert failed:", error);
    return { ok: false, error: "Could not save your request. Please try again." };
  }

  await emailOpsLead(topic, row).catch(err =>
    console.error("[wa-leads] ops email failed:", err)
  );

  return { ok: true, lead: row };
}

// ── Shared lead-received / admin-alert dispatch ─────────────────────────────

const LEAD_TOPIC_PHRASE = {
  "Visit Boutique":    "your boutique visit",
  "Initiate Exchange": "your exchange inquiry",
  "Upload Design":     "your design submission",
};

/**
 * Fires the lead_received (customer ack) + lead_alert_admin (operator)
 * WhatsApp templates. Call after a successful insert into either lead table.
 */
export async function notifyLead({ topic, waPhone, waName, note, fileUrl }) {
  sendLeadReceivedTemplate(
    waPhone,
    waName,
    LEAD_TOPIC_PHRASE[topic] || "your inquiry",
  ).catch(err =>
    console.error("[wa-leads] lead_received template failed:", err)
  );

  const adminParts = [];
  if (note)    adminParts.push(note);
  if (fileUrl) adminParts.push(`File: ${fileUrl}`);
  sendLeadAdminAlertTemplate(waName, waPhone, topic, adminParts.join(" · ")).catch(err =>
    console.error("[wa-leads] lead_alert_admin template failed:", err)
  );
}

// ── Ops email (Resend) ───────────────────────────────────────────────────────

async function emailOpsLead(topic, row) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const fromAddress = process.env.RESEND_FROM || "onboarding@resend.dev";
  const subject = `[MyCarat] New lead — ${topic}`;
  const lines = [
    `Topic:    ${topic}`,
    `Customer: ${row.wa_name || "(unknown)"}`,
    `Phone:    ${row.wa_phone}`,
    `Email:    ${row.email || "(none)"}`,
    `Notes:    ${row.notes || "(none)"}`,
    row.file_url ? `File:     ${row.file_url}` : null,
    row.visit_window ? `Window:   ${row.visit_window}` : null,
    `Context:  ${JSON.stringify(row.trigger_context || {})}`,
    "",
    `Lead ID: ${row.id}`,
    `Status:  ${row.status}`,
  ].filter(Boolean).join("\n");

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
