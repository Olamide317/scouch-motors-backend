import test from "node:test";
import assert from "node:assert/strict";

import {
  mapNinjaSandboxTerminalStatus,
} from "../services/ninjaSandboxFinalizationService.js";

import VerificationSession from "../models/VerificationSession.js";
import VerificationAuditEvent from "../models/VerificationAuditEvent.js";

test("Sandbox match maps to a nonproduction status", () => {
  assert.equal(
    mapNinjaSandboxTerminalStatus({
      status: "simulated_match",
    }),
    "sandbox_matched"
  );
});

test("Name mismatch maps to sandbox_mismatch", () => {
  assert.equal(
    mapNinjaSandboxTerminalStatus({
      status: "requires_review",
      reason: "identity_name_mismatch",
    }),
    "sandbox_mismatch"
  );
});

test("Missing identity maps to sandbox_not_found", () => {
  assert.equal(
    mapNinjaSandboxTerminalStatus({
      status: "not_found",
    }),
    "sandbox_not_found"
  );
});

test("Technical failure maps to sandbox_error", () => {
  assert.equal(
    mapNinjaSandboxTerminalStatus({
      status: "technical_failure",
    }),
    "sandbox_error"
  );
});

test("Other unresolved outcomes require review", () => {
  assert.equal(
    mapNinjaSandboxTerminalStatus({
      status: "requires_review",
      reason: "provider_rejected_or_unresolved",
    }),
    "sandbox_review"
  );
});

test("Unknown outcomes are rejected", () => {
  assert.throws(
    () => mapNinjaSandboxTerminalStatus({
      status: "succeeded",
    }),
    /Unsupported sandbox outcome/
  );
});

test("Database schemas recognize sandbox events", () => {
  const sessionStatuses =
    VerificationSession.schema.path("status").enumValues;

  const auditEvents =
    VerificationAuditEvent.schema.path("eventType").enumValues;

  assert.ok(sessionStatuses.includes("sandbox_matched"));
  assert.ok(sessionStatuses.includes("sandbox_mismatch"));
  assert.ok(sessionStatuses.includes("sandbox_not_found"));
  assert.ok(sessionStatuses.includes("sandbox_review"));
  assert.ok(sessionStatuses.includes("sandbox_error"));

  assert.ok(auditEvents.includes("sandbox_result_recorded"));
});