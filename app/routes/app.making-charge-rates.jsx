import { data as json } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import { useState } from "react";
import { supabase } from "../supabase.server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  const { data: makingRates } = await supabase
    .from("making_charge_rates")
    .select("*")
    .eq("id", 1)
    .single();

  const { data: logisticsTiers } = await supabase
    .from("logistics_tiers")
    .select("*")
    .order("min_value", { ascending: true });

  return json({ makingRates, logisticsTiers: logisticsTiers || [] });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "save_rates") {
    const wastage = parseFloat(formData.get("wastage")) || 0;
    const certNaturalDiaSol = parseFloat(formData.get("certification_rate_natural_diamond_solitaire")) || 0;
    const certNaturalGem = parseFloat(formData.get("certification_rate_natural_gemstone")) || 0;
    const certLabDiaSol = parseFloat(formData.get("certification_rate_lab_diamond_solitaire")) || 0;
    const certLabGem = parseFloat(formData.get("certification_rate_lab_gemstone")) || 0;

    const { error } = await supabase
      .from("making_charge_rates")
      .upsert({
        id: 1,
        wastage,
        certification_rate_natural_diamond_solitaire: certNaturalDiaSol,
        certification_rate_natural_gemstone: certNaturalGem,
        certification_rate_lab_diamond_solitaire: certLabDiaSol,
        certification_rate_lab_gemstone: certLabGem,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (error) return json({ success: false, error: error.message, intent });
    return json({ success: true, intent });
  }

  if (intent === "add_tier") {
    const minValue = parseFloat(formData.get("min_value")) || 0;
    const maxValueStr = formData.get("max_value");
    const maxValue = maxValueStr && maxValueStr.trim() !== "" ? parseFloat(maxValueStr) : null;
    const logisticsCharge = parseFloat(formData.get("logistics_charge")) || 0;
    const ruralKicker = parseFloat(formData.get("rural_kicker")) || 0;

    const { error } = await supabase
      .from("logistics_tiers")
      .insert({ min_value: minValue, max_value: maxValue, logistics_charge: logisticsCharge, rural_kicker: ruralKicker });

    if (error) return json({ success: false, error: error.message, intent });
    return json({ success: true, intent });
  }

  if (intent === "delete_tier") {
    const tierId = parseInt(formData.get("tier_id"));
    const { error } = await supabase
      .from("logistics_tiers")
      .delete()
      .eq("id", tierId);

    if (error) return json({ success: false, error: error.message, intent });
    return json({ success: true, intent });
  }

  return json({ success: false, error: "Unknown intent" });
};

export default function MakingChargeRates() {
  const { makingRates, logisticsTiers } = useLoaderData();
  const actionData = useActionData();

  const [rates, setRates] = useState({
    wastage: String(makingRates?.wastage ?? ""),
    cert_natural_dia_sol: String(makingRates?.certification_rate_natural_diamond_solitaire ?? ""),
    cert_natural_gem: String(makingRates?.certification_rate_natural_gemstone ?? ""),
    cert_lab_dia_sol: String(makingRates?.certification_rate_lab_diamond_solitaire ?? ""),
    cert_lab_gem: String(makingRates?.certification_rate_lab_gemstone ?? ""),
  });

  const [newTier, setNewTier] = useState({
    min_value: "",
    max_value: "",
    logistics_charge: "",
    rural_kicker: "",
  });

  return (
    <s-page heading="Making Charge Rates">

      {actionData?.error && (
        <s-banner tone="critical">{actionData.error}</s-banner>
      )}
      {actionData?.success && actionData?.intent === "save_rates" && (
        <s-banner tone="success">Making charge rates saved.</s-banner>
      )}
      {actionData?.success && actionData?.intent === "add_tier" && (
        <s-banner tone="success">Logistics tier added.</s-banner>
      )}
      {actionData?.success && actionData?.intent === "delete_tier" && (
        <s-banner tone="success">Logistics tier deleted.</s-banner>
      )}

      <Form method="post">
        <input type="hidden" name="_intent" value="save_rates" />

        <s-section heading="Metal Making Charge">
          <s-paragraph>
            Wastage is applied to the intrinsic gold value. E.g. 0.14 = 14% wastage.
          </s-paragraph>
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Wastage (decimal — e.g. 0.14 for 14%)"
              name="wastage"
              type="number"
              value={rates.wastage}
              onInput={(e) => setRates((r) => ({ ...r, wastage: e.target.value }))}
              placeholder="e.g. 0.14"
            />
          </s-stack>
        </s-section>

        <s-section heading="Certification Rates (₹ per carat)">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Natural — Diamond & Solitaire (₹/ct)"
                name="certification_rate_natural_diamond_solitaire"
                type="number"
                value={rates.cert_natural_dia_sol}
                onInput={(e) => setRates((r) => ({ ...r, cert_natural_dia_sol: e.target.value }))}
                placeholder="e.g. 500"
              />
              <s-text-field
                label="Natural — Gemstone (₹/ct)"
                name="certification_rate_natural_gemstone"
                type="number"
                value={rates.cert_natural_gem}
                onInput={(e) => setRates((r) => ({ ...r, cert_natural_gem: e.target.value }))}
                placeholder="e.g. 200"
              />
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Lab Grown — Diamond & Solitaire (₹/ct)"
                name="certification_rate_lab_diamond_solitaire"
                type="number"
                value={rates.cert_lab_dia_sol}
                onInput={(e) => setRates((r) => ({ ...r, cert_lab_dia_sol: e.target.value }))}
                placeholder="e.g. 300"
              />
              <s-text-field
                label="Lab Grown — Gemstone (₹/ct)"
                name="certification_rate_lab_gemstone"
                type="number"
                value={rates.cert_lab_gem}
                onInput={(e) => setRates((r) => ({ ...r, cert_lab_gem: e.target.value }))}
                placeholder="e.g. 150"
              />
            </s-stack>
          </s-stack>
        </s-section>

        <s-button variant="primary" type="submit">Save Rates</s-button>
      </Form>

      <s-section heading="Logistics Tiers">
        <s-paragraph>
          Tier selected where min_value ≤ subtotal &lt; max_value (blank max = no upper limit). If no tier matches, logistics = ₹0.
        </s-paragraph>

        {logisticsTiers.length > 0 ? (
          <s-stack direction="block" gap="tight">
            <s-stack direction="inline" gap="base">
              <s-text emphasis="strong" style={{ flex: 1 }}>Min Value (₹)</s-text>
              <s-text emphasis="strong" style={{ flex: 1 }}>Max Value (₹)</s-text>
              <s-text emphasis="strong" style={{ flex: 1 }}>Logistics Charge (₹)</s-text>
              <s-text emphasis="strong" style={{ flex: 1 }}>Rural Kicker (₹)</s-text>
              <div style={{ width: "80px" }}></div>
            </s-stack>
            {logisticsTiers.map((tier) => (
              <s-stack key={tier.id} direction="inline" gap="base">
                <s-text style={{ flex: 1 }}>{Number(tier.min_value).toLocaleString("en-IN")}</s-text>
                <s-text style={{ flex: 1 }}>
                  {tier.max_value != null ? Number(tier.max_value).toLocaleString("en-IN") : "No limit"}
                </s-text>
                <s-text style={{ flex: 1 }}>₹{Number(tier.logistics_charge).toLocaleString("en-IN")}</s-text>
                <s-text style={{ flex: 1 }}>₹{Number(tier.rural_kicker).toLocaleString("en-IN")}</s-text>
                <div style={{ width: "80px" }}>
                  <Form method="post">
                    <input type="hidden" name="_intent" value="delete_tier" />
                    <input type="hidden" name="tier_id" value={tier.id} />
                    <s-button variant="plain" tone="critical" type="submit">Delete</s-button>
                  </Form>
                </div>
              </s-stack>
            ))}
          </s-stack>
        ) : (
          <s-text tone="subdued">No tiers configured. Add a tier below.</s-text>
        )}

        <Form method="post">
          <input type="hidden" name="_intent" value="add_tier" />
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Min Value (₹)"
                name="min_value"
                type="number"
                value={newTier.min_value}
                onInput={(e) => setNewTier((t) => ({ ...t, min_value: e.target.value }))}
                placeholder="e.g. 0"
              />
              <s-text-field
                label="Max Value (₹, blank = no limit)"
                name="max_value"
                type="number"
                value={newTier.max_value}
                onInput={(e) => setNewTier((t) => ({ ...t, max_value: e.target.value }))}
                placeholder="e.g. 100000"
              />
              <s-text-field
                label="Logistics Charge (₹)"
                name="logistics_charge"
                type="number"
                value={newTier.logistics_charge}
                onInput={(e) => setNewTier((t) => ({ ...t, logistics_charge: e.target.value }))}
                placeholder="e.g. 500"
              />
              <s-text-field
                label="Rural Kicker (₹)"
                name="rural_kicker"
                type="number"
                value={newTier.rural_kicker}
                onInput={(e) => setNewTier((t) => ({ ...t, rural_kicker: e.target.value }))}
                placeholder="e.g. 100"
              />
            </s-stack>
            <s-text tone="subdued">Rural kicker is stored for reference — not used in price calculations.</s-text>
            <s-button variant="secondary" type="submit">Add Tier</s-button>
          </s-stack>
        </Form>
      </s-section>

    </s-page>
  );
}
