import { appendLeadRow } from "../utils/sheets-sync.server";

const WEBHOOK_SECRET = process.env.LEAD_SYNC_WEBHOOK_SECRET;

function normalize(table, record) {
  if (table === "wa_schedules") {
    return {
      leadType: record.trigger_context?.topic || "Talk to Experts",
      name:     record.wa_name,
      phone:    record.wa_phone,
      email:    record.trigger_context?.email || "",
      detail:   record.notes || "",
      status:   record.status,
    };
  }
  if (table === "wa_leads") {
    return {
      leadType: record.category === "checkout_callback" ? "Checkout Callback" : "WhatsApp Inquiry",
      name:     record.raw_payload?.name || "",
      phone:    record.wa_number,
      email:    "",
      detail:   record.free_text || "",
      status:   record.agent_followup ? "needs_followup" : "none",
    };
  }
  if (table === "bespoke_orders") {
    return {
      leadType: "Bespoke Order",
      name:     record.customer_name,
      phone:    record.customer_phone,
      email:    record.customer_email || "",
      detail:   record.description || "",
      status:   record.status,
    };
  }
  return null;
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!WEBHOOK_SECRET || request.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (body.type !== "INSERT") {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
  }

  const mapped = normalize(body.table, body.record);
  if (!mapped) {
    return new Response(JSON.stringify({ ok: true, skipped: "unknown table" }), { status: 200 });
  }

  try {
    await appendLeadRow([
      body.record.created_at || new Date().toISOString(),
      mapped.leadType,
      mapped.name || "",
      mapped.phone || "",
      mapped.email || "",
      mapped.detail || "",
      mapped.status || "",
      body.table,
    ]);
  } catch (err) {
    console.error("[lead-sync] append failed:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
