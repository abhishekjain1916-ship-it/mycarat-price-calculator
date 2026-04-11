/**
 * GET /api/explore-tags
 * Returns style tags grouped by product_type.
 * Used by the storefront explore section and navigation overlay.
 *
 * Response shape:
 * {
 *   "rings":    [{ tag_value: "halo", display_label: "Halo" }, ...],
 *   "earrings": [...],
 *   ...
 * }
 */

import { supabase } from "../supabase.server";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { data, error } = await supabase
    .from("product_type_style_tags")
    .select("product_type, tag_value, display_label")
    .order("product_type", { ascending: true })
    .order("display_label", { ascending: true });

  if (error) {
    console.error("[api/explore-tags] query failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Group by product_type
  const grouped = {};
  (data || []).forEach((row) => {
    if (!grouped[row.product_type]) grouped[row.product_type] = [];
    grouped[row.product_type].push({
      tag_value:     row.tag_value,
      display_label: row.display_label,
    });
  });

  return new Response(JSON.stringify(grouped), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type":  "application/json",
      "Cache-Control": "public, max-age=300", // cache 5 min — tags change rarely
    },
  });
};
