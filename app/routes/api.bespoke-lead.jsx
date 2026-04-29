import { supabase } from "../supabase.server";
import { Resend } from "resend";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const action = async ({ request }) => {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });

  let imageStoragePath = null;

  try {
    const contentType = request.headers.get("content-type") || "";
    let fields = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        if (key === "reference_image" && value instanceof File && value.size > 0) {
          // Upload image to Supabase Storage
          const ext = value.name.split(".").pop() || "jpg";
          const fileName = `${Date.now()}.${ext}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("bespoke-uploads")
            .upload(fileName, value, { contentType: value.type, upsert: false });
          if (!uploadError && uploadData) {
            imageStoragePath = uploadData.path;
          }
        } else {
          fields[key] = value;
        }
      }
    } else {
      fields = await request.json();
    }

    const {
      path,
      product_title,
      product_url,
      reference_input,
      reference_url,
      bespoke_notes,
      contact_name,
      contact_phone,
      contact_email,
      preferred_day,
      preferred_time,
      customer_id,
      source_page,
    } = fields;

    // Basic validation
    if (!path || !contact_name || !contact_phone || !contact_email) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Build description from all bespoke request details
    const descParts = [];
    const pathLabel = { this_product: "This product", another_product: "Another product", something_else: "Something else" }[path] || path;
    descParts.push(`Request type: ${pathLabel}`);
    if (product_title) descParts.push(`Product: ${product_title}`);
    if (product_url)   descParts.push(`Product URL: ${product_url}`);
    if (reference_input) descParts.push(`Reference: ${reference_input}`);
    if (reference_url)   descParts.push(`Reference URL: ${reference_url}`);
    if (imageStoragePath) descParts.push(`Reference image: ${imageStoragePath}`);
    if (bespoke_notes)   descParts.push(`Notes: ${bespoke_notes}`);
    if (preferred_day)   descParts.push(`Preferred day: ${preferred_day}`);
    if (preferred_time)  descParts.push(`Preferred time: ${preferred_time}`);
    if (source_page)     descParts.push(`Source page: ${source_page}`);
    if (customer_id)     descParts.push(`Customer ID: ${customer_id}`);

    // Insert into Supabase
    const { data: lead, error: dbError } = await supabase
      .from("bespoke_orders")
      .insert({
        customer_name:  contact_name,
        customer_email: contact_email,
        customer_phone: contact_phone || null,
        status:         "received",
        description:    descParts.join("\n"),
      })
      .select("id")
      .single();

    if (dbError) throw dbError;

    // Send notification email
    await sendNotificationEmail({ lead, fields, imageStoragePath });

    return new Response(
      JSON.stringify({ success: true, id: lead.id }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[bespoke-lead] error:", msg, err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
};

async function sendNotificationEmail({ fields, imageStoragePath }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return; // skip silently if not configured

  const resend = new Resend(resendKey);

  const pathLabel = {
    this_product:    "This product",
    another_product: "Another mycarat product",
    something_else:  "Something else",
  }[fields.path] || fields.path;

  // Build reference section
  let referenceHtml = "";
  if (fields.path === "this_product" && fields.product_title) {
    referenceHtml = `
      <tr><td><strong>Product</strong></td><td>${fields.product_title}</td></tr>
      ${fields.product_url ? `<tr><td><strong>URL</strong></td><td><a href="${fields.product_url}">${fields.product_url}</a></td></tr>` : ""}
    `;
  } else if (fields.path === "another_product" && fields.reference_input) {
    referenceHtml = `<tr><td><strong>Reference</strong></td><td>${fields.reference_input}</td></tr>`;
  } else if (fields.path === "something_else") {
    if (fields.reference_url) {
      referenceHtml = `<tr><td><strong>Reference URL</strong></td><td><a href="${fields.reference_url}">${fields.reference_url}</a></td></tr>`;
    }
    if (imageStoragePath) {
      referenceHtml += `<tr><td><strong>Image</strong></td><td>Uploaded — view in Supabase Storage: bespoke-uploads/${imageStoragePath}</td></tr>`;
    }
  }

  const html = `
    <h2 style="color:#1d9e75">New Bespoke Request</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;width:100%">
      <tr><td style="padding:6px 12px 6px 0;color:#888;width:160px"><strong>Path</strong></td><td style="padding:6px 0">${pathLabel}</td></tr>
      ${referenceHtml}
      <tr><td style="padding:6px 12px 6px 0;color:#888"><strong>Notes</strong></td><td style="padding:6px 0">${fields.bespoke_notes || "—"}</td></tr>
      <tr><td colspan="2" style="padding:12px 0 4px;border-top:1px solid #eee"><strong>Contact</strong></td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#888"><strong>Name</strong></td><td style="padding:6px 0">${fields.contact_name}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#888"><strong>Phone</strong></td><td style="padding:6px 0">${fields.contact_phone}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#888"><strong>Email</strong></td><td style="padding:6px 0">${fields.contact_email}</td></tr>
      <tr><td colspan="2" style="padding:12px 0 4px;border-top:1px solid #eee"><strong>Preferred time</strong></td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#888"><strong>Day</strong></td><td style="padding:6px 0">${fields.preferred_day || "—"}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#888"><strong>Time</strong></td><td style="padding:6px 0">${fields.preferred_time || "—"}</td></tr>
      ${fields.source_page ? `<tr><td style="padding:6px 12px 6px 0;color:#888"><strong>Source page</strong></td><td style="padding:6px 0"><a href="${fields.source_page}">${fields.source_page}</a></td></tr>` : ""}
    </table>
  `;

  await resend.emails.send({
    from:    "MyCarat Bespoke <noreply@mycarat.in>",
    to:      "mycarat.in@gmail.com",
    subject: `New bespoke request — ${fields.contact_name} (${pathLabel})`,
    html,
  });
}
