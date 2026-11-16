import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import Payment from "../models/Payment.js";

import {
  verifyAndRecordTestPayment,
} from "../services/paystackPaymentVerificationService.js";

function signaturesMatch(expected, suppliedHex) {
  if (
    typeof suppliedHex !== "string" ||
    !/^[0-9a-f]{128}$/.test(suppliedHex)
  ) {
    return false;
  }

  const supplied = Buffer.from(suppliedHex, "hex");

  return (
    supplied.length === expected.length &&
    timingSafeEqual(expected, supplied)
  );
}

// Verify either Paystack's newer timestamped
// signature or the legacy test-mode signature.
export function verifyWebhookSignature(rawBody, headers) {
  if (!Buffer.isBuffer(rawBody)) {
    return false;
  }

  const modernHeader = headers["paystack-signature"];

  // Never fall back to a legacy signature when
  // a modern signature is present but invalid.
  if (modernHeader !== undefined) {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET;

    if (
      !secret?.startsWith("whsec_") ||
      typeof modernHeader !== "string"
    ) {
      return false;
    }

    const parts = modernHeader
      .split(",")
      .map((part) => part.trim());

    const timestamps = parts.filter(
      (part) => part.startsWith("t=")
    );

    if (timestamps.length !== 1) {
      return false;
    }

    const timestampText = timestamps[0].slice(2);

    if (!/^\d+$/.test(timestampText)) {
      return false;
    }

    const timestamp = Number(timestampText);
    const now = Math.floor(Date.now() / 1000);

    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(now - timestamp) > 300
    ) {
      return false;
    }

    const expected = createHmac("sha512", secret)
      .update(`${timestampText}.`)
      .update(rawBody)
      .digest();

    return parts
      .filter((part) => part.startsWith("v1="))
      .some((part) => {
        const entry = part.slice(3);
        const colon = entry.indexOf(":");

        if (colon === -1) {
          return false;
        }

        const keyId = entry.slice(0, colon);
        const signature = entry.slice(colon + 1);

        return (
          /^whk_[a-zA-Z0-9_-]+$/.test(keyId) &&
          signaturesMatch(expected, signature)
        );
      });
  }

  // Legacy signature support for Paystack Test Mode.
  const legacyHeader = headers["x-paystack-signature"];
  const testKey = process.env.PAYSTACK_SECRET_KEY;

  if (
    !testKey?.startsWith("sk_test_") ||
    typeof legacyHeader !== "string"
  ) {
    return false;
  }

  const expected = createHmac("sha512", testKey)
    .update(rawBody)
    .digest();

  return signaturesMatch(expected, legacyHeader);
}

// POST /api/payments/webhook
export const handlePaystackTestWebhook = async (req, res) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VERIFICATION_SANDBOX_DEMO !==
      "true"
  ) {
    return res.sendStatus(403);
  }

  // app.js must supply the unmodified raw body.
  if (!Buffer.isBuffer(req.body)) {
    return res.sendStatus(400);
  }

  if (!verifyWebhookSignature(req.body, req.headers)) {
    return res.sendStatus(401);
  }

  let event;

  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.sendStatus(400);
  }

  // We're handling only successful transaction events.
  // Other signed event types are acknowledged and ignored.
  if (event?.event !== "charge.success") {
    return res.sendStatus(200);
  }

  const data = event.data;

  if (
    data?.domain !== "test" ||
    data?.status !== "success" ||
    typeof data.reference !== "string" ||
    !/^[A-Za-z0-9.=-]{1,100}$/.test(data.reference)
  ) {
    return res.sendStatus(200);
  }

  try {
    const payment = await Payment.findOne({
      reference: data.reference,
      provider: "paystack",
      environment: "test",
    })
      .select("status amountKobo currency")
      .lean();

    // Ignore events unrelated to our payment records.
    if (!payment) {
      return res.sendStatus(200);
    }

    if (
      payment.amountKobo !== data.amount ||
      payment.currency !== data.currency
    ) {
      console.error(
        "Paystack webhook amount or currency mismatch"
      );

      return res.sendStatus(409);
    }

    // An already completed payment is processed once.
    if (payment.status === "success") {
      return res.sendStatus(200);
    }

    // Reuse our existing provider verification service.
    // This checks Paystack's API before updating MongoDB.
    const result = await verifyAndRecordTestPayment(
      data.reference
    );

    if (result.status !== "success") {
      return res.sendStatus(503);
    }

    // Booking status and paymentStatus are untouched.
    return res.sendStatus(200);
  } catch (error) {
    console.error(
      "Paystack webhook processing failed:",
      error
    );

    // Let Paystack retry when processing fails.
    return res.sendStatus(503);
  }
};