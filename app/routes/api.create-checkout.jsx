import prisma from "../db.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "mycarat-dev.myshopify.com";
const API_VERSION = "2025-10";

// Handles OPTIONS preflight request
export const loader = async ({ request }) => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { variant_id, calculated_price, properties } = body;

  if (!variant_id || calculated_price == null) {
    return Response.json(
      { success: false, error: "variant_id and calculated_price are required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = await prisma.session.findFirst({
    where: { shop: SHOPIFY_SHOP, isOnline: false },
  });
  const ACCESS_TOKEN = session?.accessToken;

  if (!ACCESS_TOKEN) {
    return Response.json(
      { success: false, error: "No session found for shop. Please reinstall the app." },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  const customAttributes = Object.entries(properties || {})
    .filter(([, v]) => v)
    .map(([k, v]) => ({ key: k, value: String(v) }));

  const variantGid = `gid://shopify/ProductVariant/${variant_id}`;
  const priceString = parseFloat(calculated_price).toFixed(2);

  const gqlResponse = await fetch(
    `https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query: `
          mutation draftOrderCreate($input: DraftOrderInput!) {
            draftOrderCreate(input: $input) {
              draftOrder {
                id
                invoiceUrl
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          input: {
            lineItems: [
              {
                variantId: variantGid,
                quantity: 1,
                priceOverride: { amount: priceString, currencyCode: "INR" },
                taxable: false,
                customAttributes,
              },
            ],
            tags: ["mycarat-configured"],
            taxExempt: true,
          },
        },
      }),
    }
  );

  const result = await gqlResponse.json();

  if (result.errors?.length) {
    return Response.json(
      { success: false, error: result.errors.map((e) => e.message).join("; ") },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const { draftOrder, userErrors } = result.data?.draftOrderCreate ?? {};

  if (userErrors?.length) {
    return Response.json(
      { success: false, error: userErrors.map((e) => e.message).join("; ") },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  if (!draftOrder) {
    return Response.json(
      { success: false, error: "Draft order creation returned no data: " + JSON.stringify(result) },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  return Response.json(
    { success: true, invoiceUrl: draftOrder.invoiceUrl },
    { headers: CORS_HEADERS }
  );
};
