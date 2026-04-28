/**
 * POST /api/admin/schedules/:id   — update status (+ optional notes append)
 *
 * Auth: X-Admin-Secret header (env: ADMIN_SECRET).
 */

import { supabase } from "../supabase.server";

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const VALID_STATUS = new Set(["pending", "confirmed", "completed", "no_show", "cancelled"]);

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function checkAuth(request) {
  if (!ADMIN_SECRET) return false;
  return request.headers.get("x-admin-secret") === ADMIN_SECRET;
}

export const action = async ({ request, params }) => {
  if (!checkAuth(request)) return unauthorized();
  if (request.method !== "POST" && request.method !== "PATCH") {
    return new Response(JSON.stringify({ error: "Use POST or PATCH" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = params;
  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }

  const updates = {};
  if (body.status) {
    if (!VALID_STATUS.has(body.status)) {
      return new Response(JSON.stringify({ error: "Invalid status" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    updates.status = body.status;
  }
  if (typeof body.notes === "string") {
    updates.notes = body.notes;
  }
  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: "Nothing to update" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { data, error } = await supabase
    .from("wa_schedules")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ schedule: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
