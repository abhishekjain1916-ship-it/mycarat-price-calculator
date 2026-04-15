/**
 * MC-59 — Order sync: Shopify orders/paid → Supabase shopify_orders
 * MC-60 — Goldback accrual: 2% of stone value → Gold Coins (1 coin = 1mg gold)
 *
 * Accounting: coins = (stone_value × rate%) ÷ (gold_rate_per_gram / 1000)
 * INR value is never stored — always derived at display time.
 */

import { authenticate } from "../shopify.server";
import { supabase } from "../supabase.server";

const GOLDBACK_RATE = 0.02; // 2% of stone value
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

  // Calculate stone value from line item properties (set by price calculator at checkout)
  let stoneValue = 0;
  for (const item of lineItems) {
    const sv = parseFloat(item.properties?.["Stone Value"] || 0);
    stoneValue += sv * (item.quantity || 1);
  }

  // If no stone value in properties, skip Goldback (can't calculate coins without it)
  if (stoneValue <= 0) {
    console.log(`[webhook] no stone value in line items — skipping Goldback for order ${orderNumber}`);
    return;
  }

  // Look up current gold rate to convert INR → coins
  const { data: goldRow } = await supabase
    .from("gold_prices")
    .select("price_per_gram")
    .eq("karat", "24k")
    .single();

  const goldPerGram = parseFloat(goldRow?.price_per_gram || 0);
  if (goldPerGram <= 0) {
    console.error(`[webhook] gold_prices has no 24k rate — cannot calculate Goldback coins`);
    return;
  }

  // coins = (stone_value × 2%) ÷ (gold_rate_per_gram / 1000)
  // 1 coin = 1mg gold = gold_rate / 1000 INR
  const goldbackInr = stoneValue * GOLDBACK_RATE;
  const coins = Math.round(goldbackInr / (goldPerGram / 1000));

  if (coins <= 0) return;

  // 3a. Write transaction
  const { error: txnError } = await supabase
    .from("goldback_transactions")
    .insert({
      user_id:      userId,
      order_id:     shopifyId,
      type:         "earn",
      amount_coins: coins,
      description:  `${coins} Gold Coins on order ${orderNumber}`,
    });

  if (txnError) {
    console.error("[webhook] failed to insert Goldback transaction:", txnError.message);
    throw txnError;
  }

  // 3b. Upsert wallet balance
  const { data: existing } = await supabase
    .from("goldback_wallet")
    .select("balance_coins")
    .eq("user_id", userId)
    .single();

  if (existing) {
    const newBalance = parseInt(existing.balance_coins || 0) + coins;
    await supabase
      .from("goldback_wallet")
      .update({ balance_coins: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else {
    await supabase
      .from("goldback_wallet")
      .insert({ user_id: userId, balance_coins: coins });
  }

  console.log(`[webhook] Goldback ${coins} coins accrued for user ${userId} on order ${orderNumber}`);
}
