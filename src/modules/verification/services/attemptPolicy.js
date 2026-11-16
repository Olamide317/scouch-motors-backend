const VALID_CYCLE_STATUSES = new Set([
  "active",
  "verified",
  "exhausted",
  "cancelled",
]);


const COUNTABLE_OUTCOMES = new Set([
  "incorrect_credentials",
  "name_mismatch",
  "technical_failure",
]);

export function assessCycleAttemptCapacity(cycle) {
  if (!cycle || typeof cycle !== "object") {
    throw new Error("A verification cycle is required");
  }

  const {
    status,
    maxIncorrectSubmissions,
    incorrectAttemptsUsed,
    extraAttemptsGranted = 0,
  } = cycle;

  if (!VALID_CYCLE_STATUSES.has(status)) {
    throw new Error("Invalid verification cycle status");
  }

  if (![2, 3].includes(maxIncorrectSubmissions)) {
    throw new Error("Invalid incorrect-submission limit");
  }

  if (
    !Number.isSafeInteger(incorrectAttemptsUsed) ||
    incorrectAttemptsUsed < 0 ||
    !Number.isSafeInteger(extraAttemptsGranted) ||
    extraAttemptsGranted < 0
  ) {
    throw new Error("Invalid verification attempt counters");
  }

  const totalAllowance =
    maxIncorrectSubmissions + extraAttemptsGranted;

  if (
    !Number.isSafeInteger(totalAllowance) ||
    incorrectAttemptsUsed > totalAllowance
  ) {
    throw new Error("Verification attempt counters are inconsistent");
  }

  const remainingAttempts =
    totalAllowance - incorrectAttemptsUsed;

  const canAttempt =
    status === "active" && remainingAttempts > 0;

  return {
    canAttempt,
    totalAllowance,
    remainingAttempts,
    reason:
      status !== "active"
        ? "cycle_not_active"
        : remainingAttempts === 0
          ? "attempt_limit_reached"
          : "allowed",
  };
}

/**
 * Plans the accounting change after a trusted provider outcome.
 *
 * This is a pure calculation. It does not update MongoDB,
 * authenticate a provider, or authorize an administrator.
 *
 * Only a trusted outcome-finalization service may call this
 * after verifying and deduplicating the provider event.
 */
export function planAttemptOutcome({ cycle, outcome }) {
  if (!COUNTABLE_OUTCOMES.has(outcome)) {
    throw new Error("Unsupported attempt outcome");
  }

  const capacity = assessCycleAttemptCapacity(cycle);

  if (!capacity.canAttempt) {
    throw new Error("Verification cycle cannot accept another attempt");
  }

  const consumesAllowance =
    outcome === "incorrect_credentials";

  const nextIncorrectAttemptsUsed =
    cycle.incorrectAttemptsUsed +
    (consumesAllowance ? 1 : 0);

  const remainingAttempts =
    capacity.totalAllowance - nextIncorrectAttemptsUsed;

  const nextCycleStatus =
    consumesAllowance && remainingAttempts === 0
      ? "exhausted"
      : "active";

  return {
    consumesAllowance,
    nextIncorrectAttemptsUsed,
    remainingAttempts,
    nextCycleStatus,
  };
}