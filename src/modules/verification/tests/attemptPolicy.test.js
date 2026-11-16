import test from "node:test";
import assert from "node:assert/strict";

import {
  assessCycleAttemptCapacity,
  planAttemptOutcome,
} from "../services/attemptPolicy.js";

const createCycle = (overrides = {}) => ({
  status: "active",
  maxIncorrectSubmissions: 3,
  incorrectAttemptsUsed: 0,
  extraAttemptsGranted: 0,
  ...overrides,
});

test("New cycle permits three incorrect submissions", () => {
  const result = assessCycleAttemptCapacity(createCycle());

  assert.equal(result.canAttempt, true);
  assert.equal(result.remainingAttempts, 3);
});

test("Previous incorrect submissions reduce remaining allowance", () => {
  const result = assessCycleAttemptCapacity(
    createCycle({ incorrectAttemptsUsed: 2 })
  );

  assert.equal(result.remainingAttempts, 1);
});

test("Final incorrect submission exhausts cycle", () => {
  const result = planAttemptOutcome({
    cycle: createCycle({ incorrectAttemptsUsed: 2 }),
    outcome: "incorrect_credentials",
  });

  assert.equal(result.consumesAllowance, true);
  assert.equal(result.nextIncorrectAttemptsUsed, 3);
  assert.equal(result.remainingAttempts, 0);
  assert.equal(result.nextCycleStatus, "exhausted");
});

test("Technical failure does not consume allowance", () => {
  const result = planAttemptOutcome({
    cycle: createCycle({ incorrectAttemptsUsed: 1 }),
    outcome: "technical_failure",
  });

  assert.equal(result.consumesAllowance, false);
  assert.equal(result.nextIncorrectAttemptsUsed, 1);
  assert.equal(result.nextCycleStatus, "active");
});

test("Name mismatch does not consume incorrect-credential allowance", () => {
  const result = planAttemptOutcome({
    cycle: createCycle({ incorrectAttemptsUsed: 1 }),
    outcome: "name_mismatch",
  });

  assert.equal(result.nextIncorrectAttemptsUsed, 1);
});

test("Exhausted cycle cannot accept another attempt", () => {
  const cycle = createCycle({
    status: "exhausted",
    incorrectAttemptsUsed: 3,
  });

  assert.equal(
    assessCycleAttemptCapacity(cycle).canAttempt,
    false
  );

  assert.throws(() => {
    planAttemptOutcome({
      cycle,
      outcome: "incorrect_credentials",
    });
  });
});

test("Existing authorized extra allowance is calculated correctly", () => {
  const cycle = createCycle({
    incorrectAttemptsUsed: 3,
    extraAttemptsGranted: 1,
  });

  const result = assessCycleAttemptCapacity(cycle);

  assert.equal(result.totalAllowance, 4);
  assert.equal(result.remainingAttempts, 1);
});

test("Unsupported outcomes are rejected", () => {
  assert.throws(() => {
    planAttemptOutcome({
      cycle: createCycle(),
      outcome: "succeeded",
    });
  }, /Unsupported attempt outcome/);
});

test("Invalid counters are rejected", () => {
  assert.throws(() => {
    assessCycleAttemptCapacity(
      createCycle({ incorrectAttemptsUsed: -1 })
    );
  });
});

test("Attempt planning does not mutate the original cycle", () => {
  const cycle = createCycle({ incorrectAttemptsUsed: 1 });

  planAttemptOutcome({
    cycle,
    outcome: "incorrect_credentials",
  });

  assert.equal(cycle.incorrectAttemptsUsed, 1);
  assert.equal(cycle.status, "active");
});

test("Verified cycles cannot accept further attempts", () => {
  const cycle = createCycle({
    status: "verified",
  });

  const result = assessCycleAttemptCapacity(cycle);

  assert.equal(result.canAttempt, false);
  assert.equal(result.reason, "cycle_not_active");

  assert.throws(() => {
    planAttemptOutcome({
      cycle,
      outcome: "incorrect_credentials",
    });
  });
});