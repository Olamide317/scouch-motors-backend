import "dotenv/config";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import IdentityVerification from "./src/modules/verification/models/IdentityVerification.js";
import VerificationCycle from "./src/modules/verification/models/VerificationCycle.js";
import VerificationSession from "./src/modules/verification/models/VerificationSession.js";
import VerificationReview from "./src/modules/verification/models/VerificationReview.js";
import VerificationAuditEvent from "./src/modules/verification/models/VerificationAuditEvent.js";

const TEST_DATABASE = "scouch_motors_verification_test_v2";

async function runTests() {
  let session;

  try {
    // Safety: never execute in production mode.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Verification database tests cannot run in production"
      );
    }

    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not configured");
    }

    // Explicitly connect to a separate test database.
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: TEST_DATABASE,
      serverSelectionTimeoutMS: 10000,
    });

    assert.equal(
      mongoose.connection.name,
      TEST_DATABASE,
      "Connected to an unexpected database"
    );

    console.log("Connected to isolated test database");

    // TEST 1: Build all five model indexes.
    const models = [
      IdentityVerification,
      VerificationCycle,
      VerificationSession,
      VerificationReview,
      VerificationAuditEvent,
    ];

    for (const Model of models) {
      await Model.init();
      console.log(`PASS: ${Model.modelName} initialized`);
    }

    // TEST 2: Verify that transactions can roll back
    // changes across multiple collections.

    const userId = new mongoose.Types.ObjectId();
    const cycleId = new mongoose.Types.ObjectId();
    const auditId = new mongoose.Types.ObjectId();

    session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await VerificationCycle.create(
          [
            {
              _id: cycleId,
              user: userId,
              purpose: "initial",
              status: "active",
            },
          ],
          { session }
        );

        await VerificationAuditEvent.create(
          [
            {
              _id: auditId,
              user: userId,
              cycle: cycleId,
              eventType: "cycle_started",
              actor: {
                type: "system",
              },
            },
          ],
          { session }
        );

        // Simulate an unexpected failure.
        throw new Error("EXPECTED_TEST_ROLLBACK");
      });
    } catch (error) {
      if (error.message !== "EXPECTED_TEST_ROLLBACK") {
        throw error;
      }
    }

    // Neither record should exist after rollback.
    const cycleExists = await VerificationCycle.exists({
      _id: cycleId,
    });

    const auditExists = await VerificationAuditEvent.exists({
      _id: auditId,
    });

    assert.equal(cycleExists, null);
    assert.equal(auditExists, null);

    console.log("PASS: MongoDB transaction rolled back");
    console.log("PASS: No partial verification records remain");

    console.log("All database foundation checks passed");
  } catch (error) {
    console.error("TEST FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    if (session) {
      await session.endSession();
    }

    await mongoose.disconnect();
  }
}

runTests();