import mongoose from "mongoose";
import { createHash } from "node:crypto";

import User from "../../../models/User.js";
import VerificationSession from "../models/VerificationSession.js";
import VerificationCycle from "../models/VerificationCycle.js";
import VerificationAuditEvent from "../models/VerificationAuditEvent.js";
import { assessCycleAttemptCapacity } from "./attemptPolicy.js";

import { verifyNinjaSandboxIdentity } from "../providers/ninjaSandboxClient.js";

import { planNinjaDemoAttempt } from "./ninjaDemoAttemptPlanner.js";

const SCENARIOS = {
  match: {
    idNumber: "77777777777",
    firstName: "James",
    lastName: "Bond",
    dateOfBirth: "1975-01-01",
  },
  mismatch: {
    idNumber: "77777777777",
    firstName: "John",
    lastName: "Doe",
    dateOfBirth: "1975-01-01",
  },
  not_found: {
    idNumber: "55555555555",
    firstName: "James",
    lastName: "Bond",
    dateOfBirth: "1975-01-01",
  },
  technical_failure: {
    idNumber: "00000000000",
    firstName: "James",
    lastName: "Bond",
    dateOfBirth: "1975-01-01",
  },
};

const ONGOING = new Set(["created", "pending", "processing", "reconciling"]);

const DEMO_TERMINAL = new Set([
  "sandbox_matched",
  "sandbox_mismatch",
  "sandbox_not_found",
  "sandbox_review",
  "sandbox_error",
]);

function assertDemoEnvironment() {
  if (!["development", "test"].includes(process.env.NODE_ENV)) {
    throw new Error("Sandbox finalization requires a test environment");
  }

  if (process.env.ALLOW_NINJA_SANDBOX_DB_WRITES !== "true") {
    throw new Error("Sandbox database writes are disabled");
  }

  const databaseName = mongoose.connection.db?.databaseName;

  if (
    mongoose.connection.readyState !== 1 ||
    !/^scouch_demo_[a-zA-Z0-9_]+$/.test(databaseName ?? "")
  ) {
    throw new Error("Connect to a dedicated scouch_demo_ database first");
  }
}

export function mapNinjaSandboxTerminalStatus(classification) {
  switch (classification?.status) {
    case "simulated_match":
      return "sandbox_matched";

    case "not_found":
      return "sandbox_not_found";

    case "technical_failure":
      return "sandbox_error";

    case "requires_review":
      return classification.reason === "identity_name_mismatch"
        ? "sandbox_mismatch"
        : "sandbox_review";

    default:
      throw new Error("Unsupported sandbox outcome");
  }
}

function assertAccountAndSession({ user, session, cycle }) {
  if (!user || user.isActive === false) {
    throw new Error("Customer account is unavailable");
  }

  if (user.accountStatus && user.accountStatus !== "active") {
    throw new Error("Customer account is not active");
  }

  if (!cycle || String(cycle.user) !== String(session.user)) {
    throw new Error("Verification cycle ownership mismatch");
  }

  if (cycle.status !== "active") {
    throw new Error("Verification cycle is not active");
  }

  if (session.provider !== "ninja" || session.method !== "nin") {
    throw new Error("Session is not a Ninja NIN session");
  }

  if (
    !session.consentedAt ||
    !session.consentVersion ||
    session.consentWithdrawnAt
  ) {
    throw new Error("Valid verification consent is required");
  }

  const identityRevision = user.identityRevision ?? 0;
  const lifecycleRevision = user.accountLifecycleRevision ?? 0;

  if (
    session.identityRevisionAtStart !== identityRevision ||
    cycle.identityRevisionAtStart !== identityRevision ||
    session.accountLifecycleRevisionAtStart !== lifecycleRevision ||
    cycle.accountLifecycleRevisionAtStart !== lifecycleRevision
  ) {
    throw new Error("Customer account revisions have changed");
  }
}

function isRecoverableProviderError(error) {
  if (error.httpStatus != null) {
    return error.httpStatus === 429 || error.httpStatus >= 500;
  }

  return ["TypeError", "AbortError", "TimeoutError"].includes(error.name);
}

/**
 * Internal sandbox-only operation.
 *
 * Never mount this function directly as a public HTTP endpoint.
 */
export async function runNinjaSandboxDemo({ sessionId, scenario = "match" }) {
  assertDemoEnvironment();

  if (!mongoose.isValidObjectId(sessionId)) {
    throw new Error("Invalid verification session ID");
  }

  if (!Object.hasOwn(SCENARIOS, scenario)) {
    throw new Error("Unsupported sandbox scenario");
  }

  // Avoid another provider request for an already finalized demo.
  const existing = await VerificationSession.findById(sessionId);

  if (!existing) {
    throw new Error("Verification session not found");
  }

  if (DEMO_TERMINAL.has(existing.status)) {
    return {
      sessionId: String(existing._id),
      status: existing.status,
      alreadyFinalized: true,
      eligibleForCheckout: false,
    };
  }

  if (!ONGOING.has(existing.status)) {
    throw new Error("Session cannot accept a sandbox result");
  }

  // Validate the account and verification session BEFORE
  // contacting Ninja's API.

  const [cycleBeforeRequest, userBeforeRequest] = await Promise.all([
    VerificationCycle.findById(existing.cycle),
    User.findById(existing.user),
  ]);

  assertAccountAndSession({
    user: userBeforeRequest,
    session: existing,
    cycle: cycleBeforeRequest,
  });

  const capacity = assessCycleAttemptCapacity(cycleBeforeRequest);

  if (!capacity.canAttempt) {
    throw new Error("Verification cycle has no remaining attempts");
  }

  // External API calls must happen OUTSIDE the DB transaction.
  let ninjaResponse;

  try {
    ninjaResponse = await verifyNinjaSandboxIdentity(SCENARIOS[scenario]);
  } catch (error) {
    if (!isRecoverableProviderError(error)) {
      throw error;
    }

    ninjaResponse = error;
  }

  const dbSession = await mongoose.startSession();

  try {
    return await dbSession.withTransaction(async () => {
      const record =
        await VerificationSession.findById(sessionId).session(dbSession);

      if (!record) {
        throw new Error("Verification session no longer exists");
      }

      // A concurrent request may have finalized the session.
      if (DEMO_TERMINAL.has(record.status)) {
        return {
          sessionId: String(record._id),
          status: record.status,
          alreadyFinalized: true,
          eligibleForCheckout: false,
        };
      }

      if (!ONGOING.has(record.status)) {
        throw new Error("Session state changed before finalization");
      }

      const cycle = await VerificationCycle.findById(record.cycle).session(
        dbSession,
      );

      const user = await User.findById(record.user).session(dbSession);

      assertAccountAndSession({ user, session: record, cycle });

      // Reuse our already-tested attempt planner.
      const plan = planNinjaDemoAttempt({
        cycle,
        ninjaResponse,
      });

      if (
        plan.consumesAllowance ||
        plan.shouldMarkVerified ||
        plan.eligibleForCheckout
      ) {
        throw new Error("Unsafe sandbox finalization plan");
      }

      const nextStatus = mapNinjaSandboxTerminalStatus(plan.classification);

      const now = new Date();

      // Atomic state/version guard.
      const updated = await VerificationSession.findOneAndUpdate(
        {
          _id: record._id,
          status: record.status,
          stateVersion: record.stateVersion,
        },
        {
          $set: {
            status: nextStatus,
            completedAt: now,
          },
          $inc: { stateVersion: 1 },
        },
        {
          returnDocument: "after",
          runValidators: true,
          session: dbSession,
        },
      );

      if (!updated) {
        throw new Error("Concurrent session finalization detected");
      }

      // Stable deduplication identifier per sandbox session.
      const eventKey = createHash("sha256")
        .update(`ninja-sandbox-finalization:${record._id}`)
        .digest("hex");

      await VerificationAuditEvent.create(
        [
          {
            eventKey,
            eventType: "sandbox_result_recorded",
            user: record.user,
            cycle: record.cycle,
            session: record._id,
            actor: { type: "system" },
            details: {
              previousStatus: record.status,
              nextStatus,
              reasonCode: "NINJA_SANDBOX_RESULT",
              policyVersion: cycle.policyVersion,
            },
          },
        ],
        { session: dbSession },
      );

      // No attempt counter is updated: none of our four
      // synthetic scenarios proves incorrect credentials.
      // No IdentityVerification record is created.

      return {
        sessionId: String(updated._id),
        status: nextStatus,
        remainingAttempts: plan.remainingAttempts,
        alreadyFinalized: false,
        eligibleForCheckout: false,
      };
    });
  } finally {
    await dbSession.endSession();
  }
}
