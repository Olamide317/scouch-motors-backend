import { randomUUID } from "node:crypto";

const SANDBOX_URL = "https://api.sandbox.ninja.boucloud.io";

function requireSandboxSettings() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The Ninja sandbox client is disabled in production.");
  }

  const secretKey = process.env.NINJA_SANDBOX_SECRET_KEY;

  if (!secretKey?.startsWith("sk_sandbox_")) {
    throw new Error("Set a valid NINJA_SANDBOX_SECRET_KEY in your .env file.");
  }

  return secretKey;
}

async function ninjaSandboxRequest(
  path,
  { method = "GET", body, fetchImpl = fetch } = {},
) {
  const secretKey = requireSandboxSettings();

  const response = await fetchImpl(`${SANDBOX_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = new Error(
      `Ninja sandbox API returned HTTP ${response.status}.`,
    );

    error.httpStatus = response.status;

    throw error;
  }

  return response.json();
}

export async function createNinjaDemoLink({ fetchImpl } = {}) {
  const flowId = process.env.NINJA_SANDBOX_FLOW_ID;

  if (!/^vf_[a-zA-Z0-9_-]+$/.test(flowId ?? "")) {
    throw new Error("Set NINJA_SANDBOX_FLOW_ID to a valid sandbox flow ID.");
  }

  const customerRef = `demo-${randomUUID()}`;

  const result = await ninjaSandboxRequest(`/api/flows/${flowId}/links`, {
    method: "POST",
    body: {
      customer_name: "James Bond",
      customer_ref: customerRef,
      values: {
        first_name: "James",
        last_name: "Bond",
      },
    },
    fetchImpl,
  });

  if (
    result?.sandbox !== true ||
    typeof result.id !== "string" ||
    typeof result.url !== "string"
  ) {
    throw new Error("Ninja did not return a valid sandbox verification link.");
  }

  const url = new URL(result.url);

  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.ninja.ng" ||
    url.pathname !== "/kyc/"
  ) {
    throw new Error("Ninja returned an unexpected verification URL.");
  }

  return {
    verificationId: result.id,
    url: result.url,
    customerRef,
  };
}

export async function getNinjaDemoResult(verificationId, { fetchImpl } = {}) {
  if (!/^vs_[a-zA-Z0-9_-]+$/.test(verificationId ?? "")) {
    throw new Error("Invalid Ninja verification ID.");
  }

  const result = await ninjaSandboxRequest(
    `/api/verifications/${verificationId}`,
    { fetchImpl },
  );

  if (result?.sandbox !== true || result.id !== verificationId) {
    throw new Error("The result is not the expected sandbox verification.");
  }

  return {
    verificationId: result.id,
    status: result.status,
    outcome: result.outcome ?? null,
    sandbox: true,
  };
}

const SANDBOX_TEST_IDS = new Set([
  "77777777777", // Matching identity
  "55555555555", // Record not found
  "00000000000", // Simulated provider failure
]);

/**
 * Checks a synthetic NIN using Ninja's sandbox Verify API.
 *
 * INTERNAL DEMO USE ONLY.
 * Never use this function for production verification.
 *
 * A matching identity record does not prove that the
 * person submitting the details owns that identity.
 */
export async function verifyNinjaSandboxIdentity(
  {
    idNumber = "77777777777",
    firstName = "James",
    lastName = "Bond",
    dateOfBirth = "1975-01-01",
  } = {},
  { fetchImpl = fetch } = {},
) {
  if (!SANDBOX_TEST_IDS.has(idNumber)) {
    throw new Error("Only approved synthetic sandbox IDs are allowed.");
  }

  if (
    typeof firstName !== "string" ||
    !firstName.trim() ||
    typeof lastName !== "string" ||
    !lastName.trim() ||
    typeof dateOfBirth !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
  ) {
    throw new Error("Invalid synthetic identity details.");
  }

  const result = await ninjaSandboxRequest("/api/identity/identify", {
    method: "POST",
    body: {
      idType: "nin",
      mode: "verify",
      idNumber,
      firstName,
      lastName,
      dateOfBirth,
    },
    fetchImpl,
  });

  if (
    typeof result?.found !== "boolean" ||
    typeof result?.verified !== "boolean"
  ) {
    throw new Error("Unexpected Ninja verification response.");
  }

  if (
    result.verified &&
    (!result.found || result.recommendation !== "accept")
  ) {
    throw new Error("Inconsistent Ninja verification verdict.");
  }

  if (
    result.score != null &&
    (typeof result.score !== "number" ||
      !Number.isFinite(result.score) ||
      result.score < 0 ||
      result.score > 1)
  ) {
    throw new Error("Invalid Ninja match score.");
  }

  const fieldMatches = Array.isArray(result.fields)
    ? result.fields
        .filter(
          (field) =>
            ["first_name", "last_name", "date_of_birth"].includes(
              field.field,
            ) && typeof field.match === "string",
        )
        .map(({ field, match }) => ({ field, match }))
    : [];

  return {
    provider: "ninja",
    sandbox: true,
    method: "nin",

    found: result.found,
    verified: result.verified,

    score: result.score ?? null,
    recommendation: result.recommendation ?? null,

    fieldMatches,

    identityHolderAuthenticated: false,
    eligibleForCheckout: false,
  };
}
