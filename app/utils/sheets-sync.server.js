import crypto from "crypto";

const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY  = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const SHEET_RANGE = "Leads!A:H";

let cachedToken = null;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }
  if (!CLIENT_EMAIL || !PRIVATE_KEY || !SHEET_ID) {
    throw new Error("Google Sheets sync not configured (missing env vars).");
  }

  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims  = base64url(JSON.stringify({
    iss:   CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), PRIVATE_KEY);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${JSON.stringify(data)}`);

  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

export async function appendLeadRow(row) {
  const accessToken = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Sheets append failed (${res.status}): ${errBody}`);
  }
}
