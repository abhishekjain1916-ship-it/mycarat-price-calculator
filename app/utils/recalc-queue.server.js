import { supabase } from "../supabase.server";

// priority: 0 = normal (background), 1 = high (manual/per-product trigger)
export async function enqueueRecalc(productId, priority = 0) {
  const { error } = await supabase.from("recalc_queue").insert({
    product_id: productId,
    status: "pending",
    priority,
  });
  if (error) console.error("[RecalcQueue] Failed to enqueue:", productId, error.message);
}
