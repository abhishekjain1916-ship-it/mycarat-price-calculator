/**
 * MC-59 — Order fulfillment sync: updates status + tracking in Supabase
 */

import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} from ${shop} — order ${payload?.name}`);

  try {
    await updateOrderFulfillment(payload);
  } catch (err) {
    console.error("[webhook] orders/fulfilled handler failed:", err);
  }

  return new Response(null, { status: 200 });
};

async function updateOrderFulfillment(order) {
  const shopifyId = String(order.id);

  // Extract tracking from first fulfillment
  const fulfillment = (order.fulfillments || [])[0];
  const trackingNumber = fulfillment?.tracking_number || null;
  const trackingUrl    = fulfillment?.tracking_url    || null;
  const carrier        = fulfillment?.tracking_company || null;

  const { error } = await supabase
    .from("shopify_orders")
    .update({
      status:             "shipped",
      fulfillment_status: order.fulfillment_status || "fulfilled",
      tracking_number:    trackingNumber,
      tracking_url:       trackingUrl,
      carrier,
      updated_at:         new Date().toISOString(),
    })
    .eq("shopify_order_id", shopifyId);

  if (error) {
    console.error("[webhook] failed to update fulfillment:", error.message);
    throw error;
  }

  console.log(`[webhook] order ${order.name} marked shipped with tracking ${trackingNumber}`);
}
