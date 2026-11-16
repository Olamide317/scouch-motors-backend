import Payment from "../models/Payment.js";

import {
  verifyPaystackTransaction,
} from "./paystackService.js";

export class PaymentVerificationError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = "PaymentVerificationError";
    this.statusCode = statusCode;
  }
}

function normalizeTransactionStatus(status) {
  switch (status) {
    case "success":
      return "success";

    case "failed":
      return "failed";

    case "abandoned":
      return "abandoned";

    case "ongoing":
    case "pending":
    case "processing":
    case "queued":
      return "pending";

    default:
      // Reversals and unknown provider statuses require
      // separate reconciliation, not automatic approval.
      throw new PaymentVerificationError(
        "Transaction requires further reconciliation."
      );
  }
}

export async function verifyAndRecordTestPayment(reference) {
  const payment = await Payment.findOne({
    reference,
    provider: "paystack",
    environment: "test",
  });

  if (!payment) {
    throw new PaymentVerificationError(
      "Payment not found.",
      404
    );
  }

  // Always check Paystack itself. A frontend redirect
  // or callback is never payment evidence.
  const result = await verifyPaystackTransaction(reference);

  if (
    result.environment !== "test" ||
    result.reference !== payment.reference ||
    result.currency !== payment.currency ||
    !Number.isSafeInteger(result.amountKobo) ||
    result.amountKobo !== payment.amountKobo
  ) {
    throw new PaymentVerificationError(
      "Provider transaction does not match the payment record."
    );
  }

  const nextStatus = normalizeTransactionStatus(
    result.status
  );

  const now = new Date();

  const paidAt =
    nextStatus === "success" &&
    result.paidAt &&
    !Number.isNaN(new Date(result.paidAt).getTime())
      ? new Date(result.paidAt)
      : null;

  // A successful payment must not be downgraded by
  // subsequent pending or failed responses.
  // Also allows late-arriving success after failure.
  const updated = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      status: {
        $in: [
          "created",
          "initialized",
          "pending",
          "failed",
          "abandoned",
        ],
      },
    },
    {
      $set: {
        status: nextStatus,
        verifiedAt: now,
        ...(nextStatus === "success"
          ? { paidAt }
          : {}),
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  // Another verification request may have already
  // finalized the payment. Return the current record.
  const current =
    updated ?? (await Payment.findById(payment._id));

  if (!current) {
    throw new PaymentVerificationError(
      "Payment no longer exists.",
      404
    );
  }

  return {
    reference: current.reference,
    bookingId: String(current.booking),
    amountKobo: current.amountKobo,
    currency: current.currency,
    status: current.status,
    environment: current.environment,
    verifiedAt: current.verifiedAt,
    paidAt: current.paidAt,
    realCheckoutAuthorized: false,
  };
}