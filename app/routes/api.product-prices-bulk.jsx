/**
 * GET /api/product-prices-bulk
 *
 * Returns lab + natural default prices for multiple products in one request.
 * Designed for the listing page — only default prices, no deltas or goldback.
 *
 * Query params:
 *   product_ids  comma-separated Shopify product IDs (max 50)
 *
 * Response shape:
 * {
 *   "gid://shopify/Product/123": { lab: 45000, natural: 62000 },
 *   "gid://shopify/Product/456": { lab: 28000, natural: null },
 *   ...
 * }
 * null means no price available for that diamond type.
 */

import { supabase } from "../supabase.server";
import { getCached, setCached } from "../utils/price-cache.server";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_IDS = 50;

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url        = new URL(request.url);
  const raw        = url.searchParams.get("product_ids") || "";
  const productIds = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, MAX_IDS);

  if (productIds.length === 0) {
    return new Response(JSON.stringify({ error: "product_ids is required" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Serve as many as possible from the in-memory cache
  const result    = {};
  const cacheMiss = [];

  for (const id of productIds) {
    const cached = getCached(id);
    if (cached?.prices) {
      result[id] = {
        lab:     cached.prices.lab?.default     ?? null,
        natural: cached.prices.natural?.default ?? null,
      };
    } else {
      cacheMiss.push(id);
    }
  }

  // Fetch remaining from Supabase in a single query
  if (cacheMiss.length > 0) {
    const { data, error } = await supabase
      .from("product_price_cache")
      .select("product_id, lab_default_price, natural_default_price")
      .in("product_id", cacheMiss);

    if (error) {
      console.error("[api/product-prices-bulk] supabase error:", error.message);
      // Return whatever we have from cache rather than failing entirely
    }

    // Index DB rows by product_id
    const byId = {};
    (data || []).forEach(row => { byId[row.product_id] = row; });

    for (const id of cacheMiss) {
      const row = byId[id];
      if (row) {
        const lab     = row.lab_default_price     ? parseFloat(row.lab_default_price)     : null;
        const natural = row.natural_default_price ? parseFloat(row.natural_default_price) : null;
        result[id] = { lab, natural };
        // Populate the in-memory cache so subsequent single-product calls are free
        setCached(id, { prices: { lab: { default: lab }, natural: { default: natural } } });
      } else {
        result[id] = { lab: null, natural: null };
      }
    }
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type":  "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
};
