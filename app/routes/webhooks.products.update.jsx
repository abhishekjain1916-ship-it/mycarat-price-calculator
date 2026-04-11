/**
 * Shopify products/create + products/update webhook
 * Extracts style:* tags and upserts into product_type_style_tags table.
 * Both topics point to this handler (see shopify.app.toml).
 */

import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

function toDisplayLabel(tagValue) {
  return tagValue
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const action = async ({ request }) => {
  const { topic, payload } = await authenticate.webhook(request);

  const productType = (payload?.product_type || "").toLowerCase().trim();
  const rawTags     = payload?.tags || "";
  const tags        = rawTags.split(",").map((t) => t.trim()).filter(Boolean);

  if (!productType) {
    console.log(`[webhook] ${topic} — no product_type, skipping style tag sync`);
    return new Response(null, { status: 200 });
  }

  const styleTags = tags
    .filter((t) => t.startsWith("style:"))
    .map((t) => t.replace("style:", "").trim())
    .filter(Boolean);

  if (styleTags.length === 0) {
    return new Response(null, { status: 200 });
  }

  const inserts = styleTags.map((tv) => ({
    product_type:  productType,
    tag_value:     tv,
    display_label: toDisplayLabel(tv),
  }));

  const { error } = await supabase
    .from("product_type_style_tags")
    .upsert(inserts, { onConflict: "product_type,tag_value", ignoreDuplicates: true });

  if (error) {
    console.error(`[webhook] ${topic} style tag sync failed:`, error.message);
  } else {
    console.log(`[webhook] ${topic} — synced ${styleTags.length} style tags for "${productType}"`);
  }

  return new Response(null, { status: 200 });
};
