import mongoose from "mongoose";

import VerificationSession from "../models/VerificationSession.js";
import VerificationCycle from "../models/VerificationCycle.js";
import VerificationAuditEvent from "../models/VerificationAuditEvent.js";

import {
  assertSessionTransition,
} from "./stateRules.js";

/**
 * Changes a verification session's ordinary lifecycle
 * state and records the action in the audit log.
 *
 * INTERNAL SERVICE ONLY.
 *
 * Do not expose this function as a generic API endpoint.
 *
 * Provider verification outcomes must be handled
 * by a separate authenticated provider-result service.
 */
export async function transitionSessionLifecycle({
  sessionId,
  nextStatus,
  expectedVersion,
  reasonCode = "SESSION_LIFECYCLE_UPDATE",
}) {
  // Step 1: Validate the operation inputs.

  if (!mongoose.isValidObjectId(sessionId)) {
    throw new Error("Invalid verification session ID");
  }

  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    throw new Error(
      "A valid expected state version is required"
    );
  }

  // Reason codes must be standardized identifiers,
  // not free-text or sensitive customer information.
  if (
    typeof reasonCode !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode)
  ) {
    throw new Error("Invalid audit reason code");
  }

  // Step 2: Start a MongoDB session.

  const mongoSession = await mongoose.startSession();

  try {
    let result;

    // Step 3: Execute the change in a transaction.

    await mongoSession.withTransaction(async () => {
      const record = await VerificationSession
        .findById(sessionId)
        .session(mongoSession);

      if (!record) {
        throw new Error(
          "Verification session not found"
        );
      }

      // Protect against stale updates.
      if (record.stateVersion !== expectedVersion) {
        throw new Error(
          "Verification session version conflict"
        );
      }

      // Apply our previously tested state rules.
      assertSessionTransition(
        record.status,
        nextStatus
      );

      // Confirm that the session belongs to a
      // legitimate verification cycle.
      const cycle = await VerificationCycle
        .findById(record.cycle)
        .session(mongoSession);

      if (
        !cycle ||
        String(cycle.user) !== String(record.user)
      ) {
        throw new Error(
          "Verification cycle is missing or invalid"
        );
      }

      // Except for cancellation, ordinary lifecycle
      // changes require an active verification cycle.
      if (
        nextStatus !== "cancelled" &&
        cycle.status !== "active"
      ) {
        throw new Error(
          "Verification cycle is not active"
        );
      }

      // Provider processing requires valid consent
      // and an existing provider session reference.
      if (
        ["pending", "processing"].includes(nextStatus)
      ) {
        if (
          !record.consentedAt ||
          record.consentWithdrawnAt ||
          !record.providerReference
        ) {
          throw new Error(
            "Valid consent and provider reference required"
          );
        }
      }

      // Step 4: Prepare the database update.
      const update = {
        $set: {
          status: nextStatus,
        },
        $inc: {
          stateVersion: 1,
        },
      };

      if (
        ["cancelled", "expired"].includes(nextStatus)
      ) {
        update.$set.completedAt = new Date();
      }

      // Only update if the version and status
      // still match what we originally read.
      const updated = await VerificationSession
        .findOneAndUpdate(
          {
            _id: record._id,
            status: record.status,
            stateVersion: expectedVersion,
          },
          update,
          {
            new: true,
            runValidators: true,
            session: mongoSession,
          }
        );

      if (!updated) {
        throw new Error(
          "Verification session changed concurrently"
        );
      }

      // Step 5: Record the action in the SAME
      // MongoDB transaction.
      //
      // This first service is system-only.
      // We deliberately construct the actor here
      // rather than accepting it from the caller.
      await VerificationAuditEvent.create(
        [
          {
            eventType: "session_status_changed",

            user: record.user,
            cycle: record.cycle,
            session: record._id,

            actor: {
              type: "system",
            },

            details: {
              previousStatus: record.status,
              nextStatus,
              reasonCode,
            },
          },
        ],
        {
          session: mongoSession,
        }
      );

      // Return only the information needed by
      // the trusted calling service.
      result = {
        sessionId: String(updated._id),
        status: updated.status,
        stateVersion: updated.stateVersion,
      };
    });

    return result;
  } finally {
    // Step 6: Always close the MongoDB session.
    await mongoSession.endSession();
  }
}