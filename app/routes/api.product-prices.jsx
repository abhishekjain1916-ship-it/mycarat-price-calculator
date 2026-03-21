import { supabase } from "../supabase.server";
import { getCached, setCached } from "../utils/price-cache.server";
import { startRecalcWorker } from "../utils/recalc-worker.server";

export const loader = async ({ request }) => {
  startRecalcWorker(); // no-op after first call — starts background queue processor

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const url = new URL(request.url);
  const product_id = url.searchParams.get("product_id");

  if (!product_id) {
    return new Response(JSON.stringify({ error: "product_id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const cached = getCached(product_id);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Cache": "HIT",
      },
    });
  }

  const { data: priceCache } = await supabase
    .from("product_price_cache")
    .select("*")
    .eq("product_id", product_id)
    .single();

  if (!priceCache) {
    return new Response(JSON.stringify({ error: "Price data not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // Paginate to bypass Supabase's 1000 max-rows server limit
  const allDeltas = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data: page } = await supabase
      .from("product_delta_cache")
      .select("diamond_type, component, option_value, delta_amount")
      .eq("product_id", product_id)
      .range(from, from + PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    allDeltas.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  const deltas = allDeltas;

  const responseData = {
    success: true,
    prices: {
      lab: {
        default: parseFloat(priceCache.lab_default_price),
        min: parseFloat(priceCache.lab_min_price),
        max: parseFloat(priceCache.lab_max_price),
      },
      natural: {
        default: parseFloat(priceCache.natural_default_price),
        min: parseFloat(priceCache.natural_min_price),
        max: parseFloat(priceCache.natural_max_price),
      },
    },
    deltas: deltas || [],
  };

  setCached(product_id, responseData);

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, max-age=300",
    },
  });
};