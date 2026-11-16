import { randomUUID } from "node:crypto";

import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import VerificationSession from
  "../modules/verification/models/VerificationSession.js";
import VerificationCycle from
  "../modules/verification/models/VerificationCycle.js";
import {
  verifyAndRecordTestPayment,
  PaymentVerificationError,
} from "../services/paystackPaymentVerificationService.js";
import {
  initializePaystackTransaction,
} from "../services/paystackService.js";

const isValidId = (id) =>
  typeof id === "string" &&
  /^[a-fA-F0-9]{24}$/.test(id);

// POST /api/payments/test/bookings/:bookingId/initialize
export const initializeTestPayment = async (req, res) => {
  // Never expose demo checkout in production.
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VERIFICATION_SANDBOX_DEMO !== "true"
  ) {
    return res.status(403).json({
      success: false,
      message: "Test checkout is disabled.",
    });
  }

  if (!isValidId(req.params.bookingId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid booking ID.",
    });
  }

  // The client must never supply the payment amount.
  if (
    req.body &&
    Object.keys(req.body).length > 0
  ) {
    return res.status(400).json({
      success: false,
      message: "This endpoint requires an empty body.",
    });
  }

  if (
    !process.env.PAYSTACK_SECRET_KEY?.startsWith(
      "sk_test_"
    )
  ) {
    return res.status(503).json({
      success: false,
      message: "Authorized Paystack test credentials are required.",
    });
  }

  try {
    const user = req.user;

    if (
      !user?.isActive ||
      (user.accountStatus &&
        user.accountStatus !== "active")
    ) {
      return res.status(403).json({
        success: false,
        message: "Account unavailable.",
      });
    }

    // Retrieve only this customer's booking.
    const booking = await Booking.findOne({
      _id: req.params.bookingId,
      customer: user._id,
    })
      .select(
        "status verificationStatus paymentStatus pricing"
      )
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    // This is a demonstration transaction only.
    if (
      ![
        "requested",
        "provisionally_approved",
        "awaiting_payment",
      ].includes(booking.status) ||
      !["unpaid", "failed"].includes(
        booking.paymentStatus
      )
    ) {
      return res.status(409).json({
        success: false,
        message: "Booking cannot start a test payment.",
      });
    }

    // Use the customer's latest sandbox session.
    const latestSession =
      await VerificationSession.findOne({
        user: user._id,
      })
        .sort({ createdAt: -1, _id: -1 })
        .select(
          "cycle status method provider consentVersion " +
          "consentedAt consentWithdrawnAt " +
          "identityRevisionAtStart " +
          "accountLifecycleRevisionAtStart"
        )
        .lean();

    const validDemo = Boolean(
      latestSession &&
      latestSession.status === "sandbox_matched" &&
      latestSession.method === "nin" &&
      latestSession.provider === "ninja" &&
      latestSession.consentVersion ===
        "scouch-sandbox-demo-v1" &&
      latestSession.consentedAt &&
      !latestSession.consentWithdrawnAt &&
      latestSession.identityRevisionAtStart ===
        (user.identityRevision ?? 0) &&
      latestSession.accountLifecycleRevisionAtStart ===
        (user.accountLifecycleRevision ?? 0)
    );

    const activeCycle = validDemo
      ? await VerificationCycle.exists({
          _id: latestSession.cycle,
          user: user._id,
          status: "active",
        })
      : null;

    if (!validDemo || !activeCycle) {
      return res.status(403).json({
        success: false,
        message: "No valid sandbox demo verification.",
      });
    }

    // Amount comes from the server's booking record.
    const amountNGN = booking.pricing?.totalAmount;
    const amountKobo = Math.round(amountNGN * 100);

    if (
      booking.pricing?.currency !== "NGN" ||
      !Number.isFinite(amountNGN) ||
      amountNGN <= 0 ||
      !Number.isSafeInteger(amountKobo) ||
      Math.abs(amountKobo / 100 - amountNGN) > 1e-8
    ) {
      return res.status(409).json({
        success: false,
        message: "Booking amount is invalid.",
      });
    }

    // Ensure MongoDB indexes have been initialized.
    await Payment.init();

    // Do not issue another test charge after success.
    const successfulPayment = await Payment.exists({
      booking: booking._id,
      environment: "test",
      status: "success",
    });

    if (successfulPayment) {
      return res.status(409).json({
        success: false,
        message: "Test payment already completed.",
      });
    }

    const existingPayment = await Payment.findOne({
      booking: booking._id,
      environment: "test",
      status: {
        $in: ["created", "initialized", "pending"],
      },
    }).lean();

    if (existingPayment) {
      if (
        existingPayment.authorizationUrl &&
        ["initialized", "pending"].includes(
          existingPayment.status
        )
      ) {
        return res.status(200).json({
          success: true,
          reused: true,
          payment: {
            reference: existingPayment.reference,
            amountKobo: existingPayment.amountKobo,
            currency: "NGN",
            authorizationUrl:
              existingPayment.authorizationUrl,
            environment: "test",
          },
          realCheckoutAuthorized: false,
        });
      }

      return res.status(409).json({
        success: false,
        message:
          "An existing payment attempt requires reconciliation.",
      });
    }

    const reference = `scouch-test-${randomUUID()}`;

    // Reserve our local payment attempt before
    // contacting Paystack.
    const payment = await Payment.create({
      booking: booking._id,
      customer: user._id,
      reference,
      amountKobo,
      currency: "NGN",
      provider: "paystack",
      environment: "test",
      status: "created",
    });

    let transaction;

    try {
      transaction = await initializePaystackTransaction({
        email: user.email,
        amountKobo,
        reference,
      });
    } catch (error) {
      console.error(
        "Paystack initialization failed:",
        error.message
      );

      // Keep the record for reconciliation. An API
      // timeout does not prove Paystack rejected it.
      return res.status(502).json({
        success: false,
        message:
          "Paystack initialization could not be confirmed. Do not create another attempt yet.",
        reference,
      });
    }

    await Payment.updateOne(
      {
        _id: payment._id,
        status: "created",
      },
      {
        $set: {
          status: "initialized",
          initializedAt: new Date(),
          authorizationUrl: transaction.authorizationUrl,
        },
      },
      { runValidators: true }
    );

    return res.status(201).json({
      success: true,
      reused: false,
      payment: {
        reference,
        amountKobo,
        currency: "NGN",
        authorizationUrl:
          transaction.authorizationUrl,
        environment: "test",
        status: "initialized",
      },
      realCheckoutAuthorized: false,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Payment initiation already in progress.",
      });
    }

    console.error("Payment initialization error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to initialize test payment.",
    });
  }
};

// GET /api/payments/test/:reference/verify
export const verifyTestPayment = async (req, res) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VERIFICATION_SANDBOX_DEMO !== "true"
  ) {
    return res.status(403).json({
      success: false,
      message: "Test payment verification is disabled.",
    });
  }

  const { reference } = req.params;

  if (
    typeof reference !== "string" ||
    !/^[A-Za-z0-9.=-]{1,100}$/.test(reference)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment reference.",
    });
  }

  try {
    // Only the payment owner may verify through
    // this customer-facing endpoint.
    const payment = await Payment.findOne({
      reference,
      customer: req.user._id,
      provider: "paystack",
      environment: "test",
    }).select("_id");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found.",
      });
    }

    const result = await verifyAndRecordTestPayment(
      reference
    );

    return res.status(200).json({
      success: true,
      payment: result,
      bookingUpdated: false,
      realCheckoutAuthorized: false,
    });
  } catch (error) {
    if (error instanceof PaymentVerificationError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    console.error(
      "Paystack test payment verification failed:",
      error
    );

    return res.status(502).json({
      success: false,
      message: "Unable to verify Paystack transaction.",
    });
  }
};

export const getMyTestPayments = async (req, res) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VERIFICATION_SANDBOX_DEMO !== "true"
  ) {
    return res.status(403).json({
      success: false,
      message: "Test payment history is disabled.",
    });
  }

  try {
    const payments = await Payment.find({
      customer: req.user._id,
      provider: "paystack",
      environment: "test",
    })
      .sort({ createdAt: -1, _id: -1 })
      .select("booking status amountKobo verifiedAt")
      .lean();

    return res.status(200).json({
      success: true,
      payments: payments.map((payment) => ({
        bookingId: String(payment.booking),
        status: payment.status,
        amountKobo: payment.amountKobo,
        verifiedAt: payment.verifiedAt,
        environment: "test",
      })),
      realCheckoutAuthorized: false,
    });
  } catch (error) {
    console.error("Retrieve test payments failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve test payments.",
    });
  }
};