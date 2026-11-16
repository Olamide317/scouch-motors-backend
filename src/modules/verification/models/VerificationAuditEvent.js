import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const { Schema } = mongoose;

// Important actions that our verification system
// is allowed to record.
const auditEventTypes = [
  "cycle_started",
  "session_created",
  "session_status_changed",
  "consent_recorded",
  "consent_withdrawn",
  "attempt_counted",
  "attempt_override_granted",
  "provider_failover",
  "recovery_exhausted",
  "provider_result_rejected",
  "verification_completed",
  "verification_renewed",
  "verification_suspended",
  "verification_restored",
  "verification_revoked",
  "review_opened",
  "review_updated",
  "review_resolved",
  "manual_verification_approved",
  "booking_waiver_granted",
  "booking_waiver_revoked",
  "account_lifecycle_changed",
  "verification_policy_updated",
  "verification_record_deleted",
  "sandbox_result_recorded",
];

// Actions that require an administrator.
// Authorization must also be enforced in services.
const adminOnlyEvents = [
  "attempt_override_granted",
  "verification_restored",
  "review_resolved",
  "manual_verification_approved",
  "booking_waiver_granted",
  "booking_waiver_revoked",
  "verification_policy_updated",
  "verification_record_deleted",
];

// Who performed the recorded action?
const actorSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["customer", "admin", "system", "provider"],
      required: true,
    },

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    provider: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
  },
  { _id: false }
);

// Only approved, non-sensitive details belong
// in an audit record.
const auditDetailsSchema = new Schema(
  {
    previousStatus: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },

    nextStatus: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },

    reasonCode: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },

    policyVersion: {
      type: Number,
      min: 1,
      default: null,
    },

    identityRevision: {
      type: Number,
      min: 0,
      default: null,
    },

    accountLifecycleRevision: {
      type: Number,
      min: 0,
      default: null,
    },
  },
  {
    _id: false,
    strict: "throw",
  }
);

const verificationAuditEventSchema = new Schema(
  {
    // Unique identity of this audit event
    eventKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => randomUUID(),
    },

    // What happened?
    eventType: {
      type: String,
      enum: auditEventTypes,
      required: true,
      immutable: true,
    },

    // Customer whose verification was affected.
    // Null is allowed for global policy changes.
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },

    // Who performed the action?
    actor: {
      type: actorSchema,
      required: true,
      immutable: true,
    },

    // Optional references to affected records
    verification: {
      type: Schema.Types.ObjectId,
      ref: "IdentityVerification",
      default: null,
    },

    cycle: {
      type: Schema.Types.ObjectId,
      ref: "VerificationCycle",
      default: null,
    },

    session: {
      type: Schema.Types.ObjectId,
      ref: "VerificationSession",
      default: null,
    },

    review: {
      type: Schema.Types.ObjectId,
      ref: "VerificationReview",
      default: null,
    },

    booking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },

    // Internal identifier for correlating related
    // operations, not a customer's identity number.
    operationId: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },

    // Whitelisted metadata only.
    // Never store raw identity-provider responses.
    details: {
      type: auditDetailsSchema,
      default: () => ({}),
    },

    // Time the event was recorded.
    occurredAt: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
    strict: "throw",
  }
);

// Validate basic audit-event consistency.
verificationAuditEventSchema.pre(
  "validate",
  function () {
    const actor = this.actor;

    if (!actor) {
      this.invalidate(
        "actor",
        "An audit actor is required"
      );
      return;
    }

    // Customer and admin actions must identify
    // the authenticated user who performed them.
    if (
      ["customer", "admin"].includes(actor.type) &&
      !actor.user
    ) {
      this.invalidate(
        "actor.user",
        "Customer and admin events require an actor user"
      );
    }

    // Provider actions must identify the provider.
    if (
      actor.type === "provider" &&
      !actor.provider
    ) {
      this.invalidate(
        "actor.provider",
        "Provider events require a provider name"
      );
    }

    // Only global policy updates may omit the
    // affected customer reference.
    if (
      this.eventType !== "verification_policy_updated" &&
      !this.user
    ) {
      this.invalidate(
        "user",
        "An affected customer is required"
      );
    }

    // Sensitive administrative decisions must
    // identify an administrator.
    if (
      adminOnlyEvents.includes(this.eventType) &&
      actor.type !== "admin"
    ) {
      this.invalidate(
        "actor.type",
        "This audit event requires an administrator"
      );
    }

    if (
      this.eventType === "attempt_override_granted" &&
      !this.cycle
    ) {
      this.invalidate(
        "cycle",
        "Attempt overrides require a verification cycle"
      );
    }

    if (
      this.eventType === "manual_verification_approved" &&
      !this.review
    ) {
      this.invalidate(
        "review",
        "Manual verification approval requires a review"
      );
    }
  }
);

// Audit events must not be edited with document.save().
verificationAuditEventSchema.pre(
  "save",
  function () {
    if (!this.isNew) {
      throw new Error(
        "Verification audit events are append-only"
      );
    }
  }
);

// Reject ordinary Mongoose update operations.
// Controlled retention/deletion will be handled
// by a separate authorized service later.
verificationAuditEventSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
  ],
  function () {
    throw new Error(
      "Verification audit events cannot be updated"
    );
  }
);

// Customer audit history
verificationAuditEventSchema.index({
  user: 1,
  occurredAt: -1,
});

// Audit records belonging to a cycle
verificationAuditEventSchema.index({
  cycle: 1,
  occurredAt: -1,
});

// Administrative actions
verificationAuditEventSchema.index({
  "actor.user": 1,
  occurredAt: -1,
});

// Look up the event that caused a suspension
verificationAuditEventSchema.index({
  verification: 1,
  eventType: 1,
  occurredAt: -1,
});

// Trace related operations
verificationAuditEventSchema.index({
  operationId: 1,
  occurredAt: -1,
});

const VerificationAuditEvent = mongoose.model(
  "VerificationAuditEvent",
  verificationAuditEventSchema
);

export default VerificationAuditEvent;