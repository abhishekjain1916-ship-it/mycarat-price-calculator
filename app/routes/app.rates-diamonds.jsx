import { data as json } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import { useState } from "react";
import { supabase } from "../supabase.server";

const ROUND_BUCKETS = ["S1 (≤1.2mm)", "S2 (1.3-2.0mm)", "S3 (2.1-2.6mm)", "S4 (2.7-2.9mm)", "S5 (3.0-3.2mm)"];
const FANCY_BUCKETS = ["S1 (<0.01ct)", "S2 (0.01-0.10ct)", "S3 (0.10-0.20ct)"];
const LAB_CC = ["EF VVS", "EF VS", "FG VS"];
const NATURAL_CC = ["EF VVS", "EF VS", "FG VVS", "FG VS", "GH VS", "GH SI"];
const FANCY_SHAPES = ["Baguette", "Marquise", "Oval", "Pear", "Princess", "Emerald", "Cushion", "Radiant"];
const COMB_ID_RE = /[()≤<>. ]/g;
const isPrime = (cc) => cc === "EF VVS" || cc === "EF VS";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  const [{ data: roundRates }, { data: fancyRates }] = await Promise.all([
    supabase.from("diamond_rates_round")
      .select("diamond_type, colour_clarity, size_bucket, price_per_carat")
      .order("diamond_type").order("colour_clarity").order("size_bucket"),
    supabase.from("diamond_rates_fancy")
      .select("diamond_type, colour_clarity, size_bucket, price_per_carat")
      .eq("shape", "Marquise") // one shape — all shapes share the same price
      .order("diamond_type").order("colour_clarity").order("size_bucket"),
  ]);

  const toMap = (rows) => {
    const m = {};
    for (const r of (rows || [])) {
      if (!m[r.diamond_type]) m[r.diamond_type] = {};
      if (!m[r.diamond_type][r.colour_clarity]) m[r.diamond_type][r.colour_clarity] = {};
      m[r.diamond_type][r.colour_clarity][r.size_bucket] = r.price_per_carat;
    }
    return m;
  };

  return json({ roundMap: toMap(roundRates), fancyMap: toMap(fancyRates) });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const diamond_type = formData.get("diamond_type");
  const rows = JSON.parse(formData.get("rows")); // [{colour_clarity, buckets: {bucket: price}}]

  if (intent === "save_round") {
    const upserts = [];
    for (const row of rows) {
      for (const [bucket, price] of Object.entries(row.buckets)) {
        if (!price && price !== 0) continue;
        const combId = `${diamond_type}_${row.colour_clarity}_${bucket}`.replace(COMB_ID_RE, "_");
        upserts.push({ combination_id: combId, diamond_type, colour_clarity: row.colour_clarity, size_bucket: bucket, is_prime: isPrime(row.colour_clarity), price_per_carat: parseFloat(price) });
      }
    }
    const { error } = await supabase.from("diamond_rates_round").upsert(upserts, { onConflict: "combination_id" });
    if (error) return json({ intent, success: false, error: error.message });
    return json({ intent, success: true, diamond_type });
  }

  if (intent === "save_fancy") {
    const upserts = [];
    for (const row of rows) {
      for (const [bucket, price] of Object.entries(row.buckets)) {
        if (!price && price !== 0) continue;
        for (const shape of FANCY_SHAPES) {
          const combId = `${diamond_type}_${shape}_${row.colour_clarity}_${bucket}`.replace(COMB_ID_RE, "_");
          upserts.push({ combination_id: combId, diamond_type, shape, colour_clarity: row.colour_clarity, size_bucket: bucket, is_prime: isPrime(row.colour_clarity), price_per_carat: parseFloat(price) });
        }
      }
    }
    const { error } = await supabase.from("diamond_rates_fancy").upsert(upserts, { onConflict: "combination_id" });
    if (error) return json({ intent, success: false, error: error.message });
    return json({ intent, success: true, diamond_type });
  }

  return json({ success: false, error: "Unknown intent" });
};

const thStyle = { padding: "8px 12px", textAlign: "left", background: "#f5f5f5", borderBottom: "2px solid #ddd", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" };
const tdStyle = { padding: "6px 8px", borderBottom: "1px solid #eee" };
const inputStyle = { width: "90px", padding: "5px 8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "13px" };

export default function RatesDiamonds() {
  const { roundMap, fancyMap } = useLoaderData();
  const actionData = useActionData();
  const [activeType, setActiveType] = useState("Lab Grown");

  const ccList = activeType === "Lab Grown" ? LAB_CC : NATURAL_CC;

  const initGrid = (map, type, buckets) => {
    const cc = type === "Lab Grown" ? LAB_CC : NATURAL_CC;
    const result = {};
    for (const c of cc) {
      result[c] = {};
      for (const b of buckets) {
        result[c][b] = String(map[type]?.[c]?.[b] ?? "");
      }
    }
    return result;
  };

  const [roundRates, setRoundRates] = useState(() => ({
    "Lab Grown": initGrid(roundMap, "Lab Grown", ROUND_BUCKETS),
    "Natural": initGrid(roundMap, "Natural", ROUND_BUCKETS),
  }));

  const [fancyRates, setFancyRates] = useState(() => ({
    "Lab Grown": initGrid(fancyMap, "Lab Grown", FANCY_BUCKETS),
    "Natural": initGrid(fancyMap, "Natural", FANCY_BUCKETS),
  }));

  const updateRate = (setter, cc, bucket, value) => {
    setter(prev => ({
      ...prev,
      [activeType]: { ...prev[activeType], [cc]: { ...prev[activeType][cc], [bucket]: value } },
    }));
  };

  const buildRows = (rates, buckets) =>
    ccList.map(cc => ({ colour_clarity: cc, buckets: Object.fromEntries(buckets.map(b => [b, rates[activeType][cc][b]])) }));

  const RatesGrid = ({ rates, setRates, buckets, intent, label }) => (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={thStyle}>Colour / Clarity</th>
              {buckets.map(b => <th key={b} style={thStyle}>{b}</th>)}
            </tr>
          </thead>
          <tbody>
            {ccList.map(cc => (
              <tr key={cc}>
                <td style={{ ...tdStyle, fontWeight: "500", whiteSpace: "nowrap" }}>{cc}</td>
                {buckets.map(b => (
                  <td key={b} style={tdStyle}>
                    <input
                      type="number"
                      style={inputStyle}
                      value={rates[activeType][cc][b]}
                      onChange={(e) => updateRate(setRates, cc, b, e.target.value)}
                      placeholder="—"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Form method="post" style={{ marginTop: "16px" }}>
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="diamond_type" value={activeType} />
        <input type="hidden" name="rows" value={JSON.stringify(buildRows(rates, buckets))} />
        <s-button variant="primary" type="submit">Save {label} Rates ({activeType})</s-button>
      </Form>
    </>
  );

  return (
    <s-page heading="Diamond Rates">

      {actionData?.success && (
        <s-banner tone="success">
          {actionData.intent === "save_round" ? "Round" : "Fancy"} rates saved for {actionData.diamond_type}.
        </s-banner>
      )}
      {actionData?.error && <s-banner tone="critical">{actionData.error}</s-banner>}

      <s-section heading="Diamond Type">
        <s-stack direction="inline" gap="base">
          {["Lab Grown", "Natural"].map(type => (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              style={{
                padding: "8px 20px", border: "2px solid", cursor: "pointer",
                borderColor: activeType === type ? "#008060" : "#ccc",
                borderRadius: "6px",
                background: activeType === type ? "#e6f7f2" : "#fff",
                color: activeType === type ? "#008060" : "#444",
                fontWeight: activeType === type ? "600" : "400",
              }}
            >
              {type}
            </button>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Round Diamond Rates (₹ per carat)">
        <s-paragraph>Size buckets by stone diameter (mm).</s-paragraph>
        <RatesGrid rates={roundRates} setRates={setRoundRates} buckets={ROUND_BUCKETS} intent="save_round" label="Round" />
      </s-section>

      <s-section heading="Fancy Diamond Rates (₹ per carat)">
        <s-paragraph>Applies to all shapes: Baguette, Marquise, Oval, Pear, Princess, Emerald, Cushion, Radiant. Size buckets by carat weight.</s-paragraph>
        <RatesGrid rates={fancyRates} setRates={setFancyRates} buckets={FANCY_BUCKETS} intent="save_fancy" label="Fancy" />
      </s-section>

    </s-page>
  );
}
