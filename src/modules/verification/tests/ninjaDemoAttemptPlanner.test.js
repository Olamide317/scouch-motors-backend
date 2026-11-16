import test from "node:test";
import assert from "node:assert/strict";

import {
  planNinjaDemoAttempt,
} from "../services/ninjaDemoAttemptPlanner.js";

function createCycle(overrides = {}) {
  return {
    status: "active",
    maxIncorrectSubmissions: 3,
    incorrectAttemptsUsed: 1,
    extraAttemptsGranted: 0,
    ...overrides,
  };
}

const matchingResponse = {
  provider: "ninja",
  sandbox: true,
  method: "nin",
  found: true,
  verified: true,
  recommendation: "accept",
  fieldMatches: [
    { field: "first_name", match: "exact" },
    { field: "last_name", match: "exact" },
    { field: "date_of_birth", match: "exact" },
  ],
  identityHolderAuthenticated: false,
  eligibleForCheckout: false,
};

test("Sandbox match never authorizes checkout", () => {
  const result = planNinjaDemoAttempt({
    cycle: createCycle(),
    ninjaResponse: matchingResponse,
  });

  assert.equal(result.eligibleForCheckout, false);
  assert.equal(result.shouldMarkVerified, false);
  assert.equal(result.consumesAllowance, false);
  assert.equal(result.remainingAttempts, 2);
});

test("Name mismatch does not consume allowance", () => {
  const result = planNinjaDemoAttempt({
    cycle: createCycle(),
    ninjaResponse: {
      ...matchingResponse,
      verified: false,
      recommendation: "reject",
      fieldMatches: [
        { field: "first_name", match: "mismatch" },
        { field: "last_name", match: "mismatch" },
        { field: "date_of_birth", match: "exact" },
      ],
    },
  });

  assert.equal(result.policyOutcome, "name_mismatch");
  assert.equal(result.consumesAllowance, false);
  assert.equal(result.remainingAttempts, 2);
});

test("Technical failure does not consume allowance", () => {
  const error = new Error("Ninja unavailable");
  error.httpStatus = 503;

  const result = planNinjaDemoAttempt({
    cycle: createCycle(),
    ninjaResponse: error,
  });

  assert.equal(
    result.policyOutcome,
    "technical_failure"
  );

  assert.equal(result.consumesAllowance, false);
  assert.equal(result.remainingAttempts, 2);
});

test("Missing identity remains unresolved", () => {
  const result = planNinjaDemoAttempt({
    cycle: createCycle(),
    ninjaResponse: {
      ...matchingResponse,
      found: false,
      verified: false,
      recommendation: null,
      fieldMatches: [],
    },
  });

  assert.equal(result.classification.status, "not_found");
  assert.equal(result.policyOutcome, null);
  assert.equal(result.consumesAllowance, false);
});

test("Exhausted cycles cannot accept new attempts", () => {
  assert.throws(
    () => planNinjaDemoAttempt({
      cycle: createCycle({
        status: "exhausted",
        incorrectAttemptsUsed: 3,
      }),
      ninjaResponse: matchingResponse,
    }),
    /does not permit another attempt/
  );
});

test("The planner does not mutate the cycle", () => {
  const cycle = createCycle();

  planNinjaDemoAttempt({
    cycle,
    ninjaResponse: matchingResponse,
  });

  assert.equal(cycle.incorrectAttemptsUsed, 1);
  assert.equal(cycle.status, "active");
});