import { data as json } from "react-router";
import { useActionData, Form, useFetcher } from "react-router";
import React, { useState, useEffect } from "react";
import { supabase } from "../supabase.server";
import { authenticate } from "../shopify.server";
import { enqueueRecalc } from "../utils/recalc-queue.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({});
};

const BUCKETS = [
  [0.18, 0.23, "0.18-0.22"], [0.23, 0.30, "0.23-0.29"], [0.30, 0.40, "0.30-0.39"],
  [0.40, 0.50, "0.40-0.49"], [0.50, 0.60, "0.50-0.59"], [0.60, 0.70, "0.60-0.69"],
  [0.70, 0.80, "0.70-0.79"], [0.80, 0.90, "0.80-0.89"], [0.90, 1.00, "0.90-0.99"],
  [1.00, 1.10, "1.00-1.09"], [1.10, 1.25, "1.10-1.24"], [1.25, 1.50, "1.25-1.49"],
  [1.50, 1.75, "1.50-1.74"], [1.75, 2.00, "1.75-1.99"], [2.00, 2.50, "2.00-2.49"],
  [2.50, 3.00, "2.50-2.99"], [3.00, 4.00, "3.00-3.99"], [4.00, 5.00, "4.00-4.99"],
  [5.00, 6.00, "5.00-5.99"], [6.00, 10.00, "6.00-9.99"], [10.00, Infinity, "10.00+"],
];

function getWeightRange(ct) {
  for (const [lo, hi, label] of BUCKETS) {
    if (ct >= lo && ct < hi) return label;
  }
  return null;
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "search") {
    const query = formData.get("query");
    const response = await admin.graphql(`
      query searchProducts($query: String!) {
        products(first: 10, query: $query) {
          edges { node { id title } }
        }
      }
    `, { variables: { query } });
    const data = await response.json();
    const products = data.data.products.edges.map(e => e.node);
    return json({ intent: "search", products });
  }

  if (intent === "load") {
    const product_id = formData.get("product_id");
    const { data: specs } = await supabase
      .from("product_specs_solitaires")
      .select("*")
      .eq("product_id", product_id)
      .order("solitaire_ref");
    return json({ intent: "load", specs: specs || [] });
  }

  if (intent === "save") {
    const product_id = formData.get("product_id");
    const product_title = formData.get("product_title");
    const rows = JSON.parse(formData.get("rows"));

    if (!product_id || rows.length === 0) {
      return json({ intent: "save", success: false, error: "Please select a product and add at least one row." });
    }

    // Auto-derive weight_range from actual_weight_ct
    const badRows = rows.filter(r => {
      const ct = parseFloat(r.actual_weight_ct);
      return isNaN(ct) || getWeightRange(ct) === null;
    });
    if (badRows.length > 0) {
      const bad = badRows.map(r => `${r.solitaire_ref} (${r.actual_weight_ct}ct)`).join(", ");
      return json({ intent: "save", success: false, error: `Actual weight must be ≥ 0.18ct: ${bad}` });
    }

    await supabase.from("product_specs_solitaires").delete().eq("product_id", product_id);

    const inserts = rows.map(row => ({
      product_id,
      solitaire_ref: row.solitaire_ref,
      shape: row.shape,
      size_mm_length: parseFloat(row.size_mm_length),
      size_mm_width: row.size_mm_width ? parseFloat(row.size_mm_width) : null,
      actual_weight_ct: parseFloat(row.actual_weight_ct),
      weight_range: getWeightRange(parseFloat(row.actual_weight_ct)),
    }));

    const { error } = await supabase.from("product_specs_solitaires").insert(inserts);
    if (error) return json({ intent: "save", success: false, error: error.message });
    enqueueRecalc(product_id);
    return json({ intent: "save", success: true, product_title });
  }

  return json({});
};

const SHAPES = ["Round", "Oval", "Pear", "Marquise", "Princess", "Emerald", "Cushion", "Radiant", "Heart", "Asscher"];

const selectStyle = { padding: "8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px" };
const inputStyle = { padding: "8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px", width: "100px" };

export default function SpecsSolitaires() {
  const actionData = useActionData();
  const loadFetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [rows, setRows] = useState([]);

  const products = actionData?.intent === "search" ? actionData.products : [];

  useEffect(() => {
    if (loadFetcher.data?.intent === "load") {
      if (loadFetcher.data.specs?.length > 0) {
        setRows(loadFetcher.data.specs.map(s => ({
          solitaire_ref: s.solitaire_ref || "",
          shape: s.shape,
          size_mm_length: String(s.size_mm_length),
          size_mm_width: s.size_mm_width ? String(s.size_mm_width) : "",
          actual_weight_ct: String(s.actual_weight_ct),
        })));
      } else {
        setRows([]);
      }
    }
  }, [loadFetcher.data]);

  const selectProduct = (product) => {
    setSelectedProduct(product);
    setRows([]);
    loadFetcher.submit(
      { intent: "load", product_id: product.id },
      { method: "post" }
    );
  };

  const addRow = () => {
    const ref = `SOL-${String(rows.length + 1).padStart(3, "0")}`;
    setRows([...rows, {
      solitaire_ref: ref,
      shape: "Round",
      size_mm_length: "",
      size_mm_width: "",
      actual_weight_ct: "",
    }]);
  };

  const updateRow = (index, field, value) => {
    const updated = [...rows];
    updated[index][field] = value;
    if (field === "shape" && value === "Round") {
      updated[index].size_mm_width = "";
    }
    setRows(updated);
  };

  const removeRow = (index) => setRows(rows.filter((_, i) => i !== index));

  const isRound = (shape) => shape === "Round";

  return (
    <s-page heading="Product Specs — Solitaires">

      <s-section heading="Find Product">
        <Form method="post">
          <input type="hidden" name="intent" value="search" />
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Search by product name"
              name="query"
              value={query}
              onInput={(e) => setQuery(e.target.value)}
              placeholder="e.g. Solitaire Ring"
            />
            <s-button type="submit">Search</s-button>
          </s-stack>
        </Form>

        {products.length > 0 && (
          <s-stack direction="block" gap="tight">
            <s-text emphasis="strong">Select a product:</s-text>
            {products.map(p => (
              <div
                key={p.id}
                onClick={() => selectProduct(p)}
                style={{
                  padding: "10px 14px",
                  border: "1px solid #ccc",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: selectedProduct?.id === p.id ? "#e8f4e8" : "#fff",
                }}
              >
                {p.title}
              </div>
            ))}
          </s-stack>
        )}

        {selectedProduct && (
          <div style={{ marginTop: "12px", padding: "10px", background: "#e8f4e8", borderRadius: "6px" }}>
            ✅ Selected: <strong>{selectedProduct.title}</strong>
          </div>
        )}
      </s-section>

      {selectedProduct && (
        <s-section heading="Solitaire Specs">
          <s-stack direction="block" gap="base">

            {loadFetcher.state === "submitting" && (
              <div style={{ color: "#888", fontStyle: "italic" }}>Loading existing specs...</div>
            )}

            {rows.map((row, index) => (
              <div
                key={index}
                style={{
                  padding: "14px",
                  border: "1px solid #e0e0e0",
                  borderRadius: "8px",
                  background: "#fafafa",
                }}
              >
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Solitaire Ref</div>
                    <input
                      style={{ ...inputStyle, width: "90px" }}
                      value={row.solitaire_ref}
                      onChange={(e) => updateRow(index, "solitaire_ref", e.target.value)}
                      placeholder="SOL-001"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Shape</div>
                    <select
                      style={selectStyle}
                      value={row.shape}
                      onChange={(e) => updateRow(index, "shape", e.target.value)}
                    >
                      {SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>
                      {isRound(row.shape) ? "Size (mm)" : "Length (mm)"}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      style={inputStyle}
                      value={row.size_mm_length}
                      onChange={(e) => updateRow(index, "size_mm_length", e.target.value)}
                      placeholder="e.g. 5.2"
                    />
                  </div>

                  {!isRound(row.shape) && (
                    <div>
                      <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Width (mm)</div>
                      <input
                        type="number"
                        step="0.01"
                        style={inputStyle}
                        value={row.size_mm_width}
                        onChange={(e) => updateRow(index, "size_mm_width", e.target.value)}
                        placeholder="e.g. 3.5"
                      />
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Actual Weight (ct)</div>
                    <input
                      type="number"
                      step="0.01"
                      style={inputStyle}
                      value={row.actual_weight_ct}
                      onChange={(e) => updateRow(index, "actual_weight_ct", e.target.value)}
                      placeholder="e.g. 0.52"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Rate Bucket (auto)</div>
                    <div style={{
                      ...inputStyle,
                      background: "#f0f0f0",
                      color: "#555",
                      display: "flex",
                      alignItems: "center",
                      width: "90px",
                    }}>
                      {getWeightRange(parseFloat(row.actual_weight_ct)) || "—"}
                    </div>
                  </div>

                  <button
                    onClick={() => removeRow(index)}
                    style={{
                      padding: "8px 14px",
                      background: "#fff0f0",
                      color: "#cc0000",
                      border: "1px solid #ffcccc",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>

                </div>
              </div>
            ))}

            <button
              onClick={addRow}
              style={{
                padding: "8px 16px",
                background: "#f0f0f0",
                border: "1px solid #ccc",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              + Add Solitaire
            </button>

            {actionData?.intent === "save" && actionData.success && (
              <div style={{ padding: "10px", background: "#e8f4e8", borderRadius: "6px", color: "#2d6a2d" }}>
                ✅ Solitaire specs saved for {actionData.product_title}!
              </div>
            )}
            {actionData?.intent === "save" && actionData.error && (
              <div style={{ padding: "10px", background: "#fff0f0", borderRadius: "6px", color: "#cc0000" }}>
                ❌ {actionData.error}
              </div>
            )}

            <Form method="post">
              <input type="hidden" name="intent" value="save" />
              <input type="hidden" name="product_id" value={selectedProduct.id} />
              <input type="hidden" name="product_title" value={selectedProduct.title} />
              <input type="hidden" name="rows" value={JSON.stringify(rows)} />
              <s-button variant="primary" type="submit">Save Solitaire Specs</s-button>
            </Form>

          </s-stack>
        </s-section>
      )}

    </s-page>
  );
}