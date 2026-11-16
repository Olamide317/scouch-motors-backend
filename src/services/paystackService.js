const PAYSTACK_API_URL = "https://api.paystack.co";

function getPaystackKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;

  // Development integration only until production
  // merchant eligibility and verification are ready.
  if (process.env.NODE_ENV === "production" || !key?.startsWith("sk_test_")) {
    throw new Error("An authorized Paystack test configuration is required.");
  }

  return key;
}

async function paystackRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${PAYSTACK_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getPaystackKey()}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });

  if (!response.ok) {
    throw new Error(`Paystack API request failed: HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result?.status !== true || !result.data) {
    throw new Error("Invalid Paystack API response");
  }

  return result.data;
}

export async function initializePaystackTransaction({
  email,
  amountKobo,
  reference,
}) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Valid customer email required");
  }

  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    throw new Error("Invalid payment amount");
  }

  if (typeof reference !== "string" || !/^[A-Za-z0-9.=-]+$/.test(reference)) {
    throw new Error("Invalid payment reference");
  }

  const callbackUrl = process.env.PAYSTACK_TEST_CALLBACK_URL;

  if (callbackUrl !== "http://localhost:5173/payments/test/result") {
    throw new Error("Invalid local Paystack test callback URL.");
  }

  const data = await paystackRequest("/transaction/initialize", {
    method: "POST",
    body: {
      email,
      amount: String(amountKobo),
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
    },
  });

  if (
    data.reference !== reference ||
    typeof data.authorization_url !== "string" ||
    new URL(data.authorization_url).hostname !== "checkout.paystack.com"
  ) {
    throw new Error("Invalid Paystack checkout response");
  }

  return {
    reference: data.reference,
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    environment: "test",
  };
}

export async function verifyPaystackTransaction(reference) {
  if (typeof reference !== "string" || !/^[A-Za-z0-9.=-]+$/.test(reference)) {
    throw new Error("Invalid payment reference");
  }

  const data = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );

  if (data.reference !== reference || data.domain !== "test") {
    throw new Error("Unexpected Paystack transaction");
  }

  return {
    reference: data.reference,
    status: data.status,
    amountKobo: data.amount,
    currency: data.currency,
    environment: data.domain,
    paidAt: data.paid_at ?? null,
  };
}
