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
          edges {
            node {
              id
              title
            }
          }
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
      .from("product_specs_metal")
      .select("*")
      .eq("product_id", product_id);
    return json({ intent: "load", specs: specs || [] });
  }

  if (intent === "save") {
    const product_id = formData.get("product_id");
    const product_title = formData.get("product_title");
    const rows = JSON.parse(formData.get("rows"));

    if (!product_id || rows.length === 0) {
      return json({ intent: "save", success: false, error: "Please select a product and add at least one row." });
    }

    await supabase.from("product_specs_metal").delete().eq("product_id", product_id);

    const inserts = rows.map(row => ({
      product_id,
      metal_type: row.metal_type,
      purity: row.purity,
      weight_grams: parseFloat(row.weight_grams),
    }));

    const { error } = await supabase.from("product_specs_metal").insert(inserts);
    if (error) return json({ intent: "save", success: false, error: error.message });
    enqueueRecalc(product_id);
    return json({ intent: "save", success: true, product_title });
  }

  return json({});
};

const GOLD_PURITIES = ["24KT", "22KT", "18KT", "14KT", "10KT", "9KT"];
const SILVER_PURITIES = ["999", "925", "650"];

const selectStyle = {
  padding: "8px",
  borderRadius: "4px",
  border: "1px solid #ccc",
  width: "160px",
  fontSize: "14px",
};

export default function SpecsMetal() {
  const actionData = useActionData();
  const loadFetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [rows, setRows] = useState([]);

  const products = actionData?.intent === "search" ? actionData.products : [];

  // When load fetcher returns data, populate rows
  useEffect(() => {
    if (loadFetcher.data?.intent === "load") {
      if (loadFetcher.data.specs?.length > 0) {
        setRows(loadFetcher.data.specs.map(s => ({
          metal_type: s.metal_type,
          purity: s.purity,
          weight_grams: String(s.weight_grams),
        })));
      } else {
        setRows([]);
      }
    }
  }, [loadFetcher.data]);

  const selectProduct = (product) => {
    setSelectedProduct(product);
    setRows([]);
    // Use fetcher to load specs without page reset
    loadFetcher.submit(
      { intent: "load", product_id: product.id },
      { method: "post" }
    );
  };

  const addRow = () => {
    setRows([...rows, { metal_type: "gold", purity: "18KT", weight_grams: "" }]);
  };

  const updateRow = (index, field, value) => {
    const updated = [...rows];
    updated[index][field] = value;
    if (field === "metal_type") {
      updated[index].purity = value === "gold" ? "18KT" : "925";
    }
    setRows(updated);
  };

  const removeRow = (index) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  return (
    <s-page heading="Product Specs — Metal">

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
        <s-section heading="Metal Specs">
          <s-stack direction="block" gap="base">

            {loadFetcher.state === "submitting" && (
              <div style={{ color: "#888", fontStyle: "italic" }}>Loading existing specs...</div>
            )}

            {rows.map((row, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  gap: "16px",
                  alignItems: "flex-end",
                  padding: "12px",
                  border: "1px solid #e0e0e0",
                  borderRadius: "8px",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", marginBottom: "4px", color: "#555" }}>Metal Type</div>
                  <select
                    style={selectStyle}
                    value={row.metal_type}
                    onChange={(e) => updateRow(index, "metal_type", e.target.value)}
                  >
                    <option value="gold">Gold</option>
                    <option value="silver">Silver</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: "13px", marginBottom: "4px", color: "#555" }}>Purity</div>
                  <select
                    style={selectStyle}
                    value={row.purity}
                    onChange={(e) => updateRow(index, "purity", e.target.value)}
                  >
                    {(row.metal_type === "gold" ? GOLD_PURITIES : SILVER_PURITIES).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: "13px", marginBottom: "4px", color: "#555" }}>Weight (grams)</div>
                  <input
                    type="number"
                    step="0.01"
                    style={{ ...selectStyle, width: "130px" }}
                    value={row.weight_grams}
                    onChange={(e) => updateRow(index, "weight_grams", e.target.value)}
                    placeholder="e.g. 4.25"
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
              + Add Row
            </button>

            {actionData?.intent === "save" && actionData.success && (
              <div style={{ padding: "10px", background: "#e8f4e8", borderRadius: "6px", color: "#2d6a2d" }}>
                ✅ Specs saved for {actionData.product_title}!
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
              <s-button variant="primary" type="submit">Save Specs</s-button>
            </Form>

          </s-stack>
        </s-section>
      )}

    </s-page>
  );
}