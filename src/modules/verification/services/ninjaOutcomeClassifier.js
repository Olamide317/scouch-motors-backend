/**
 * Classifies Ninja sandbox verification responses.
 *
 * This module is intentionally pure:
 * - No database operations
 * - No attempt-counter mutations
 * - No checkout authorization
 *
 * Sandbox results cannot establish production identity.
 */

const REQUIRED_FIELDS = [
  "first_name",
  "last_name",
  "date_of_birth",
];

function createOutcome({
  status,
  reason,
  retryable = false,
  requiresReview = false,
}) {
  return {
    status,
    reason,
    retryable,
    requiresReview,

    // Our existing policy requires an explicit
    // incorrect-credentials outcome before an
    // incorrect submission can be consumed.
    consumeIncorrectAttempt: false,

    // Sandbox outcomes never authorize checkout.
    eligibleForCheckout: false,
  };
}

export function classifyNinjaSandboxOutcome(input) {
  // 1. Handle technical failures.

  if (input instanceof Error) {
    const httpStatus = input.httpStatus;

    return createOutcome({
      status: "technical_failure",
      reason: "provider_request_failed",
      retryable:
        httpStatus == null ||
        httpStatus === 429 ||
        httpStatus >= 500,
    });
  }

  // 2. Validate the provider and environment.

  if (
    !input ||
    input.provider !== "ninja" ||
    input.sandbox !== true ||
    input.method !== "nin"
  ) {
    throw new Error(
      "Invalid Ninja sandbox response."
    );
  }

  if (
    typeof input.found !== "boolean" ||
    typeof input.verified !== "boolean" ||
    !Array.isArray(input.fieldMatches)
  ) {
    throw new Error(
      "Incomplete Ninja verification response."
    );
  }

  // 3. Validate field-match evidence.

  const validFields = input.fieldMatches.every(
    (item) =>
      REQUIRED_FIELDS.includes(item.field) &&
      ["exact", "mismatch"].includes(item.match)
  );

  if (!validFields) {
    throw new Error(
      "Invalid identity field-match evidence."
    );
  }

  const hasMismatch = input.fieldMatches.some(
    (item) => item.match === "mismatch"
  );

  const allExact = REQUIRED_FIELDS.every(
    (field) =>
      input.fieldMatches.some(
        (item) =>
          item.field === field &&
          item.match === "exact"
      )
  );

  // 4. Reject contradictory provider outcomes.

  if (
    (input.verified && !input.found) ||
    (input.verified && !allExact) ||
    (!input.verified &&
      input.recommendation === "accept")
  ) {
    throw new Error(
      "Inconsistent Ninja verification verdict."
    );
  }

  // 5. Successful synthetic identity match.

  if (
    input.found &&
    input.verified &&
    input.recommendation === "accept"
  ) {
    return createOutcome({
      status: "simulated_match",
      reason: "sandbox_identity_matched",
    });
  }

  // 6. Identity record not found.

  if (!input.found) {
    return createOutcome({
      status: "not_found",
      reason: "identity_record_not_found",
      requiresReview: true,
    });
  }

  // 7. Official record found, but names mismatch.

  if (hasMismatch) {
    return createOutcome({
      status: "requires_review",
      reason: "identity_name_mismatch",
      requiresReview: true,
    });
  }

  // 8. Other unverified outcomes.
  // Do not guess that these represent incorrect
  // credentials without explicit trusted evidence.

  return createOutcome({
    status: "requires_review",
    reason: "provider_rejected_or_unresolved",
    requiresReview: true,
  });
}