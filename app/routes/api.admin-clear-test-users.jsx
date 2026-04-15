/**
 * api.admin-clear-test-users.jsx
 * ONE-TIME utility — lists or deletes all Supabase auth users.
 * DELETE THIS FILE after testing is complete.
 *
 * GET  /api/admin-clear-test-users          → list all users
 * POST /api/admin-clear-test-users          → delete all users + related data
 * Body: { confirm: "DELETE_ALL_USERS" }     → safety check
 */

import { supabase } from "../supabase.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return json({ error: error.message }, { status: 500 });

  const users = (data?.users || []).map(u => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    created_at: u.created_at,
    provider: u.app_metadata?.provider || "unknown",
  }));

  return json({ count: users.length, users });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.confirm !== "DELETE_ALL_USERS") {
    return json({ error: "Send { confirm: 'DELETE_ALL_USERS' } to proceed." }, { status: 400 });
  }

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return json({ error: error.message }, { status: 500 });

  const users = data?.users || [];
  const results = [];

  for (const u of users) {
    // Clear related data first (bypass RLS via service role)
    await supabase.from("signup_rewards_claimed").delete().eq("user_id", u.id);
    await supabase.from("goldback_transactions").delete().eq("user_id", u.id);
    await supabase.from("goldback_wallet").delete().eq("user_id", u.id);
    await supabase.from("wishlists").delete().eq("user_id", u.id);
    await supabase.from("addresses").delete().eq("user_id", u.id);
    await supabase.from("profiles").delete().eq("user_id", u.id);
    await supabase.from("auth_phone_users").delete().eq("user_id", u.id);

    const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
    results.push({ id: u.id, email: u.email, deleted: !delErr, error: delErr?.message });
  }

  return json({ deleted: results.filter(r => r.deleted).length, total: users.length, results });
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
