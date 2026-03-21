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
      .from("product_specs_gemstones")
      .select("*")
      .eq("product_id", product_id)
      .order("gemstone_group_ref");
    return json({ intent: "load", specs: specs || [] });
  }

  if (intent === "save") {
    const product_id = formData.get("product_id");
    const product_title = formData.get("product_title");
    const rows = JSON.parse(formData.get("rows"));

    if (!product_id || rows.length === 0) {
      return json({ intent: "save", success: false, error: "Please select a product and add at least one row." });
    }

    await supabase.from("product_specs_gemstones").delete().eq("product_id", product_id);

    const inserts = rows.map(row => ({
      product_id,
      gemstone_group_ref: row.gemstone_group_ref,
      gemstone_name: row.gemstone_name,
      shape: row.shape,
      size_mm_length: parseFloat(row.size_mm_length),
      size_mm_width: row.size_mm_width ? parseFloat(row.size_mm_width) : null,
      size_bucket: row.size_bucket,
      gemstone_count: parseInt(row.gemstone_count),
      actual_weight_ct: parseFloat(row.actual_weight_ct),
    }));

    const { error } = await supabase.from("product_specs_gemstones").insert(inserts);
    if (error) return json({ intent: "save", success: false, error: error.message });
    enqueueRecalc(product_id);
    return json({ intent: "save", success: true, product_title });
  }

  return json({});
};

const GEMSTONE_NAMES = ["Emerald", "Ruby", "Sapphire", "Amethyst", "Topaz", "Opal", "Garnet", "Turquoise", "Aquamarine", "Tanzanite", "Spinel", "Citrine", "Peridot", "Morganite", "Other"];
const SHAPES = ["Round", "Oval", "Pear", "Marquise", "Princess", "Emerald Cut", "Cushion", "Cabochon", "Heart", "Trillion"];
const SIZE_BUCKETS = ["S1 (<3mm)", "S2 (3-5mm)", "S3 (5-7mm)", "S4 (7-9mm)", "S5 (>9mm)"];

const selectStyle = { padding: "8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px" };
const inputStyle = { padding: "8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px", width: "100px" };

export default function SpecsGemstones() {
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
          gemstone_group_ref: s.gemstone_group_ref || "",
          gemstone_name: s.gemstone_name,
          shape: s.shape,
          size_mm_length: String(s.size_mm_length),
          size_mm_width: s.size_mm_width ? String(s.size_mm_width) : "",
          size_bucket: s.size_bucket,
          gemstone_count: String(s.gemstone_count),
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
    const ref = `GEM-${String(rows.length + 1).padStart(3, "0")}`;
    setRows([...rows, {
      gemstone_group_ref: ref,
      gemstone_name: "Emerald",
      shape: "Round",
      size_mm_length: "",
      size_mm_width: "",
      size_bucket: "S2 (3-5mm)",
      gemstone_count: "",
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
    <s-page heading="Product Specs — Gemstones">

      <s-section heading="Find Product">
        <Form method="post">
          <input type="hidden" name="intent" value="search" />
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Search by product name"
              name="query"
              value={query}
              onInput={(e) => setQuery(e.target.value)}
              placeholder="e.g. Emerald Ring"
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
        <s-section heading="Gemstone Groups">
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
                      value={row.gemstone_group_ref}
                      onChange={(e) => updateRow(index, "gemstone_group_ref", e.target.value)}
                      placeholder="GEM-001"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Gemstone</div>
                    <select
                      style={selectStyle}
                      value={row.gemstone_name}
                      onChange={(e) => updateRow(index, "gemstone_name", e.target.value)}
                    >
                      {GEMSTONE_NAMES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
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
                      placeholder="e.g. 4.0"
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
                        placeholder="e.g. 3.0"
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
                      {SIZE_BUCKETS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Count</div>
                    <input
                      type="number"
                      style={inputStyle}
                      value={row.gemstone_count}
                      onChange={(e) => updateRow(index, "gemstone_count", e.target.value)}
                      placeholder="e.g. 3"
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>Total Weight (ct)</div>
                    <input
                      type="number"
                      step="0.01"
                      style={inputStyle}
                      value={row.actual_weight_ct}
                      onChange={(e) => updateRow(index, "actual_weight_ct", e.target.value)}
                      placeholder="e.g. 1.25"
                    />
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
              + Add Gemstone Group
            </button>

            {actionData?.intent === "save" && actionData.success && (
              <div style={{ padding: "10px", background: "#e8f4e8", borderRadius: "6px", color: "#2d6a2d" }}>
                ✅ Gemstone specs saved for {actionData.product_title}!
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
              <s-button variant="primary" type="submit">Save Gemstone Specs</s-button>
            </Form>

          </s-stack>
        </s-section>
      )}

    </s-page>
  );
}