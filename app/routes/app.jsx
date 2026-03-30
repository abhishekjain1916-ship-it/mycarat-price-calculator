import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/metal-rates">Metal Rates</s-link>
        <s-link href="/app/making-charge-rates">Making Charges</s-link>
        <s-link href="/app/rates-diamonds">Rates — Diamonds</s-link>
        <s-link href="/app/rates-solitaires">Rates — Solitaires</s-link>
        <s-link href="/app/specs-metal">Specs — Metal</s-link>
        <s-link href="/app/specs-diamonds">Specs — Diamonds</s-link>
        <s-link href="/app/specs-solitaires">Specs — Solitaires</s-link>
        <s-link href="/app/specs-gemstones">Specs — Gemstones</s-link>
        <s-link href="/app/goldback-rates">Goldback Rates</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
