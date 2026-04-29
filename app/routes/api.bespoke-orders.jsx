import { supabase } from "../supabase.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");
  const phone  = url.searchParams.get("phone");

  if (!userId && !phone) {
    return new Response(
      JSON.stringify({ error: "user_id or phone param required" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  const baseSelect = "id, created_at, status, description, customer_name, customer_email, customer_phone";

  // Primary: exact user_id match (most reliable)
  if (userId) {
    const { data, error } = await supabase
      .from("bespoke_orders")
      .select(baseSelect)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Also get phone-matched rows (for orders submitted before user_id was stored)
    let allOrders = data || [];
    if (phone) {
      const last10 = digitsOnly(phone).slice(-10);
      const { data: allRows } = await supabase
        .from("bespoke_orders")
        .select(baseSelect)
        .is("user_id", null)
        .order("created_at", { ascending: false });
      const phoneMatched = (allRows || []).filter(
        r => r.customer_phone && digitsOnly(r.customer_phone).slice(-10) === last10
      );
      // merge, deduplicate by id
      const seen = new Set(allOrders.map(r => r.id));
      phoneMatched.forEach(r => { if (!seen.has(r.id)) allOrders.push(r); });
      allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    return new Response(
      JSON.stringify({ orders: allOrders }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  // Fallback: phone-only match (no user_id)
  const last10 = digitsOnly(phone).slice(-10);
  const { data: allRows, error } = await supabase
    .from("bespoke_orders")
    .select(baseSelect)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  const matched = (allRows || []).filter(
    r => r.customer_phone && digitsOnly(r.customer_phone).slice(-10) === last10
  );
  return new Response(
    JSON.stringify({ orders: matched }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
  );
};
