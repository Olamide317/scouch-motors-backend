import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

import User from "../../../models/User.js";
import VerificationSession from "../models/VerificationSession.js";
import VerificationCycle from "../models/VerificationCycle.js";
import VerificationAuditEvent from "../models/VerificationAuditEvent.js";

import { transitionSessionLifecycle } from "../services/verificationStateService.js";

const TEST_DATABASE = `scouch_verification_state_test_${randomUUID().replaceAll("-", "")}`;

test("Verification state service integration", async (t) => {
  let userId = null;
  let cycleId = null;
  let sessionId = null;

  // Require explicit test mode and a dedicated test connection.
  if (process.env.NODE_ENV !== "test") {
    throw new Error("NODE_ENV must be test");
  }

  if (!process.env.MONGO_TEST_URI) {
    throw new Error(
      "MONGO_TEST_URI must point to a nonproduction MongoDB deployment",
    );
  }

  try {
    await mongoose.connect(process.env.MONGO_TEST_URI, {
      dbName: TEST_DATABASE,
      serverSelectionTimeoutMS: 10000,
    });

    assert.equal(mongoose.connection.name, TEST_DATABASE);

    await VerificationCycle.init();
    await VerificationSession.init();
    await VerificationAuditEvent.init();

    // Create a synthetic account for this service integration test.
    // Direct insertion avoids testing unrelated registration validation.
    // This is appropriate only in the isolated test database.
    userId = new mongoose.Types.ObjectId();

    await User.collection.insertOne({
      _id: userId,
      firstName: "Verification",
      lastName: "Tester",
      email: `verification-${randomUUID()}@example.invalid`,
      role: "customer",
      isActive: true,
      accountStatus: "active",
      identityRevision: 0,
      accountLifecycleRevision: 0,
    });

    // Create a valid verification cycle.
    const cycle = await VerificationCycle.create({
      user: userId,
      purpose: "initial",
      status: "active",

      maxIncorrectSubmissions: 3,
      incorrectAttemptsUsed: 0,
      extraAttemptsGranted: 0,

      policyVersion: 1,
      validityMonthsSnapshot: 12,

      identityRevisionAtStart: 0,
      accountLifecycleRevisionAtStart: 0,
    });

    cycleId = cycle._id;

    // Create a valid verification session.
    const verificationSession = await VerificationSession.create({
      user: userId,
      cycle: cycleId,

      method: "nin",
      provider: "test_provider",
      providerReference: `test-${randomUUID()}`,

      status: "created",

      consentVersion: "test-v1",
      consentedAt: new Date(),

      identityRevisionAtStart: 0,
      accountLifecycleRevisionAtStart: 0,

      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    sessionId = verificationSession._id;

    // =====================================
    // TEST 1: VALID STATE TRANSITION
    // =====================================

    await t.test(
      "Valid transition updates session and creates one audit event",
      async () => {
        const result = await transitionSessionLifecycle({
          sessionId,
          nextStatus: "pending",
          expectedVersion: 0,
          reasonCode: "TEST_SESSION_STARTED",
        });

        assert.equal(result.status, "pending");
        assert.equal(result.stateVersion, 1);

        const savedSession = await VerificationSession.findById(sessionId);

        assert.equal(savedSession.status, "pending");
        assert.equal(savedSession.stateVersion, 1);

        const auditEvents = await VerificationAuditEvent.find({
          session: sessionId,
          eventType: "session_status_changed",
        });

        assert.equal(auditEvents.length, 1);
        assert.equal(auditEvents[0].details.previousStatus, "created");
        assert.equal(auditEvents[0].details.nextStatus, "pending");
        assert.equal(auditEvents[0].actor.type, "system");
      },
    );

    // =====================================
    // TEST 2: INVALID STATE TRANSITION
    // =====================================

    await t.test("Direct verification success is rejected", async () => {
      await assert.rejects(
        transitionSessionLifecycle({
          sessionId,
          nextStatus: "succeeded",
          expectedVersion: 1,
          reasonCode: "TEST_INVALID_TRANSITION",
        }),
      );

      const savedSession = await VerificationSession.findById(sessionId);

      assert.equal(savedSession.status, "pending");
      assert.equal(savedSession.stateVersion, 1);

      const auditCount = await VerificationAuditEvent.countDocuments({
        session: sessionId,
        eventType: "session_status_changed",
      });

      assert.equal(auditCount, 1);
    });

    // =====================================
    // TEST 3: STALE VERSION CONFLICT
    // =====================================

    await t.test("Stale version cannot overwrite newer state", async () => {
      await assert.rejects(
        transitionSessionLifecycle({
          sessionId,
          nextStatus: "processing",
          expectedVersion: 0,
          reasonCode: "TEST_STALE_VERSION",
        }),
        /Verification session version conflict/,
      );

      const savedSession = await VerificationSession.findById(sessionId);

      assert.equal(savedSession.status, "pending");
      assert.equal(savedSession.stateVersion, 1);

      const auditCount = await VerificationAuditEvent.countDocuments({
        session: sessionId,
        eventType: "session_status_changed",
      });

      assert.equal(auditCount, 1);
    });
  } finally {
    // Delete only records created by this test.
    if (
      mongoose.connection.readyState === 1 &&
      mongoose.connection.name === TEST_DATABASE
    ) {
      if (sessionId) {
        await VerificationAuditEvent.deleteMany({
          session: sessionId,
        });

        await VerificationSession.deleteOne({
          _id: sessionId,
        });
      }

      if (cycleId) {
        await VerificationCycle.deleteOne({
          _id: cycleId,
        });
      }

      if (userId) {
        await User.collection.deleteOne({
          _id: userId,
        });
      }
    }

    await mongoose.disconnect();
  }
});
