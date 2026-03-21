import { data as json } from "react-router";
import { useLoaderData, useActionData, useFetcher, Form } from "react-router";
import { useState, useEffect } from "react";
import { supabase } from "../supabase.server";

const WEIGHT_RANGES = ["0.18-0.22","0.23-0.29","0.30-0.39","0.40-0.49","0.50-0.59","0.60-0.69","0.70-0.79","0.80-0.89","0.90-0.99","1.00-1.09","1.10-1.24","1.25-1.49","1.50-1.74","1.75-1.99","2.00-2.49","2.50-2.99","3.00-3.99","4.00-4.99","5.00-5.99","6.00-9.99","10.00+"];
const LAB_COLOURS = ["D", "E", "F"];
const NATURAL_COLOURS = ["E", "F", "G", "H", "I", "J"];
const LAB_CLARITIES = ["FL", "IF", "VVS1", "VVS2", "VS1", "VS2"];
const NATURAL_CLARITIES = ["VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"];
const MODIFIER_TYPES = ["shape", "fluorescence", "certification", "cut_pol_sym"];

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  const { data: modifiers } = await supabase
    .from("solitaire_modifiers")
    .select("id, modifier_type, modifier_value, modifier_pct")
    .order("modifier_type").order("modifier_value");

  return json({ modifiers: modifiers || [] });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "load_core") {
    const diamond_type = formData.get("diamond_type");
    const colour = formData.get("colour");
    const clarity = formData.get("clarity");

    const { data: rates } = await supabase
      .from("solitaire_rates_core")
      .select("weight_range, price_per_carat")
      .eq("diamond_type", diamond_type)
      .eq("colour", colour)
      .eq("clarity", clarity);

    const priceMap = {};
    for (const r of (rates || [])) {
      priceMap[r.weight_range] = r.price_per_carat;
    }
    return json({ intent: "load_core", priceMap });
  }

  if (intent === "save_core") {
    const diamond_type = formData.get("diamond_type");
    const colour = formData.get("colour");
    const clarity = formData.get("clarity");
    const prices = JSON.parse(formData.get("prices")); // { weight_range: price_str }

    const upserts = [];
    for (const [weight_range, price] of Object.entries(prices)) {
      if (!price) continue;
      const combId = `${diamond_type}_${colour}_${clarity}_${weight_range}`;
      upserts.push({
        combination_id: combId,
        diamond_type,
        colour,
        clarity,
        weight_range,
        cut_pol_sym: "base",
        price_per_carat: parseFloat(price),
      });
    }

    if (upserts.length === 0) return json({ intent, success: false, error: "No prices to save." });

    const { error } = await supabase
      .from("solitaire_rates_core")
      .upsert(upserts, { onConflict: "combination_id" });

    if (error) return json({ intent, success: false, error: error.message });
    return json({ intent, success: true, saved: upserts.length });
  }

  if (intent === "save_modifiers") {
    const updates = JSON.parse(formData.get("modifiers")); // [{id, modifier_pct}]
    const promises = updates.map(({ id, modifier_pct }) =>
      supabase.from("solitaire_modifiers").update({ modifier_pct: parseFloat(modifier_pct) || 0 }).eq("id", id)
    );
    const results = await Promise.all(promises);
    const failed = results.find(r => r.error);
    if (failed) return json({ intent, success: false, error: failed.error.message });
    return json({ intent, success: true });
  }

  return json({ success: false, error: "Unknown intent" });
};

const selectStyle = { padding: "7px 10px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px" };
const inputStyle = { width: "110px", padding: "5px 8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "13px" };
const thStyle = { padding: "8px 12px", textAlign: "left", background: "#f5f5f5", borderBottom: "2px solid #ddd", fontSize: "13px", fontWeight: "600" };
const tdStyle = { padding: "6px 10px", borderBottom: "1px solid #eee", fontSize: "13px" };

export default function RatesSolitaires() {
  const { modifiers } = useLoaderData();
  const actionData = useActionData();
  const coreFetcher = useFetcher();

  const [diamondType, setDiamondType] = useState("Lab");
  const [colour, setColour] = useState("E");
  const [clarity, setClarity] = useState("VVS2");
  const [prices, setPrices] = useState({});
  const [modifierEdits, setModifierEdits] = useState(
    Object.fromEntries(modifiers.map(m => [m.id, String(m.modifier_pct)]))
  );

  const colours = diamondType === "Lab" ? LAB_COLOURS : NATURAL_COLOURS;
  const clarities = diamondType === "Lab" ? LAB_CLARITIES : NATURAL_CLARITIES;

  // When type changes, reset colour/clarity to valid defaults
  useEffect(() => {
    const newColour = diamondType === "Lab" ? "E" : "H";
    const newClarity = diamondType === "Lab" ? "VVS2" : "VS2";
    setColour(newColour);
    setClarity(newClarity);
    setPrices({});
  }, [diamondType]);

  useEffect(() => {
    if (coreFetcher.data?.intent === "load_core") {
      const loaded = {};
      for (const wr of WEIGHT_RANGES) {
        loaded[wr] = coreFetcher.data.priceMap[wr] ? String(coreFetcher.data.priceMap[wr]) : "";
      }
      setPrices(loaded);
    }
  }, [coreFetcher.data]);

  const loadRates = () => {
    coreFetcher.submit(
      { intent: "load_core", diamond_type: diamondType, colour, clarity },
      { method: "post" }
    );
  };

  const loaded = coreFetcher.data?.intent === "load_core";
  const filledCount = Object.values(prices).filter(v => v).length;

  // Group modifiers by type for display
  const modsByType = {};
  for (const m of modifiers) {
    if (!modsByType[m.modifier_type]) modsByType[m.modifier_type] = [];
    modsByType[m.modifier_type].push(m);
  }

  return (
    <s-page heading="Solitaire Rates">

      {actionData?.intent === "save_core" && actionData?.success && (
        <s-banner tone="success">Saved {actionData.saved} price{actionData.saved !== 1 ? "s" : ""} for {diamondType} / {colour} / {clarity}.</s-banner>
      )}
      {actionData?.intent === "save_modifiers" && actionData?.success && (
        <s-banner tone="success">Modifiers updated.</s-banner>
      )}
      {actionData?.error && <s-banner tone="critical">{actionData.error}</s-banner>}

      <s-section heading="Core Rates (₹ per carat)">
        <s-paragraph>Select a type / colour / clarity combination to view and edit its prices by weight range.</s-paragraph>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "16px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Type</div>
            <select style={selectStyle} value={diamondType} onChange={(e) => setDiamondType(e.target.value)}>
              <option value="Lab">Lab</option>
              <option value="Natural">Natural</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Colour</div>
            <select style={selectStyle} value={colour} onChange={(e) => setColour(e.target.value)}>
              {colours.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Clarity</div>
            <select style={selectStyle} value={clarity} onChange={(e) => setClarity(e.target.value)}>
              {clarities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            onClick={loadRates}
            style={{ padding: "8px 18px", background: "#008060", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "14px" }}
          >
            Load Rates
          </button>
        </div>

        {coreFetcher.state === "submitting" && (
          <div style={{ color: "#888", fontStyle: "italic", marginBottom: "12px" }}>Loading...</div>
        )}

        {loaded && (
          <>
            <div style={{ marginBottom: "8px", color: "#555", fontSize: "13px" }}>
              {filledCount} of {WEIGHT_RANGES.length} weight ranges filled for <strong>{diamondType} / {colour} / {clarity}</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px", marginBottom: "16px" }}>
              {WEIGHT_RANGES.map(wr => (
                <div key={wr} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "13px", color: "#333", width: "80px", flexShrink: 0 }}>{wr} ct</span>
                  <input
                    type="number"
                    style={inputStyle}
                    value={prices[wr] || ""}
                    onChange={(e) => setPrices(prev => ({ ...prev, [wr]: e.target.value }))}
                    placeholder="₹/ct"
                  />
                </div>
              ))}
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="save_core" />
              <input type="hidden" name="diamond_type" value={diamondType} />
              <input type="hidden" name="colour" value={colour} />
              <input type="hidden" name="clarity" value={clarity} />
              <input type="hidden" name="prices" value={JSON.stringify(prices)} />
              <s-button variant="primary" type="submit">Save Rates ({diamondType} / {colour} / {clarity})</s-button>
            </Form>
          </>
        )}
      </s-section>

      <s-section heading="Modifiers">
        <s-paragraph>
          Modifier % is applied multiplicatively to the base price. 0 = no adjustment. Shape modifiers are currently all 0%.
        </s-paragraph>
        {MODIFIER_TYPES.map(type => (
          modsByType[type] && (
            <div key={type} style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#444", marginBottom: "8px", textTransform: "capitalize" }}>
                {type.replace(/_/g, " ")}
              </div>
              <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: "400px" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Value</th>
                    <th style={thStyle}>Modifier %</th>
                  </tr>
                </thead>
                <tbody>
                  {modsByType[type].map(m => (
                    <tr key={m.id}>
                      <td style={tdStyle}>{m.modifier_value}</td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          step="0.01"
                          style={{ ...inputStyle, width: "80px" }}
                          value={modifierEdits[m.id]}
                          onChange={(e) => setModifierEdits(prev => ({ ...prev, [m.id]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ))}
        <Form method="post">
          <input type="hidden" name="intent" value="save_modifiers" />
          <input type="hidden" name="modifiers" value={JSON.stringify(
            modifiers.map(m => ({ id: m.id, modifier_pct: modifierEdits[m.id] }))
          )} />
          <s-button type="submit">Save Modifiers</s-button>
        </Form>
      </s-section>

    </s-page>
  );
}
