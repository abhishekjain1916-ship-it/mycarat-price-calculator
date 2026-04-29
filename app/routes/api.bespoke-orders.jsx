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
  const phone = url.searchParams.get("phone");
  const email = url.searchParams.get("email");

  if (!phone && !email) {
    return new Response(
      JSON.stringify({ error: "phone or email param required" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  let query = supabase
    .from("bespoke_orders")
    .select("id, created_at, status, description, customer_name, customer_email, customer_phone")
    .order("created_at", { ascending: false });

  if (phone) {
    // Match last 10 digits to handle +91 prefix differences
    const last10 = digitsOnly(phone).slice(-10);
    const { data: allRows, error } = await query;
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
  }

  // Fallback: email match
  const { data, error } = await query.eq("customer_email", email.toLowerCase().trim());
  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ orders: data || [] }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
  );
};
