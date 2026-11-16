import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyNinjaSandboxOutcome,
} from "../services/ninjaOutcomeClassifier.js";

const matchingResponse = {
  provider: "ninja",
  sandbox: true,
  method: "nin",
  found: true,
  verified: true,
  score: 1,
  recommendation: "accept",
  fieldMatches: [
    { field: "first_name", match: "exact" },
    { field: "last_name", match: "exact" },
    { field: "date_of_birth", match: "exact" },
  ],
  identityHolderAuthenticated: false,
  eligibleForCheckout: false,
};

test("Matching sandbox identity is simulated only", () => {
  const result = classifyNinjaSandboxOutcome(
    matchingResponse
  );

  assert.equal(result.status, "simulated_match");
  assert.equal(result.eligibleForCheckout, false);
  assert.equal(result.consumeIncorrectAttempt, false);
});

test("Name mismatch requires review", () => {
  const response = {
    ...matchingResponse,
    verified: false,
    recommendation: "reject",
    score: 0,
    fieldMatches: [
      { field: "first_name", match: "mismatch" },
      { field: "last_name", match: "mismatch" },
      { field: "date_of_birth", match: "exact" },
    ],
  };

  const result = classifyNinjaSandboxOutcome(response);

  assert.equal(result.status, "requires_review");
  assert.equal(result.reason, "identity_name_mismatch");
  assert.equal(result.consumeIncorrectAttempt, false);
});

test("Missing identity record is distinguished", () => {
  const response = {
    ...matchingResponse,
    found: false,
    verified: false,
    score: null,
    recommendation: null,
    fieldMatches: [],
  };

  const result = classifyNinjaSandboxOutcome(response);

  assert.equal(result.status, "not_found");
  assert.equal(result.consumeIncorrectAttempt, false);
});

test("Provider HTTP 503 is retryable", () => {
  const error = new Error("Provider unavailable");
  error.httpStatus = 503;

  const result = classifyNinjaSandboxOutcome(error);

  assert.equal(result.status, "technical_failure");
  assert.equal(result.retryable, true);
  assert.equal(result.consumeIncorrectAttempt, false);
});

test("Network failures do not consume attempts", () => {
  const result = classifyNinjaSandboxOutcome(
    new Error("Network failure")
  );

  assert.equal(result.status, "technical_failure");
  assert.equal(result.consumeIncorrectAttempt, false);
});

test("Contradictory success evidence is rejected", () => {
  assert.throws(
    () =>
      classifyNinjaSandboxOutcome({
        ...matchingResponse,
        found: false,
      }),
    /Inconsistent Ninja/
  );
});

test("Production-labelled responses are rejected", () => {
  assert.throws(
    () =>
      classifyNinjaSandboxOutcome({
        ...matchingResponse,
        sandbox: false,
      }),
    /Invalid Ninja sandbox/
  );
});

test("Malformed responses are rejected", () => {
  assert.throws(
    () => classifyNinjaSandboxOutcome({}),
    /Invalid Ninja sandbox/
  );
});