import { data as json } from "react-router";
import { useLoaderData, useActionData, Form } from "react-router";
import { supabase } from "../supabase.server";
import { enqueueRecalc } from "../utils/recalc-queue.server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { admin } = await authenticate.admin(request);

  // Collect all product IDs from all specs tables
  const [m, d, s, g] = await Promise.all([
    supabase.from("product_specs_metal").select("product_id"),
    supabase.from("product_specs_diamonds").select("product_id"),
    supabase.from("product_specs_solitaires").select("product_id"),
    supabase.from("product_specs_gemstones").select("product_id"),
  ]);

  const metalIds = new Set((m.data || []).map((r) => r.product_id));
  const diamondIds = new Set((d.data || []).map((r) => r.product_id));
  const solitaireIds = new Set((s.data || []).map((r) => r.product_id));
  const gemstoneIds = new Set((g.data || []).map((r) => r.product_id));
  const allIds = [...new Set([...metalIds, ...diamondIds, ...solitaireIds, ...gemstoneIds])];

  if (allIds.length === 0) return json({ products: [] });

  // Fetch titles from Shopify
  const gqlRes = await admin.graphql(
    `query getProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id title }
      }
    }`,
    { variables: { ids: allIds } }
  );
  const { data: gqlData } = await gqlRes.json();
  const titleMap = {};
  for (const node of (gqlData?.nodes || [])) {
    if (node?.id) titleMap[node.id] = node.title;
  }

  // Fetch price cache + delta counts
  const [cacheRes, deltaRes] = await Promise.all([
    supabase
      .from("product_price_cache")
      .select("product_id, lab_default_price, natural_default_price, last_calculated_at")
      .in("product_id", allIds),
    supabase
      .from("product_delta_cache")
      .select("product_id")
      .in("product_id", allIds),
  ]);
  const cacheMap = Object.fromEntries((cacheRes.data || []).map((r) => [r.product_id, r]));
  const deltaCountMap = {};
  for (const row of (deltaRes.data || [])) {
    deltaCountMap[row.product_id] = (deltaCountMap[row.product_id] || 0) + 1;
  }

  const products = allIds
    .map((id) => ({
      id,
      title: titleMap[id] || `Product ${id.split("/").pop()}`,
      hasMetal: metalIds.has(id),
      hasDiamonds: diamondIds.has(id),
      hasSolitaires: solitaireIds.has(id),
      hasGemstones: gemstoneIds.has(id),
      cache: cacheMap[id] || null,
      deltaCount: deltaCountMap[id] || 0,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return json({ products });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  await authenticate.admin(request);

  const formData = await request.formData();
  const product_id = formData.get("product_id");
  await enqueueRecalc(product_id, 1); // priority=1 — jump to front of queue
  return json({ success: true, queued: product_id });
};

const thStyle = { padding: "10px 12px", textAlign: "left", background: "#f5f5f5", borderBottom: "2px solid #ddd", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" };
const tdStyle = { padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: "13px", verticalAlign: "middle" };
const tick = (v) => v ? <span style={{ color: "#008060", fontWeight: "600" }}>✓</span> : <span style={{ color: "#ccc" }}>—</span>;

const fmt = (n) => n != null ? "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—";

const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export default function Products() {
  const { products } = useLoaderData();
  const actionData = useActionData();

  return (
    <s-page heading="Products">

      {actionData?.success && (
        <s-banner tone="success">Recalculation queued. Prices will update in the background.</s-banner>
      )}

      <s-section heading={`${products.length} product${products.length !== 1 ? "s" : ""} configured`}>
        {products.length === 0 ? (
          <s-text tone="subdued">No products configured yet. Add specs using the Specs pages.</s-text>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Product</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Metal</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Diamonds</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Solitaires</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Gemstones</th>
                  <th style={thStyle}>Lab Default</th>
                  <th style={thStyle}>Natural Default</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Deltas</th>
                  <th style={thStyle}>Last Recalc</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: "500" }}>{p.title}</div>
                      <div style={{ fontSize: "11px", color: "#999", marginTop: "2px" }}>ID: {p.id.split("/").pop()}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{tick(p.hasMetal)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{tick(p.hasDiamonds)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{tick(p.hasSolitaires)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{tick(p.hasGemstones)}</td>
                    <td style={tdStyle}>{fmt(p.cache?.lab_default_price)}</td>
                    <td style={tdStyle}>{fmt(p.cache?.natural_default_price)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {p.cache && p.deltaCount === 0
                        ? <span style={{ color: "#c00", fontWeight: "700" }} title="Price cache exists but no delta rows — widget Customise will be broken">⚠️ 0</span>
                        : <span style={{ color: "#666", fontSize: "12px" }}>{p.deltaCount || "—"}</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, color: "#666" }}>{fmtDate(p.cache?.last_calculated_at)}</td>
                    <td style={tdStyle}>
                      <Form method="post">
                        <input type="hidden" name="product_id" value={p.id} />
                        <button
                          type="submit"
                          style={{ padding: "5px 12px", background: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}
                        >
                          Recalc
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

    </s-page>
  );
}
