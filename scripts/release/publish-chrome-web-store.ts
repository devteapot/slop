import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const zipPath = process.argv[2] ?? process.env.EXTENSION_ZIP_PATH;
const publisherId = process.env.CHROME_PUBLISHER_ID;
const extensionId = process.env.CHROME_EXTENSION_ID;
const serviceAccountJson = process.env.CHROME_SERVICE_ACCOUNT_JSON;

if (!zipPath) {
  throw new Error("Expected an extension zip path as the first argument or EXTENSION_ZIP_PATH.");
}

if (!publisherId || !extensionId || !serviceAccountJson) {
  throw new Error(
    "CHROME_PUBLISHER_ID, CHROME_EXTENSION_ID, and CHROME_SERVICE_ACCOUNT_JSON are required.",
  );
}

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

const credentials = JSON.parse(serviceAccountJson) as ServiceAccountCredentials;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createJwt(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/chromewebstore",
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt,
      exp: expiresAt,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();

  const signature = signer.sign(credentials.private_key);
  return `${header}.${payload}.${base64Url(signature)}`;
}

async function getAccessToken(): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJwt(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Google access token: ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("Google token response did not include an access token.");
  }

  return body.access_token;
}

async function expectOk(response: Response, context: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context} failed: ${text}`);
  }

  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const accessToken = await getAccessToken();
const itemName = `publishers/${publisherId}/items/${extensionId}`;
const zipBuffer = readFileSync(zipPath);

const uploadResponse = await fetch(
  `https://chromewebstore.googleapis.com/upload/v2/${itemName}:upload`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: zipBuffer,
  },
);

const uploadBody = await expectOk(uploadResponse, "Chrome Web Store upload");
console.log("Uploaded extension package:", JSON.stringify(uploadBody));

const publishResponse = await fetch(`https://chromewebstore.googleapis.com/v2/${itemName}:publish`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    publishType: "DEFAULT_PUBLISH",
  }),
});

const publishBody = await expectOk(publishResponse, "Chrome Web Store publish");
console.log("Published extension submission:", JSON.stringify(publishBody));
