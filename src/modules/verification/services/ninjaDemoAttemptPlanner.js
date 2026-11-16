import {
  classifyNinjaSandboxOutcome,
} from "./ninjaOutcomeClassifier.js";

import {
  assessCycleAttemptCapacity,
  planAttemptOutcome,
} from "./attemptPolicy.js";

/**
 * Plans how a Ninja sandbox result affects
 * an existing verification cycle.
 *
 * PURE SERVICE:
 * - Does not write to MongoDB
 * - Does not create provider sessions
 * - Does not mark accounts as verified
 * - Never authorizes real checkout
 */
export function planNinjaDemoAttempt({
  cycle,
  ninjaResponse,
}) {
  // Step 1: Check cycle capacity.
  const capacity = assessCycleAttemptCapacity(cycle);

  if (!capacity.canAttempt) {
    throw new Error(
      "Verification cycle does not permit another attempt"
    );
  }

  // Step 2: Classify Ninja's response.
  const classification =
    classifyNinjaSandboxOutcome(ninjaResponse);

  // Step 3: Fail closed if the sandbox result
  // unexpectedly attempts to authorize checkout
  // or consume an incorrect-credential allowance.
  if (
    classification.eligibleForCheckout !== false ||
    classification.consumeIncorrectAttempt !== false
  ) {
    throw new Error(
      "Unsafe Ninja sandbox classification"
    );
  }

  // Step 4: Map recognized classifications
  // to our existing attempt-policy outcomes.
  let policyOutcome = null;

  if (classification.status === "technical_failure") {
    policyOutcome = "technical_failure";
  } else if (
    classification.status === "requires_review" &&
    classification.reason === "identity_name_mismatch"
  ) {
    policyOutcome = "name_mismatch";
  }

  // Step 5: Calculate the attempt-policy effect.
  // Unknown/unresolved cases must not be
  // misclassified as incorrect credentials.
  const attemptPlan = policyOutcome
    ? planAttemptOutcome({
        cycle,
        outcome: policyOutcome,
      })
    : null;

  // Step 6: Return the plan only.
  return {
    classification,
    policyOutcome,
    attemptPlan,

    remainingAttempts:
      attemptPlan?.remainingAttempts ??
      capacity.remainingAttempts,

    consumesAllowance:
      attemptPlan?.consumesAllowance ?? false,

    sandbox: true,
    eligibleForCheckout: false,
    shouldMarkVerified: false,
  };
}