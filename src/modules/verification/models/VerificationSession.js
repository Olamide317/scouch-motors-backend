import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const { Schema } = mongoose;

// Sessions in these states are considered ongoing.
// We will not allow multiple ongoing sessions
// within the same verification cycle.
const activeStatuses = [
  "created",
  "pending",
  "processing",
  "reconciling",
];

const verificationSessionSchema = new Schema(
  {
    // Customer who owns this verification session
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Verification cycle associated with this session
    cycle: {
      type: Schema.Types.ObjectId,
      ref: "VerificationCycle",
      required: true,
    },

    // Optional booking that initiated verification
    initiatedForBooking: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },

    // Verification method selected by the customer
    method: {
      type: String,
      enum: ["nin", "drivers_licence"],
      required: true,
    },

    // Name of the provider selected by our backend
    provider: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    // Our internal unique session identifier
    sessionKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => randomUUID(),
    },

    // Opaque reference returned by the provider.
    // Never store the actual identity number here.
    providerReference: {
      type: String,
      trim: true,
      default: null,
    },

    // Current verification session status
    status: {
      type: String,
      enum: [
        // Normal verification lifecycle
        "created",
        "pending",
        "processing",
        "reconciling",

        // Genuine verification outcomes
        "succeeded",
        "incorrect_credentials",
        "name_mismatch",
        "technical_failure",

        // Sandbox-only outcomes
        // These must never grant real checkout eligibility.
        "sandbox_matched",
        "sandbox_mismatch",
        "sandbox_not_found",
        "sandbox_review",
        "sandbox_error",

        // Other terminal states
        "expired",
        "cancelled",
        "recovery_exhausted",
      ],
      default: "created",
    },

    // Provider-specific customer consent
    consentVersion: {
      type: String,
      trim: true,
      default: null,
    },

    consentedAt: {
      type: Date,
      default: null,
    },

    consentWithdrawnAt: {
      type: Date,
      default: null,
    },

    // Account identity snapshot when session starts
    identityRevisionAtStart: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    accountLifecycleRevisionAtStart: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    // When the provider-hosted session expires
    expiresAt: {
      type: Date,
      default: null,
    },

    // Time until which technical recovery is allowed
    recoveryDeadlineAt: {
      type: Date,
      default: null,
    },

    // Next scheduled provider status reconciliation
    nextRecoveryAt: {
      type: Date,
      default: null,
    },

    // Technical reconciliation attempts, not
    // incorrect identity submissions
    recoveryChecks: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastReconciledAt: {
      type: Date,
      default: null,
    },

    // Protects against counting the same incorrect
    // submission more than once
    incorrectAttemptCounted: {
      type: Boolean,
      default: false,
    },

    // Last authenticated provider event processed
    lastProviderEventAt: {
      type: Date,
      default: null,
    },

    // When a session reached its final outcome
    completedAt: {
      type: Date,
      default: null,
    },

    // Used for concurrency-safe state transitions
    stateVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

// Basic consistency checks
verificationSessionSchema.pre("validate", function () {
  if (this.consentWithdrawnAt && !this.consentedAt) {
    this.invalidate(
      "consentWithdrawnAt",
      "Consent cannot be withdrawn before it is given",
    );
  }

  if (
    this.consentWithdrawnAt &&
    this.consentedAt &&
    this.consentWithdrawnAt < this.consentedAt
  ) {
    this.invalidate(
      "consentWithdrawnAt",
      "Consent withdrawal date is invalid",
    );
  }

  if (
    this.status === "succeeded" &&
    (!this.providerReference ||
      !this.consentedAt ||
      this.consentWithdrawnAt)
  ) {
    this.invalidate(
      "status",
      "Successful sessions require a provider reference and valid consent",
    );
  }

  if (
    this.recoveryDeadlineAt &&
    this.nextRecoveryAt &&
    this.nextRecoveryAt > this.recoveryDeadlineAt
  ) {
    this.invalidate(
      "nextRecoveryAt",
      "Next recovery check cannot exceed the recovery deadline",
    );
  }
});

// Prevent multiple ongoing provider sessions
// for the same verification cycle.
verificationSessionSchema.index(
  { cycle: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: activeStatuses },
    },
  },
);

// Prevent duplicate provider session references.
// References may only be unique within each provider.
verificationSessionSchema.index(
  {
    provider: 1,
    providerReference: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      providerReference: { $type: "string" },
    },
  },
);

// Retrieve a customer's verification history
verificationSessionSchema.index({
  user: 1,
  createdAt: -1,
});

// Retrieve sessions belonging to a cycle
verificationSessionSchema.index({
  cycle: 1,
  createdAt: -1,
});

// Efficiently find sessions requiring reconciliation
verificationSessionSchema.index({
  status: 1,
  nextRecoveryAt: 1,
});

const VerificationSession = mongoose.model(
  "VerificationSession",
  verificationSessionSchema,
);

export default VerificationSession;