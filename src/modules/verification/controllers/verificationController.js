import VerificationSession from "../models/VerificationSession.js";
import mongoose from "mongoose";
import User from "../../../models/User.js";
import BusinessSettings from "../../../models/BusinessSettings.js";
import VerificationCycle from "../models/VerificationCycle.js";
import VerificationAuditEvent from "../models/VerificationAuditEvent.js";
import {
  verifyNinjaSandboxIdentity,
} from "../providers/ninjaSandboxClient.js";
import Booking from "../../../models/Booking.js";
import {
  classifyNinjaSandboxOutcome,
} from "../services/ninjaOutcomeClassifier.js";

import { assessCycleAttemptCapacity } from "../services/attemptPolicy.js";

// GET /api/verification/me
export const getMyVerificationStatus = async (req, res) => {
  try {
    // Customer identity comes from our JWT middleware,
    // never from a user ID supplied in the request.
    const userId = req.user._id;

    // Retrieve only the latest verification session.
    const latestSession = await VerificationSession.findOne({
      user: userId,
    })
      .sort({ createdAt: -1, _id: -1 })
      .select(
        "_id method provider status consentVersion createdAt completedAt expiresAt",
      )
      .lean();

    // Customer has not started verification.
    if (!latestSession) {
      return res.status(200).json({
        success: true,
        verification: {
          status: "not_started",
          session: null,
        },
        checkoutEligibility: {
          evaluated: false,
        },
      });
    }

    // Sandbox results must remain distinguishable.
    const isSandboxOutcome =
      latestSession.status.startsWith("sandbox_") ||
      latestSession.consentVersion === "scouch-sandbox-demo-v1";

    return res.status(200).json({
      success: true,

      verification: {
        status: latestSession.status,

        session: {
          id: String(latestSession._id),
          method: latestSession.method,
          provider: latestSession.provider,
          createdAt: latestSession.createdAt,
          completedAt: latestSession.completedAt,
          expiresAt: latestSession.expiresAt,
        },

        resultType: isSandboxOutcome ? "sandbox_demo" : "session_state",
      },

      // A session-status endpoint must never authorize
      // a booking or payment.
      checkoutEligibility: {
        evaluated: false,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve verification status:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve verification status",
    });
  }
};

const OPEN_SESSION_STATUSES = new Set([
  "created",
  "pending",
  "processing",
  "reconciling",
]);

function sandboxSessionResponse(session, reused = false) {
  return {
    success: true,
    verification: {
      status: session.status,
      environment: "sandbox_demo",
      reused,
      session: {
        id: String(session._id),
        method: session.method,
        provider: session.provider,
        createdAt: session.createdAt,
      },
    },
    checkoutEligibility: {
      evaluated: false,
    },
  };
}

// POST /api/verification/start
export const startSandboxVerification = async (req, res) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VERIFICATION_SANDBOX_DEMO !== "true"
  ) {
    return res.status(403).json({
      success: false,
      message: "Sandbox verification initiation is disabled.",
    });
  }

  const { method, consentToDemo } = req.body ?? {};
  const allowedFields = new Set(["method", "consentToDemo"]);

  if (
    method !== "nin" ||
    consentToDemo !== true ||
    Object.keys(req.body ?? {}).some((key) => !allowedFields.has(key))
  ) {
    return res.status(400).json({
      success: false,
      message:
        'Use method "nin" and consentToDemo: true. Do not submit identity numbers.',
    });
  }

  const dbSession = await mongoose.startSession();

  try {
    const result = await dbSession.withTransaction(async () => {
      const user = await User.findById(req.user._id)
        .select(
          "isActive accountStatus identityRevision accountLifecycleRevision",
        )
        .session(dbSession);

      if (
        !user ||
        !user.isActive ||
        (user.accountStatus && user.accountStatus !== "active")
      ) {
        return {
          code: 403,
          body: {
            success: false,
            message: "Account unavailable.",
          },
        };
      }

      const settings = await BusinessSettings.findOne({
        key: "primary",
      })
        .select("verificationPolicy")
        .session(dbSession)
        .lean();

      const policy = settings?.verificationPolicy ?? {};

      const maxIncorrectSubmissions = policy.incorrectSubmissionsPerCycle ?? 3;

      const validityMonthsSnapshot = policy.validityMonths ?? 12;

      const policyVersion = policy.version ?? 1;

      if (
        (Array.isArray(policy.acceptedMethods) &&
          !policy.acceptedMethods.includes("nin")) ||
        ![2, 3].includes(maxIncorrectSubmissions) ||
        !Number.isSafeInteger(validityMonthsSnapshot) ||
        validityMonthsSnapshot < 1 ||
        !Number.isSafeInteger(policyVersion) ||
        policyVersion < 1
      ) {
        return {
          code: 409,
          body: {
            success: false,
            message: "Verification policy does not permit this demo.",
          },
        };
      }

      let cycle = await VerificationCycle.findOne({
        user: user._id,
      })
        .sort({ createdAt: -1, _id: -1 })
        .session(dbSession);

      if (cycle) {
        const capacity = assessCycleAttemptCapacity(cycle);

        if (!capacity.canAttempt) {
          return {
            code: 409,
            body: {
              success: false,
              message: "Verification cycle is unavailable.",
            },
          };
        }

        const existingSession = await VerificationSession.findOne({
          cycle: cycle._id,
        })
          .sort({ createdAt: -1, _id: -1 })
          .session(dbSession);

        if (existingSession) {
          if (OPEN_SESSION_STATUSES.has(existingSession.status)) {
            return {
              code: 200,
              body: sandboxSessionResponse(existingSession, true),
            };
          }

          return {
            code: 409,
            body: {
              success: false,
              message: "A demo session already completed. Use GET /me.",
            },
          };
        }
      } else {
        cycle = new VerificationCycle({
          user: user._id,
          purpose: "initial",
          status: "active",
          policyVersion,
          maxIncorrectSubmissions,
          validityMonthsSnapshot,
          identityRevisionAtStart: user.identityRevision ?? 0,
          accountLifecycleRevisionAtStart: user.accountLifecycleRevision ?? 0,
        });

        await cycle.save({ session: dbSession });
      }

      const verificationSession = new VerificationSession({
        user: user._id,
        cycle: cycle._id,
        method: "nin",
        provider: "ninja",
        status: "created",
        consentVersion: "scouch-sandbox-demo-v1",
        consentedAt: new Date(),
        identityRevisionAtStart: user.identityRevision ?? 0,
        accountLifecycleRevisionAtStart: user.accountLifecycleRevision ?? 0,
      });

      await verificationSession.save({
        session: dbSession,
      });

      await VerificationAuditEvent.create(
        [
          {
            eventType: "session_created",

            user: user._id,

            actor: {
              type: "customer",
              user: user._id,
            },

            cycle: cycle._id,
            session: verificationSession._id,

            details: {
              nextStatus: "created",
              reasonCode: "sandbox_demo",
              policyVersion: cycle.policyVersion,
              identityRevision: user.identityRevision ?? 0,
              accountLifecycleRevision: user.accountLifecycleRevision ?? 0,
            },
          },
        ],
        { session: dbSession },
      );

      return {
        code: 201,
        body: sandboxSessionResponse(verificationSession),
      };
    });

    return res.status(result.code).json(result.body);
  } catch (error) {
    if (
      error?.code === 11000 ||
      error?.hasErrorLabel?.("TransientTransactionError")
    ) {
      return res.status(409).json({
        success: false,
        message:
          "A verification session changed concurrently. Retry the request.",
      });
    }

    console.error("Unable to start sandbox verification:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to start sandbox verification.",
    });
  } finally {
    await dbSession.endSession();
  }
};

const DEMO_CONSENT_VERSION = "scouch-sandbox-demo-v1";

function mapSandboxStatus(outcome) {
  switch (outcome.status) {
    case "simulated_match":
      return "sandbox_matched";

    case "not_found":
      return "sandbox_not_found";

    case "requires_review":
      return outcome.reason === "identity_name_mismatch"
        ? "sandbox_mismatch"
        : "sandbox_review";

    default:
      return "sandbox_error";
  }
}

// POST /api/verification/demo/run
export const runSandboxVerification = async (req, res) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VERIFICATION_SANDBOX_DEMO !== "true"
  ) {
    return res.status(403).json({
      success: false,
      message: "Sandbox demo is disabled.",
    });
  }

  // No NIN, identity details, or scenario input accepted.
  if (
    req.body &&
    (typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length > 0)
  ) {
    return res.status(400).json({
      success: false,
      message: "This demo endpoint requires an empty body.",
    });
  }

  if (
    !process.env.NINJA_SANDBOX_SECRET_KEY?.startsWith(
      "sk_sandbox_"
    )
  ) {
    return res.status(503).json({
      success: false,
      message: "Ninja sandbox is not configured.",
    });
  }

  try {
    const user = await User.findById(req.user._id).lean();

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

    const latest = await VerificationSession.findOne({
      user: user._id,
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    if (
      !latest ||
      latest.status !== "created" ||
      latest.provider !== "ninja" ||
      latest.method !== "nin" ||
      latest.consentVersion !== DEMO_CONSENT_VERSION ||
      !latest.consentedAt ||
      latest.consentWithdrawnAt
    ) {
      return res.status(409).json({
        success: false,
        message: "No eligible created sandbox session.",
      });
    }

    const cycle = await VerificationCycle.findOne({
      _id: latest.cycle,
      user: user._id,
      status: "active",
    }).lean();

    if (
      !cycle ||
      !assessCycleAttemptCapacity(cycle).canAttempt ||
      latest.identityRevisionAtStart !==
        (user.identityRevision ?? 0) ||
      latest.accountLifecycleRevisionAtStart !==
        (user.accountLifecycleRevision ?? 0)
    ) {
      return res.status(409).json({
        success: false,
        message: "Verification cycle or account has changed.",
      });
    }

    // Atomically claim the session so two requests
    // cannot call Ninja for the same session.
    const claimed = await VerificationSession.findOneAndUpdate(
      {
        _id: latest._id,
        user: user._id,
        status: "created",
        stateVersion: latest.stateVersion,
        consentWithdrawnAt: null,
      },
      {
        $set: { status: "processing" },
        $inc: { stateVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    if (!claimed) {
      return res.status(409).json({
        success: false,
        message: "Verification session already changed.",
      });
    }

    let outcome;

    try {
      // Uses the fixed synthetic identity from our
      // existing Ninja sandbox client.
      const providerResult =
        await verifyNinjaSandboxIdentity();

      outcome = classifyNinjaSandboxOutcome(
        providerResult
      );
    } catch (error) {
      outcome = classifyNinjaSandboxOutcome(
        error instanceof Error
          ? error
          : new Error("Sandbox request failed")
      );
    }

    let finalStatus = mapSandboxStatus(outcome);
    let reason = outcome.reason;

    const dbSession = await mongoose.startSession();

    try {
      await dbSession.withTransaction(async () => {
        const current = await VerificationSession.findOne({
          _id: claimed._id,
          user: user._id,
          status: "processing",
          stateVersion: claimed.stateVersion,
        }).session(dbSession);

        if (!current) {
          throw new Error(
            "Verification session changed during processing."
          );
        }

        const currentUser = await User.findById(
          user._id
        ).session(dbSession);

        const currentCycle =
          await VerificationCycle.findById(
            current.cycle
          ).session(dbSession);

        // Recheck account, consent, and cycle after
        // the external API call has completed.
        if (
          !currentUser?.isActive ||
          (currentUser.accountStatus &&
            currentUser.accountStatus !== "active") ||
          current.consentWithdrawnAt ||
          current.identityRevisionAtStart !==
            (currentUser.identityRevision ?? 0) ||
          current.accountLifecycleRevisionAtStart !==
            (currentUser.accountLifecycleRevision ?? 0) ||
          !currentCycle ||
          currentCycle.status !== "active" ||
          !assessCycleAttemptCapacity(
            currentCycle
          ).canAttempt
        ) {
          finalStatus = "sandbox_error";
          reason = "verification_state_changed";
        }

        current.status = finalStatus;
        current.completedAt = new Date();
        current.lastReconciledAt = new Date();
        current.stateVersion += 1;

        await current.save({ session: dbSession });

        await VerificationAuditEvent.create(
          [
            {
              eventType: "sandbox_result_recorded",
              user: user._id,
              actor: { type: "system" },
              cycle: current.cycle,
              session: current._id,
              details: {
                previousStatus: "processing",
                nextStatus: finalStatus,
                reasonCode: reason,
                policyVersion:
                  currentCycle?.policyVersion ?? 1,
              },
            },
          ],
          { session: dbSession }
        );
      });
    } finally {
      await dbSession.endSession();
    }

    return res.status(200).json({
      success: true,
      verification: {
        sessionId: String(claimed._id),
        status: finalStatus,
        environment: "sandbox_demo",
        reason,
      },
      checkoutEligibility: {
        evaluated: false,
        eligibleForCheckout: false,
      },
    });

  } catch (error) {
    console.error(
      "Sandbox verification processing failed:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to process sandbox verification.",
    });
  }
};

/**
 * GET /api/verification/demo/bookings/:bookingId/preview
 *
 * Read-only sandbox booking integration.
 * Does not authorize checkout or modify booking records.
 */
export const getDemoBookingVerification = async (req, res) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VERIFICATION_SANDBOX_DEMO !== "true"
  ) {
    return res.status(403).json({
      success: false,
      message: "Sandbox booking preview is disabled.",
    });
  }

  const { bookingId } = req.params;

  if (!/^[a-fA-F0-9]{24}$/.test(bookingId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid booking ID.",
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

    // Only the authenticated customer can preview
    // verification for their own booking.
    const booking = await Booking.findOne({
      _id: bookingId,
      customer: user._id,
    })
      .select("_id status verificationStatus paymentStatus")
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    // Always inspect the latest session so an older
    // successful simulation cannot be reused.
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

    const activeCycle = latestSession
      ? await VerificationCycle.exists({
          _id: latestSession.cycle,
          user: user._id,
          status: "active",
        })
      : null;

    const simulatedMatch = Boolean(
      latestSession &&
      activeCycle &&
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

    return res.status(200).json({
      success: true,

      booking: {
        id: String(booking._id),
        status: booking.status,
        verificationStatus: booking.verificationStatus,
        paymentStatus: booking.paymentStatus,
      },

      demoVerification: {
        environment: "sandbox_demo",
        status: simulatedMatch
          ? "simulated_match"
          : "not_ready",
        canDisplayDemoMatch: simulatedMatch,
        source: "ninja_sandbox",
        visualOnly: true,
      },

      realCheckout: {
        evaluated: false,
        authorized: false,
      },
    });
  } catch (error) {
    console.error(
      "Demo booking verification preview failed:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load demo verification preview.",
    });
  }
};