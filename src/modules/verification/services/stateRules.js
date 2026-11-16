/**
 * Verification state rules
 *
 * This module defines structural lifecycle rules only.
 *
 * It does not:
 * - authenticate customers or administrators
 * - verify provider webhook signatures
 * - update MongoDB
 * - authorize provider identity results
 *
 * Those responsibilities belong to other services.
 */

// Ordinary verification-session transitions.
// Provider outcomes must be handled by a separate
// authenticated provider-result service.
const sessionTransitions = {
  created: [
    "pending",
    "reconciling",
    "cancelled",
  ],

  pending: [
    "processing",
    "reconciling",
    "expired",
    "cancelled",
  ],

  processing: [
    "reconciling",
  ],

  reconciling: [],

  // Terminal outcomes cannot be changed through
  // this ordinary lifecycle helper.
  succeeded: [],
  incorrect_credentials: [],
  name_mismatch: [],
  technical_failure: [],
  expired: [],
  cancelled: [],
  recovery_exhausted: [],
};

// Ordinary verification-cycle transitions.
// Success, exhausted-cycle reopening, and admin
// exceptions require separate trusted operations.
const cycleTransitions = {
  active: [
    "exhausted",
    "cancelled",
  ],

  verified: [],
  exhausted: [],
  cancelled: [],
};

// Administrative review workflow.
// These rules do not replace admin authorization.
const reviewTransitions = {
  open: [
    "in_review",
    "withdrawn",
  ],

  in_review: [
    "resolved",
    "withdrawn",
  ],

  resolved: [],
  withdrawn: [],
};

/**
 * Reusable validation helper.
 *
 * Checks whether a transition is structurally
 * allowed by the specified transition table.
 */
function assertTransition(
  transitions,
  currentStatus,
  nextStatus,
  entityName
) {
  const validStatuses = Object.keys(transitions);

  if (!validStatuses.includes(currentStatus)) {
    throw new Error(
      `Unknown ${entityName} status: ${currentStatus}`
    );
  }

  if (!validStatuses.includes(nextStatus)) {
    throw new Error(
      `Unknown target ${entityName} status: ${nextStatus}`
    );
  }

  if (currentStatus === nextStatus) {
    throw new Error(
      `${entityName} is already ${currentStatus}`
    );
  }

  const allowed = transitions[currentStatus];

  if (!allowed.includes(nextStatus)) {
    throw new Error(
      `Invalid ${entityName} transition: ` +
      `${currentStatus} -> ${nextStatus}`
    );
  }

  return true;
}

/**
 * Validate an ordinary session lifecycle change.
 *
 * Never use this helper to mark a provider
 * verification as succeeded or failed.
 */
export function assertSessionTransition(
  currentStatus,
  nextStatus
) {
  return assertTransition(
    sessionTransitions,
    currentStatus,
    nextStatus,
    "VerificationSession"
  );
}

/**
 * Validate an ordinary cycle lifecycle change.
 *
 * Provider-confirmed completion and administrative
 * attempt overrides require separate operations.
 */
export function assertCycleTransition(
  currentStatus,
  nextStatus
) {
  return assertTransition(
    cycleTransitions,
    currentStatus,
    nextStatus,
    "VerificationCycle"
  );
}

/**
 * Validate the review workflow structure.
 *
 * The calling service must separately check
 * permissions and required decision evidence.
 */
export function assertReviewTransition(
  currentStatus,
  nextStatus
) {
  return assertTransition(
    reviewTransitions,
    currentStatus,
    nextStatus,
    "VerificationReview"
  );
}