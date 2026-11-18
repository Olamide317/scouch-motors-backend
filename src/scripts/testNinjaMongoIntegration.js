import "dotenv/config";

import mongoose from "mongoose";
import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import User from "../models/User.js";

import VerificationCycle from "../modules/verification/models/VerificationCycle.js";
import VerificationSession from "../modules/verification/models/VerificationSession.js";
import VerificationAuditEvent from "../modules/verification/models/VerificationAuditEvent.js";
import IdentityVerification from "../modules/verification/models/IdentityVerification.js";

import { runNinjaSandboxDemo } from "../modules/verification/services/ninjaSandboxFinalizationService.js";

// Each run gets a completely new database name.
const databaseName = `scouch_demo_ninja_${randomBytes(8).toString("hex")}`;

function validateEnvironment() {
  if (!["development", "test"].includes(process.env.NODE_ENV)) {
    throw new Error("Development or test mode is required");
  }

  if (process.env.ALLOW_NINJA_SANDBOX_DB_WRITES !== "true") {
    throw new Error("Sandbox database writes are disabled");
  }

  if (!process.env.MONGO_URI?.startsWith("mongodb")) {
    throw new Error("MONGO_URI is missing or invalid");
  }

  if (!process.env.NINJA_SANDBOX_SECRET_KEY?.startsWith("sk_sandbox_")) {
    throw new Error("A Ninja sandbox API key is required");
  }
}

async function prepareDatabase() {
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 15000,
  });

  // Never proceed if MongoDB connected to a different database.
  assert.equal(
    mongoose.connection.db.databaseName,
    databaseName,
    "Unexpected database selected",
  );

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });

  if (!hello.setName && hello.msg !== "isdbgrid") {
    throw new Error("MongoDB transactions require a replica set");
  }

  // Prepare collections and indexes before transactions.
  for (const Model of [
    User,
    VerificationCycle,
    VerificationSession,
    VerificationAuditEvent,
    IdentityVerification,
  ]) {
    await Model.createCollection();
    await Model.init();
  }
}

async function runTest() {
  validateEnvironment();

  console.log("Preparing isolated MongoDB test database...");

  await prepareDatabase();

  console.log("Database:", databaseName);

  // Fictional customer. No real NIN or personal data.
  const user = await User.create({
    firstName: "James",
    lastName: "Bond",
    email: `ninja-test-${randomUUID()}@example.test`,
    phone: "00000000000",
    password: randomUUID(),
    role: "customer",
    isActive: true,
  });

  const cycle = await VerificationCycle.create({
    user: user._id,
    purpose: "initial",
    status: "active",
    maxIncorrectSubmissions: 3,
    incorrectAttemptsUsed: 0,
    extraAttemptsGranted: 0,
    policyVersion: 1,
    identityRevisionAtStart: 0,
    accountLifecycleRevisionAtStart: 0,
  });

  // Synthetic consent for this controlled test only.
  // This is NOT a real customer's consent.
  const session = await VerificationSession.create({
    user: user._id,
    cycle: cycle._id,
    method: "nin",
    provider: "ninja",
    status: "created",
    consentVersion: "sandbox-test-v1",
    consentedAt: new Date(),
    identityRevisionAtStart: 0,
    accountLifecycleRevisionAtStart: 0,
  });

  console.log("Synthetic customer and verification records created.");

  // This function contacts Ninja's sandbox itself.
  const result = await runNinjaSandboxDemo({
    sessionId: String(session._id),
    scenario: "match",
  });

  assert.equal(result.status, "sandbox_matched");
  assert.equal(result.eligibleForCheckout, false);

  // Read back what MongoDB actually saved.
  const savedSession = await VerificationSession.findById(session._id);
  const savedCycle = await VerificationCycle.findById(cycle._id);

  const auditEvents = await VerificationAuditEvent.find({
    session: session._id,
    eventType: "sandbox_result_recorded",
  });

  const identityCount = await IdentityVerification.countDocuments({
    user: user._id,
  });

  assert.equal(savedSession.status, "sandbox_matched");
  assert.equal(savedSession.stateVersion, 1);
  assert.equal(savedCycle.status, "active");
  assert.equal(savedCycle.incorrectAttemptsUsed, 0);
  assert.equal(auditEvents.length, 1);
  assert.equal(identityCount, 0);

  console.log("Initial transaction passed.");

  // Test sequential duplicate finalization.
  const repeated = await runNinjaSandboxDemo({
    sessionId: String(session._id),
    scenario: "match",
  });

  assert.equal(repeated.alreadyFinalized, true);

  const finalAuditCount = await VerificationAuditEvent.countDocuments({
    session: session._id,
    eventType: "sandbox_result_recorded",
  });

  assert.equal(finalAuditCount, 1);

  // ==================================================
  // TEST 2: CONCURRENT FINALIZATION
  // ==================================================

  console.log("\nTesting concurrent finalization...");

  const concurrentSession = await VerificationSession.create({
    user: user._id,
    cycle: cycle._id,
    method: "nin",
    provider: "ninja",
    status: "created",
    consentVersion: "sandbox-test-v1",
    consentedAt: new Date(),
    identityRevisionAtStart: 0,
    accountLifecycleRevisionAtStart: 0,
  });

  const concurrentSessionId = String(concurrentSession._id);

  // Start two finalization requests simultaneously.
  const concurrentResults = await Promise.allSettled([
    runNinjaSandboxDemo({
      sessionId: concurrentSessionId,
      scenario: "match",
    }),
    runNinjaSandboxDemo({
      sessionId: concurrentSessionId,
      scenario: "match",
    }),
  ]);

  const successfulRequests = concurrentResults.filter(
    (result) => result.status === "fulfilled",
  );

  assert.ok(
    successfulRequests.length >= 1,
    "At least one finalization must succeed",
  );

  for (const result of successfulRequests) {
    assert.equal(result.value.status, "sandbox_matched");
    assert.equal(result.value.eligibleForCheckout, false);
  }

  for (const result of concurrentResults) {
    if (result.status === "rejected") {
      console.log("Concurrent request rejected:", result.reason?.message);
    }
  }

  const concurrentSavedSession =
    await VerificationSession.findById(concurrentSessionId);

  const concurrentAuditCount = await VerificationAuditEvent.countDocuments({
    session: concurrentSession._id,
    eventType: "sandbox_result_recorded",
  });

  assert.equal(concurrentSavedSession.status, "sandbox_matched");
  assert.equal(concurrentSavedSession.stateVersion, 1);
  assert.equal(concurrentAuditCount, 1);

  console.log("Concurrent finalization safety passed.");

  // ==================================================
  // TEST 3: TRANSACTION ROLLBACK
  // ==================================================

  console.log("\nTesting transaction rollback...");

  const rollbackSession = await VerificationSession.create({
    user: user._id,
    cycle: cycle._id,
    method: "nin",
    provider: "ninja",
    status: "created",
    consentVersion: "sandbox-test-v1",
    consentedAt: new Date(),
    identityRevisionAtStart: 0,
    accountLifecycleRevisionAtStart: 0,
  });

  // Reserve the exact event key the finalization
  // service would attempt to insert.
  //
  // This intentionally causes a duplicate-key error
  // when the transaction tries to save its audit event.

  const conflictingEventKey = createHash("sha256")
    .update(`ninja-sandbox-finalization:${rollbackSession._id}`)
    .digest("hex");

  await VerificationAuditEvent.create({
    eventKey: conflictingEventKey,
    eventType: "session_created",
    user: user._id,
    cycle: cycle._id,
    session: rollbackSession._id,
    actor: { type: "system" },
    details: {
      reasonCode: "ROLLBACK_TEST_CONFLICT",
    },
  });

  // The audit insert should fail.
  await assert.rejects(
    () =>
      runNinjaSandboxDemo({
        sessionId: String(rollbackSession._id),
        scenario: "match",
      }),
    (error) => {
      assert.equal(error.code, 11000, "Expected MongoDB duplicate-key error");
      return true;
    },
  );

  // Despite the attempted session update,
  // the database must retain its original state.

  const rolledBackSession = await VerificationSession.findById(
    rollbackSession._id,
  );

  const rolledBackCycle = await VerificationCycle.findById(cycle._id);

  const rollbackAuditCount = await VerificationAuditEvent.countDocuments({
    session: rollbackSession._id,
    eventType: "sandbox_result_recorded",
  });

  assert.equal(rolledBackSession.status, "created");
  assert.equal(rolledBackSession.stateVersion, 0);
  assert.equal(rolledBackCycle.status, "active");
  assert.equal(rolledBackCycle.incorrectAttemptsUsed, 0);
  assert.equal(rollbackAuditCount, 0);

  console.log("Transaction rollback safety passed.");

  // ==================================================
  // TEST 4: WITHDRAWN CONSENT
  // ==================================================

  console.log("\nTesting withdrawn consent...");

  await VerificationSession.updateOne(
    { _id: rollbackSession._id },
    {
      $set: {
        consentWithdrawnAt: new Date(),
      },
    }
  );

  try {
    await assert.rejects(
      () =>
        runNinjaSandboxDemo({
          sessionId: String(rollbackSession._id),
          scenario: "match",
        }),
      /Valid verification consent is required/
    );
  } finally {
    // Restore the synthetic test fixture.
    await VerificationSession.updateOne(
      { _id: rollbackSession._id },
      { $set: { consentWithdrawnAt: null } }
    );
  }

  console.log("Withdrawn consent correctly rejected.");

  // ==================================================
  // TEST 5: INACTIVE CUSTOMER ACCOUNT
  // ==================================================

  console.log("\nTesting inactive customer account...");

  await User.updateOne(
    { _id: user._id },
    { $set: { isActive: false } }
  );

  try {
    await assert.rejects(
      () =>
        runNinjaSandboxDemo({
          sessionId: String(rollbackSession._id),
          scenario: "match",
        }),
      /Customer account is unavailable/
    );
  } finally {
    // Restore the synthetic test fixture.
    await User.updateOne(
      { _id: user._id },
      { $set: { isActive: true } }
    );
  }

  const sessionAfterRejections =
    await VerificationSession.findById(rollbackSession._id);

  const rejectedAttemptAuditCount =
    await VerificationAuditEvent.countDocuments({
      session: rollbackSession._id,
      eventType: "sandbox_result_recorded",
    });

  assert.equal(sessionAfterRejections.status, "created");
  assert.equal(sessionAfterRejections.stateVersion, 0);
  assert.equal(rejectedAttemptAuditCount, 0);

  console.log("Inactive account correctly rejected.");
  console.log("Rejected attempts left no finalization records.");

  console.log("\n=== TEST RESULTS ===");
  console.log("Session:", savedSession.status);
  console.log("Cycle:", savedCycle.status);
  console.log("Incorrect attempts:", savedCycle.incorrectAttemptsUsed);
  console.log("Audit events:", finalAuditCount);
  console.log("Identity records:", identityCount);
  console.log("Duplicate prevented:", repeated.alreadyFinalized);
  console.log("Checkout eligible:", result.eligibleForCheckout);

  console.log("\nALL INTEGRATION ASSERTIONS PASSED");
}

try {
  await runTest();
} catch (error) {
  console.error("\nINTEGRATION TEST FAILED");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (mongoose.connection.readyState === 1) {
    console.log(
      "\nTest database retained for inspection:",
      mongoose.connection.db.databaseName,
    );
  }

  await mongoose.disconnect();
}
