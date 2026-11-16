import test from "node:test";
import assert from "node:assert/strict";

import {
  assertSessionTransition,
  assertCycleTransition,
  assertReviewTransition,
} from "../services/stateRules.js";

// ========================================
// VERIFICATION SESSION TESTS
// ========================================

// Test 1: Normal session progression
test("Session allows normal progression", () => {
  assert.equal(
    assertSessionTransition("created", "pending"),
    true
  );

  assert.equal(
    assertSessionTransition("pending", "processing"),
    true
  );
});

// Test 2: Session can enter reconciliation
test("Session allows technical reconciliation", () => {
  assert.equal(
    assertSessionTransition(
      "processing",
      "reconciling"
    ),
    true
  );
});

// Test 3: Allowed cancellation and expiry
test("Session allows permitted cancellation and expiry", () => {
  assert.equal(
    assertSessionTransition("created", "cancelled"),
    true
  );

  assert.equal(
    assertSessionTransition("pending", "expired"),
    true
  );
});

// Test 4: Ordinary transitions cannot declare
// successful or failed identity verification.
test("Session rejects direct provider outcomes", () => {
  const providerOutcomes = [
    "succeeded",
    "incorrect_credentials",
    "name_mismatch",
    "technical_failure",
  ];

  for (const outcome of providerOutcomes) {
    assert.throws(
      () => assertSessionTransition(
        "processing",
        outcome
      ),
      /Invalid VerificationSession transition/
    );
  }
});

// Test 5: Terminal states cannot be reopened
test("Session rejects transitions from terminal states", () => {
  assert.throws(
    () => assertSessionTransition(
      "succeeded",
      "pending"
    ),
    /Invalid VerificationSession transition/
  );

  assert.throws(
    () => assertSessionTransition(
      "cancelled",
      "processing"
    ),
    /Invalid VerificationSession transition/
  );
});

// Test 6: Unknown statuses must be rejected
test("Session rejects unknown statuses", () => {
  assert.throws(
    () => assertSessionTransition(
      "unknown",
      "pending"
    ),
    /Unknown VerificationSession status/
  );

  assert.throws(
    () => assertSessionTransition(
      "created",
      "approved"
    ),
    /Unknown target VerificationSession status/
  );
});

// Test 7: Repeated states aren't transitions
test("Session rejects unchanged status", () => {
  assert.throws(
    () => assertSessionTransition(
      "pending",
      "pending"
    ),
    /already pending/
  );
});

// ========================================
// VERIFICATION CYCLE TESTS
// ========================================

// Test 8: An active cycle can close normally
test("Cycle allows exhaustion or cancellation", () => {
  assert.equal(
    assertCycleTransition(
      "active",
      "exhausted"
    ),
    true
  );

  assert.equal(
    assertCycleTransition(
      "active",
      "cancelled"
    ),
    true
  );
});

// Test 9: Cycle success requires a trusted
// provider-result or manual verification process.
test("Cycle rejects direct verification success", () => {
  assert.throws(
    () => assertCycleTransition(
      "active",
      "verified"
    ),
    /Invalid VerificationCycle transition/
  );
});

// Test 10: Exhausted cycles cannot be reopened
// using the ordinary transition helper.
test("Cycle rejects reopening exhausted cycles", () => {
  assert.throws(
    () => assertCycleTransition(
      "exhausted",
      "active"
    ),
    /Invalid VerificationCycle transition/
  );
});

// ========================================
// VERIFICATION REVIEW TESTS
// ========================================

// Test 11: Normal administrative review workflow
test("Review allows normal progression", () => {
  assert.equal(
    assertReviewTransition(
      "open",
      "in_review"
    ),
    true
  );

  assert.equal(
    assertReviewTransition(
      "in_review",
      "resolved"
    ),
    true
  );
});

// Test 12: Reviews cannot bypass required stages
test("Review rejects invalid progression", () => {
  assert.throws(
    () => assertReviewTransition(
      "open",
      "resolved"
    ),
    /Invalid VerificationReview transition/
  );

  assert.throws(
    () => assertReviewTransition(
      "resolved",
      "in_review"
    ),
    /Invalid VerificationReview transition/
  );
});