import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import IdentityVerification from "./src/modules/verification/models/IdentityVerification.js";
import VerificationCycle from "./src/modules/verification/models/VerificationCycle.js";
import VerificationSession from "./src/modules/verification/models/VerificationSession.js";
import VerificationReview from "./src/modules/verification/models/VerificationReview.js";
import VerificationAuditEvent from "./src/modules/verification/models/VerificationAuditEvent.js";

// Generate valid MongoDB ObjectIds for testing.
// We don't need actual database records yet.
const newId = () => new mongoose.Types.ObjectId();

// TEST 1: Provider verification requires evidence
test("IdentityVerification validates provider evidence", async () => {
  const verification = new IdentityVerification({
    user: newId(),
    method: "nin",
    source: "provider",
    session: newId(),
    provider: "mock_provider",
    providerReference: "test-reference-001",
    verifiedIdentityRevision: 0,
    verifiedAt: new Date("2026-11-01"),
    expiresAt: new Date("2027-11-01"),
  });

  await assert.rejects(
    verification.validate(),
    /Provider identity and holder authentication/
  );

  verification.providerEvidence = {
    surnameMatched: true,
    givenNameMatched: true,
    holderAuthenticated: true,
  };

  await verification.validate();
});

// TEST 2: Manual verification requires a review
test("Manual verification requires administrative review", async () => {
  const verification = new IdentityVerification({
    user: newId(),
    method: "nin",
    source: "admin_manual",
    verifiedIdentityRevision: 0,
    verifiedAt: new Date("2026-11-01"),
    expiresAt: new Date("2027-11-01"),
  });

  await assert.rejects(
    verification.validate(),
    /Manual verification requires an audited review/
  );

  verification.review = newId();

  await verification.validate();
});

// TEST 3: Incorrect submissions cannot exceed allowance
test("VerificationCycle enforces submission limits", async () => {
  const cycle = new VerificationCycle({
    user: newId(),
    purpose: "initial",
    maxIncorrectSubmissions: 3,
    incorrectAttemptsUsed: 4,
  });

  await assert.rejects(
    cycle.validate(),
    /Incorrect submissions cannot exceed/
  );

  cycle.incorrectAttemptsUsed = 3;

  await cycle.validate();
});

// TEST 4: Session success requires consent and reference
test("VerificationSession validates successful sessions", async () => {
  const session = new VerificationSession({
    user: newId(),
    cycle: newId(),
    method: "nin",
    provider: "mock_provider",
    status: "succeeded",
  });

  await assert.rejects(
    session.validate(),
    /Successful sessions require/
  );

  session.providerReference = "provider-session-001";
  session.consentedAt = new Date();
  session.consentVersion = "v1";

  await session.validate();
});

// TEST 5: Customer appeals require a suspension
test("VerificationReview validates customer appeals", async () => {
  const review = new VerificationReview({
    user: newId(),
    reviewType: "customer_appeal",
    origin: "customer",
    openedBy: newId(),
    customerStatement: "Please review my suspension.",
  });

  await assert.rejects(
    review.validate(),
    /Customer appeals require/
  );

  review.suspensionAuditEvent = newId();

  await review.validate();
});

// TEST 6: Resolved reviews require an admin decision
test("Resolved reviews require a decision", async () => {
  const review = new VerificationReview({
    user: newId(),
    reviewType: "admin_investigation",
    origin: "admin",
    openedBy: newId(),
    status: "resolved",
  });

  await assert.rejects(
    review.validate(),
    /Resolved reviews require/
  );

  review.resolution = {
    outcome: "resolved_no_change",
    decidedBy: newId(),
    decidedAt: new Date(),
  };

  await review.validate();
});

// TEST 7: Administrative audit events need an admin actor
test("VerificationAuditEvent validates admin actions", async () => {
  const event = new VerificationAuditEvent({
    user: newId(),
    cycle: newId(),
    eventType: "attempt_override_granted",
    actor: {
      type: "system",
    },
  });

  await assert.rejects(
    event.validate(),
    /requires an administrator/
  );

  event.actor = {
    type: "admin",
    user: newId(),
  };

  await event.validate();
});

// TEST 8: Confirm important unique indexes are declared
test("Verification models declare unique active-record indexes", () => {
  const cycleIndex = VerificationCycle.schema.indexes().find(
    ([fields, options]) =>
      fields.user === 1 &&
      options.partialFilterExpression?.status === "active"
  );

  assert.ok(cycleIndex, "Active cycle index is missing");
  assert.equal(cycleIndex[1].unique, true);

  const sessionIndex = VerificationSession.schema.indexes().find(
    ([fields, options]) =>
      fields.cycle === 1 &&
      options.partialFilterExpression?.status?.$in
        ?.includes("processing")
  );

  assert.ok(sessionIndex, "Active session index is missing");
  assert.equal(sessionIndex[1].unique, true);
});