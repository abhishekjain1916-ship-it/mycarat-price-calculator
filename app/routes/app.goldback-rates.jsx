import { data as json } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import { useState } from "react";
import { supabase } from "../supabase.server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);
  const { data: rates } = await supabase
    .from("goldback_rates")
    .select("*")
    .order("scope")
    .order("scope_value");
  return json({ rates: rates || [] });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add") {
    const scope       = formData.get("scope");
    const scope_value = formData.get("scope_value") || null;
    const rate_percent = parseFloat(formData.get("rate_percent"));

    if (!scope || isNaN(rate_percent) || rate_percent <= 0) {
      return json({ success: false, error: "Invalid input — scope and a positive rate are required." });
    }
    if (scope !== "default" && !scope_value) {
      return json({ success: false, error: "scope_value is required for non-default rules." });
    }

    const { error } = await supabase.from("goldback_rates").upsert(
      { scope, scope_value: scope === "default" ? null : scope_value, rate_percent },
      { onConflict: "scope,scope_value" }
    );
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, intent: "add" });
  }

  if (intent === "delete") {
    const id = formData.get("id");
    const { error } = await supabase.from("goldback_rates").delete().eq("id", id);
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, intent: "delete" });
  }

  return json({ success: false, error: "Unknown intent." });
};

const SCOPE_LABELS = {
  default:      "Default (all products)",
  product_type: "Product type",
  collection:   "Collection (handle)",
  product:      "Product (handle)",
};

const SCOPE_PRIORITY = { product: 1, product_type: 2, collection: 3, default: 4 };

export default function GoldbackRatesPage() {
  const { rates } = useLoaderData();
  const actionData = useActionData();
  const [scope, setScope] = useState("product_type");

  const sorted = [...rates].sort((a, b) =>
    (SCOPE_PRIORITY[a.scope] || 9) - (SCOPE_PRIORITY[b.scope] || 9)
  );

  return (
    <div style={{ padding: "24px", maxWidth: 700, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Goldback Rates</h1>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>
        Configure the % of stone value (diamond + solitaire + gemstone) given as Goldback.
        Priority: <strong>product → product type → collection → default</strong>.
        The % is never shown to customers — only the resulting gold coins are displayed.
      </p>

      {actionData?.error && (
        <div style={{ background: "#fff0f0", border: "1px solid #fcc", padding: "10px 14px", borderRadius: 8, marginBottom: 16, color: "#c00", fontSize: 13 }}>
          {actionData.error}
        </div>
      )}
      {actionData?.success && (
        <div style={{ background: "#f0fff4", border: "1px solid #9de", padding: "10px 14px", borderRadius: 8, marginBottom: 16, color: "#1d9e75", fontSize: 13 }}>
          Saved successfully.
        </div>
      )}

      {/* Existing rules */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 32, fontSize: 14 }}>
        <thead>
          <tr style={{ background: "#f5f5f5" }}>
            <th style={th}>Scope</th>
            <th style={th}>Value</th>
            <th style={th}>Rate %</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td colSpan={4} style={{ padding: "12px 10px", color: "#999", textAlign: "center" }}>No rules yet — add a default rate below.</td></tr>
          )}
          {sorted.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{SCOPE_LABELS[r.scope] || r.scope}</td>
              <td style={td}>{r.scope_value || "—"}</td>
              <td style={td}><strong>{r.rate_percent}%</strong></td>
              <td style={{ ...td, textAlign: "right" }}>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" style={{ background: "none", border: "none", color: "#c00", cursor: "pointer", fontSize: 13 }}
                    onClick={(e) => { if (!confirm("Delete this rule?")) e.preventDefault(); }}>
                    Delete
                  </button>
                </Form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add rule */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Add / update a rule</h2>
      <Form method="post" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="hidden" name="intent" value="add" />

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px" }}>
            <label style={label}>Scope</label>
            <select name="scope" value={scope} onChange={e => setScope(e.target.value)} style={input}>
              <option value="default">Default (all products)</option>
              <option value="product_type">Product type</option>
              <option value="collection">Collection (handle)</option>
              <option value="product">Product (handle)</option>
            </select>
          </div>

          {scope !== "default" && (
            <div style={{ flex: "1 1 160px" }}>
              <label style={label}>
                {scope === "product_type" ? "Product type (e.g. ring)" :
                 scope === "collection"   ? "Collection handle (e.g. bridal)" :
                                           "Product handle (e.g. hana-diamond-ring)"}
              </label>
              <input name="scope_value" type="text" style={input} placeholder={
                scope === "product_type" ? "ring" :
                scope === "collection"   ? "bridal" : "hana-diamond-ring"
              } />
            </div>
          )}

          <div style={{ flex: "0 0 100px" }}>
            <label style={label}>Rate %</label>
            <input name="rate_percent" type="number" min="0.1" max="20" step="0.1" style={input} placeholder="2" />
          </div>
        </div>

        <div>
          <button type="submit" style={{
            background: "#1d9e75", color: "#fff", border: "none",
            padding: "10px 20px", borderRadius: 8, fontSize: 14,
            fontWeight: 600, cursor: "pointer",
          }}>
            Save rule
          </button>
        </div>
      </Form>

      <div style={{ marginTop: 32, padding: "14px 16px", background: "#fffbf0", border: "1px solid #f0e0a0", borderRadius: 8, fontSize: 13, color: "#666" }}>
        <strong>After updating rates:</strong> stone values in the price cache remain valid (they don't depend on the %).
        The rate is applied at runtime — no cache rebuild needed when you change a rate.
        Cache rebuild is only needed if metal or stone rates change.
      </div>
    </div>
  );
}

const th = { padding: "8px 10px", textAlign: "left", fontWeight: 600, fontSize: 13, color: "#555" };
const td = { padding: "10px 10px", color: "#333" };
const label = { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" };
const input = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 };
