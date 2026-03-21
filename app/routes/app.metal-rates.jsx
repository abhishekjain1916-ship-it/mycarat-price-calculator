import { data as json } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import { useState } from "react";
import { supabase } from "../supabase.server";
import { enqueueRecalc } from "../utils/recalc-queue.server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);
  const { data: goldRate } = await supabase
    .from("metal_rates")
    .select("*")
    .eq("metal", "gold")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single();

  const { data: silverRate } = await supabase
    .from("metal_rates")
    .select("*")
    .eq("metal", "silver")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single();

  return json({ goldRate, silverRate });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "recalc_all") {
    const [m, d, s, g] = await Promise.all([
      supabase.from("product_specs_metal").select("product_id"),
      supabase.from("product_specs_diamonds").select("product_id"),
      supabase.from("product_specs_solitaires").select("product_id"),
      supabase.from("product_specs_gemstones").select("product_id"),
    ]);
    const allIds = [...new Set([
      ...(m.data || []).map((r) => r.product_id),
      ...(d.data || []).map((r) => r.product_id),
      ...(s.data || []).map((r) => r.product_id),
      ...(g.data || []).map((r) => r.product_id),
    ])];
    await Promise.all(allIds.map((id) => enqueueRecalc(id)));
    return json({ intent: "recalc_all", queued: allIds.length });
  }

  // Default: save rates
  const goldRate = parseFloat(formData.get("gold_rate"));
  const silverRate = parseFloat(formData.get("silver_rate"));

  if (!goldRate || !silverRate || goldRate <= 0 || silverRate <= 0) {
    return json({ intent: "save_rates", success: false, error: "Please enter valid rates for both Gold and Silver." });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("metal_rates")
    .insert([
      { metal: "gold", rate_per_gram: goldRate, fetched_at: now, source: "IBJA Manual" },
      { metal: "silver", rate_per_gram: silverRate, fetched_at: now, source: "IBJA Manual" },
    ]);

  if (error) return json({ intent: "save_rates", success: false, error: error.message });

  const { data: allProducts } = await supabase
    .from("product_specs_metal")
    .select("product_id");
  const uniqueIds = [...new Set((allProducts || []).map((p) => p.product_id))];
  await Promise.all(uniqueIds.map((id) => enqueueRecalc(id)));

  return json({ intent: "save_rates", success: true, queued: uniqueIds.length });
};

export default function MetalRates() {
  const { goldRate, silverRate } = useLoaderData();
  const actionData = useActionData();
  const [gold, setGold] = useState("");
  const [silver, setSilver] = useState("");

  const formatDate = (dateStr) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short",
    });
  };

  return (
    <s-page heading="Metal Rates">

      <s-section heading="Current Rates (₹ per gram)">
        <s-stack direction="inline" gap="loose">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text emphasis="strong">Gold (24KT)</s-text>
              <s-heading>
                ₹{goldRate ? Number(goldRate.rate_per_gram).toLocaleString("en-IN") : "—"}
              </s-heading>
              <s-text tone="subdued">
                Last updated: {formatDate(goldRate?.fetched_at)}
              </s-text>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text emphasis="strong">Silver (999)</s-text>
              <s-heading>
                ₹{silverRate ? Number(silverRate.rate_per_gram).toLocaleString("en-IN") : "—"}
              </s-heading>
              <s-text tone="subdued">
                Last updated: {formatDate(silverRate?.fetched_at)}
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Update Rates">
        <s-paragraph>
          Enter today's IBJA rates below. All product prices will update immediately.
        </s-paragraph>

        {actionData?.intent === "save_rates" && actionData?.success && (
          <s-banner tone="success">
            Rates updated! Recalculation queued for {actionData.queued} products — prices will update within ~10 minutes.
          </s-banner>
        )}
        {actionData?.error && (
          <s-banner tone="critical">{actionData.error}</s-banner>
        )}

        <Form method="post">
          <input type="hidden" name="intent" value="save_rates" />
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Gold Rate (₹ per gram, 24KT)"
                name="gold_rate"
                type="number"
                value={gold}
                onInput={(e) => setGold(e.target.value)}
                placeholder="e.g. 7250"
              />
              <s-text-field
                label="Silver Rate (₹ per gram, 999)"
                name="silver_rate"
                type="number"
                value={silver}
                onInput={(e) => setSilver(e.target.value)}
                placeholder="e.g. 92"
              />
            </s-stack>
            <s-button variant="primary" type="submit">Update Rates</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Recalculate All Prices">
        <s-paragraph>
          Use this after updating diamond rates, solitaire rates, or making charges to refresh cached prices for all products.
        </s-paragraph>
        {actionData?.intent === "recalc_all" && (
          <s-banner tone="success">
            Recalculation queued for {actionData.queued} products — prices will update within ~10 minutes.
          </s-banner>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="recalc_all" />
          <s-button type="submit">Recalculate All Products</s-button>
        </Form>
      </s-section>

    </s-page>
  );
}