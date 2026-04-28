/**
 * GET  /api/admin/schedules        — list upcoming WhatsApp schedules
 * POST /api/admin/schedules/:id    — update status
 *
 * Auth: simple shared secret via X-Admin-Secret header (env: ADMIN_SECRET).
 *       Quickest path; upgrade to JWT/Shopify auth later.
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

// ── GET: list ─────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  if (!checkAuth(request)) return unauthorized();

  const url    = new URL(request.url);
  const status = url.searchParams.get("status");      // optional filter
  const limit  = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);

  let q = supabase
    .from("wa_schedules")
    .select("*")
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ schedules: data, count: data.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
