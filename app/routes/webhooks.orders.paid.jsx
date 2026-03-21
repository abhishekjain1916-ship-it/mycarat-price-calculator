/**
 * MC-59 — Order sync: Shopify orders/paid → Supabase shopify_orders
 * MC-60 — Goldback accrual: 2% of order total → goldback_transactions + goldback_wallet
 */

import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

const GOLDBACK_RATE = 0.02; // 2% of order total
const LOCK_DAYS     = 30;   // Goldback locked for 30 days post-order

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} from ${shop} — order ${payload?.name}`);

  try {
    await processOrder(payload);
  } catch (err) {
    console.error("[webhook] orders/paid handler failed:", err);
    // Return 200 to prevent Shopify from retrying for non-transient errors
  }

  return new Response(null, { status: 200 });
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function findUserByEmail(email) {
  if (!email) return null;
  const { data, error } = await supabase
    .rpc("get_user_id_by_email", { p_email: email.toLowerCase().trim() });
  if (error) {
    console.warn("[webhook] user lookup failed:", error.message);
    return null;
  }
  return data || null; // returns uuid or null
}

function buildLineItems(shopifyLineItems) {
  return (shopifyLineItems || []).map((item) => {
    // Convert Shopify properties array [{name, value}] to plain object
    const propsObj = {};
    (item.properties || []).forEach((p) => {
      if (p.name && !p.name.startsWith("_")) {
        propsObj[p.name] = p.value;
      }
    });

    return {
      product_id:  String(item.product_id || ""),
      variant_id:  String(item.variant_id || ""),
      title:       item.title || "",
      image_url:   null, // populated by MC-58 product sync later
      quantity:    item.quantity || 1,
      price:       parseFloat(item.price || 0),
      properties:  propsObj,
      // ingredient_breakdown and certificate added by admin after production
      ingredient_breakdown: null,
      certificate: null,
    };
  });
}

function mapFulfillmentStatus(shopifyStatus) {
  // Shopify: null | "partial" | "fulfilled" | "restocked"
  if (!shopifyStatus) return "processing";
  if (shopifyStatus === "fulfilled") return "delivered";
  return "processing";
}

// ── main handler ──────────────────────────────────────────────────────────────

async function processOrder(order) {
  const email        = order.email || order.customer?.email;
  const shopifyId    = String(order.id);
  const orderNumber  = order.name || `#${order.order_number}`;
  const totalPrice   = parseFloat(order.total_price || 0);
  const currency     = order.currency || "INR";
  const orderDate    = order.created_at || new Date().toISOString();
  const lineItems    = buildLineItems(order.line_items);
  const status       = mapFulfillmentStatus(order.fulfillment_status);

  // ── 1. Find Supabase user ─────────────────────────────────────────────────
  const userId = await findUserByEmail(email);

  // ── 2. Upsert order into shopify_orders ───────────────────────────────────
  const { error: orderError } = await supabase
    .from("shopify_orders")
    .upsert({
      shopify_order_id:   shopifyId,
      user_id:            userId,
      order_number:       orderNumber,
      order_date:         orderDate,
      status,
      fulfillment_status: order.fulfillment_status || null,
      total_price:        totalPrice,
      currency,
      line_items:         lineItems,
      updated_at:         new Date().toISOString(),
    }, { onConflict: "shopify_order_id" });

  if (orderError) {
    console.error("[webhook] failed to upsert order:", orderError.message);
    throw orderError;
  }

  console.log(`[webhook] order ${orderNumber} written to Supabase`);

  // ── 3. Goldback accrual (only for known users) ────────────────────────────
  if (!userId) {
    console.log(`[webhook] no Supabase user for email ${email} — skipping Goldback`);
    return;
  }

  const goldbackAmount = Math.round(totalPrice * GOLDBACK_RATE * 100) / 100;

  if (goldbackAmount <= 0) return;

  // 3a. Write transaction (locked — unlocks after LOCK_DAYS)
  const { error: txnError } = await supabase
    .from("goldback_transactions")
    .insert({
      user_id:     userId,
      order_id:    shopifyId,
      type:        "earn",
      amount_inr:  goldbackAmount,
      description: `2% Goldback on order ${orderNumber}`,
    });

  if (txnError) {
    console.error("[webhook] failed to insert Goldback transaction:", txnError.message);
    throw txnError;
  }

  // 3b. Upsert wallet balance
  // First check if wallet exists
  const { data: existing } = await supabase
    .from("goldback_wallet")
    .select("balance_inr")
    .eq("user_id", userId)
    .single();

  if (existing) {
    const newBalance = Math.round((parseFloat(existing.balance_inr) + goldbackAmount) * 100) / 100;
    await supabase
      .from("goldback_wallet")
      .update({ balance_inr: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else {
    await supabase
      .from("goldback_wallet")
      .insert({ user_id: userId, balance_inr: goldbackAmount });
  }

  console.log(`[webhook] Goldback ₹${goldbackAmount} accrued for user ${userId} (locks ${LOCK_DAYS}d)`);
}
