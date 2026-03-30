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
  const product_id    = url.searchParams.get("product_id");
  const product_type  = (url.searchParams.get("product_type")  || "").toLowerCase().trim();
  const product_handle = (url.searchParams.get("product_handle") || "").toLowerCase().trim();
  const collections   = (url.searchParams.get("collections")   || "").toLowerCase().trim();

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

  const [
    { data: priceCache },
    { data: goldRateRow },
    { data: goldbackRates },
  ] = await Promise.all([
    supabase.from("product_price_cache").select("*").eq("product_id", product_id).single(),
    supabase.from("metal_rates").select("rate_per_gram").eq("metal", "gold").order("fetched_at", { ascending: false }).limit(1).single(),
    supabase.from("goldback_rates").select("scope, scope_value, rate_percent").order("created_at", { ascending: true }),
  ]);

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

  // Resolve goldback rate: product > product_type > collection > default
  const rates = goldbackRates || [];
  const defaultRate = parseFloat((rates.find(r => r.scope === "default") || {}).rate_percent || 2);
  const collectionHandles = collections ? collections.split(",").map(s => s.trim()) : [];
  const collectionRate = rates.filter(r => r.scope === "collection" && collectionHandles.includes(r.scope_value))
    .reduce((best, r) => Math.max(best, parseFloat(r.rate_percent)), 0);
  const typeRate    = parseFloat((rates.find(r => r.scope === "product_type" && r.scope_value === product_type) || {}).rate_percent || 0);
  const productRate = parseFloat((rates.find(r => r.scope === "product"      && r.scope_value === product_handle) || {}).rate_percent || 0);
  const goldbackRate = productRate || typeRate || collectionRate || defaultRate;

  const goldRatePerGram = goldRateRow ? parseFloat(goldRateRow.rate_per_gram) : 0;

  const responseData = {
    success: true,
    prices: {
      lab: {
        default:     parseFloat(priceCache.lab_default_price),
        min:         parseFloat(priceCache.lab_min_price),
        max:         parseFloat(priceCache.lab_max_price),
        stone_value: parseFloat(priceCache.lab_stone_value || 0),
      },
      natural: {
        default:     parseFloat(priceCache.natural_default_price),
        min:         parseFloat(priceCache.natural_min_price),
        max:         parseFloat(priceCache.natural_max_price),
        stone_value: parseFloat(priceCache.natural_stone_value || 0),
      },
    },
    goldback: {
      rate_percent:     goldbackRate,
      gold_rate_per_gram: goldRatePerGram,
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