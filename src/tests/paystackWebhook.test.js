import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";

import app from "../app.js";

// These are fabricated test-only secrets.
// No actual Paystack credentials are used.
const TEST_WEBHOOK_SECRET = "whsec_local_testing_only";
const TEST_API_SECRET = "sk_test_local_testing_only";

const envNames = [
  "NODE_ENV",
  "ENABLE_VERIFICATION_SANDBOX_DEMO",
  "PAYSTACK_WEBHOOK_SECRET",
  "PAYSTACK_SECRET_KEY",
];

const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]])
);

let server;
let webhookUrl;

const rawBody = Buffer.from(
  JSON.stringify({
    event: "ping",
    data: { ok: true },
  })
);

function modernSignature(body, timestamp) {
  const signature = createHmac(
    "sha512",
    TEST_WEBHOOK_SECRET
  )
    .update(`${timestamp}.`)
    .update(body)
    .digest("hex");

  return `t=${timestamp},v1=whk_local:${signature}`;
}

function legacySignature(body) {
  return createHmac("sha512", TEST_API_SECRET)
    .update(body)
    .digest("hex");
}

async function sendWebhook(body, headers = {}) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });

  return response.status;
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.ENABLE_VERIFICATION_SANDBOX_DEMO = "true";
  process.env.PAYSTACK_WEBHOOK_SECRET =
    TEST_WEBHOOK_SECRET;
  process.env.PAYSTACK_SECRET_KEY = TEST_API_SECRET;

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  webhookUrl =
    `http://127.0.0.1:${server.address().port}` +
    "/api/payments/webhook";
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) =>
        error ? reject(error) : resolve()
      )
    );
  }

  for (const name of envNames) {
    if (originalEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalEnv[name];
    }
  }
});

test("Unsigned webhook is rejected", async () => {
  assert.equal(await sendWebhook(rawBody), 401);
});

test("Valid modern signature is accepted", async () => {
  const timestamp = Math.floor(Date.now() / 1000);

  const status = await sendWebhook(rawBody, {
    "Paystack-Signature":
      modernSignature(rawBody, timestamp),
  });

  assert.equal(status, 200);
});

test("Tampered payload is rejected", async () => {
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = modernSignature(
    rawBody,
    timestamp
  );

  const changedBody = Buffer.from(
    JSON.stringify({
      event: "ping",
      data: { ok: false },
    })
  );

  const status = await sendWebhook(changedBody, {
    "Paystack-Signature": signature,
  });

  assert.equal(status, 401);
});

test("Expired signature is rejected", async () => {
  const timestamp =
    Math.floor(Date.now() / 1000) - 600;

  const status = await sendWebhook(rawBody, {
    "Paystack-Signature":
      modernSignature(rawBody, timestamp),
  });

  assert.equal(status, 401);
});

test("Valid legacy signature is accepted", async () => {
  const status = await sendWebhook(rawBody, {
    "x-paystack-signature":
      legacySignature(rawBody),
  });

  assert.equal(status, 200);
});

test("Invalid modern signature cannot fall back", async () => {
  const timestamp = Math.floor(Date.now() / 1000);

  const status = await sendWebhook(rawBody, {
    "Paystack-Signature":
      `t=${timestamp},v1=whk_local:${"0".repeat(128)}`,
    "x-paystack-signature":
      legacySignature(rawBody),
  });

  assert.equal(status, 401);
});