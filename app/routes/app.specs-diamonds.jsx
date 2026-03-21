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
      .from("product_specs_diamonds")
      .select("*")
      .eq("product_id", product_id)
      .order("diamond_group_ref");
    return json({ intent: "load", specs: specs || [] });
  }

  if (intent === "save") {
    const product_id = formData.get("product_id");
    const product_title = formData.get("product_title");
    const rows = JSON.parse(formData.get("rows"));

    if (!product_id || rows.length === 0) {
      return json({ intent: "save", success: false, error: "Please select a product and add at least one row." });
    }

    await supabase.from("product_specs_diamonds").delete().eq("product_id", product_id);

    const inserts = rows.map(row => ({
      product_id,
      diamond_group_ref: row.diamond_group_ref,
      shape: row.shape,
      size_mm_length: parseFloat(row.size_mm_length),
      size_mm_width: row.size_mm_width ? parseFloat(row.size_mm_width) : null,
      size_bucket: row.size_bucket,
      diamond_count: parseInt(row.diamond_count),
      weight_per_piece_ct: parseFloat(row.weight_per_piece_ct),
      total_weight_ct: parseFloat(row.diamond_count) * parseFloat(row.weight_per_piece_ct),
    }));

    const { error } = await supabase.from("product_specs_diamonds").insert(inserts);
    if (error) return json({ intent: "save", success: false, error: error.message });
    enqueueRecalc(product_id);
    return json({ intent: "save", success: true, product_title });
  }

  return json({});
};

const SHAPES = ["Round", "Baguette", "Marquise", "Oval", "Pear", "Princess", "Emerald", "Cushion", "Radiant"];
const ROUND_BUCKETS = ["S1 (≤1.2mm)", "S2 (1.3-2.0mm)", "S3 (2.1-2.6mm)", "S4 (2.7-2.9mm)", "S5 (3.0-3.2mm)"];
const FANCY_BUCKETS = ["S1 (<0.01ct)", "S2 (0.01-0.10ct)", "S3 (0.10-0.20ct)"];

const selectStyle = {
  padding: "8px",
  borderRadius: "4px",
  border: "1px solid #ccc",
  fontSize: "14px",
};

const inputStyle = {
  padding: "8px",
  borderRadius: "4px",
  border: "1px solid #ccc",
  fontSize: "14px",
  width: "100px",
};

export default function SpecsDiamonds() {
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
          diamond_group_ref: s.diamond_group_ref || "",
          shape: s.shape,
          size_mm_length: String(s.size_mm_length),
          size_mm_width: s.size_mm_width ? String(s.size_mm_width) : "",
          size_bucket: s.size_bucket,
          diamond_count: String(s.diamond_count),
          weight_per_piece_ct: String(s.weight_per_piece_ct),
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
    const ref = `DIA-${String(rows.length + 1).padStart(3, "0")}`;
    setRows([...rows, {
      diamond_group_ref: ref,
      shape: "Round",
      size_mm_length: "",
      size_mm_width: "",
      size_bucket: "S1 (≤1.2mm)",
      diamond_count: "",
      weight_per_piece_ct: "",
    }]);
  };

  const updateRow = (index, field, value) => {
    const updated = [...rows];
    updated[index][field] = value;
    if (field === "shape") {
      updated[index].size_bucket = value === "Round" ? "S1 (≤1.2mm)" : "S1 (<0.01ct)";
      updated[index].size_mm_width = "";
    }
    setRows(updated);
  };

  const removeRow = (index) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const isRound = (shape) => shape === "Round";

  return (
    <s-page heading="Product Specs — Diamonds">

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
        <s-section heading="Diamond Groups">
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
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Group Ref</div>
                    <input
                      style={{ ...inputStyle, width: "90px" }}
                      value={row.diamond_group_ref}
                      onChange={(e) => updateRow(index, "diamond_group_ref", e.target.value)}
                      placeholder="DIA-001"
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
                      placeholder="e.g. 1.5"
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
                        placeholder="e.g. 1.0"
                      />
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Size Bucket</div>
                    <select
                      style={selectStyle}
                      value={row.size_bucket}
                      onChange={(e) => updateRow(index, "size_bucket", e.target.value)}
                    >
                      {(isRound(row.shape) ? ROUND_BUCKETS : FANCY_BUCKETS).map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Count</div>
                    <input
                      type="number"
                      style={inputStyle}
                      value={row.diamond_count}
                      onChange={(e) => updateRow(index, "diamond_count", e.target.value)}
                      placeholder="e.g. 24"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Wt/piece (ct)</div>
                    <input
                      type="number"
                      step="0.0001"
                      style={inputStyle}
                      value={row.weight_per_piece_ct}
                      onChange={(e) => updateRow(index, "weight_per_piece_ct", e.target.value)}
                      placeholder="e.g. 0.0050"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Total (ct)</div>
                    <div style={{
                      padding: "8px",
                      background: "#f0f0f0",
                      borderRadius: "4px",
                      minWidth: "80px",
                      fontSize: "14px",
                    }}>
                      {row.diamond_count && row.weight_per_piece_ct
                        ? (parseFloat(row.diamond_count) * parseFloat(row.weight_per_piece_ct)).toFixed(4)
                        : "—"}
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
              + Add Diamond Group
            </button>

            {actionData?.intent === "save" && actionData.success && (
              <div style={{ padding: "10px", background: "#e8f4e8", borderRadius: "6px", color: "#2d6a2d" }}>
                ✅ Diamond specs saved for {actionData.product_title}!
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
              <s-button variant="primary" type="submit">Save Diamond Specs</s-button>
            </Form>

          </s-stack>
        </s-section>
      )}

    </s-page>
  );
}