import mongoose from "mongoose";

const { Schema } = mongoose;

const verificationCycleSchema = new Schema(
  {
    // Customer who owns this verification cycle
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Why the customer is verifying their identity
    purpose: {
      type: String,
      enum: [
        "initial",
        "voluntary_renewal",
        "required_reverification",
      ],
      required: true,
    },

    // Current lifecycle of this verification cycle
    status: {
      type: String,
      enum: [
        "active",
        "verified",
        "exhausted",
        "cancelled",
      ],
      default: "active",
    },

    // Maximum incorrect submissions allowed
    // Snapshot taken when the cycle is created
    maxIncorrectSubmissions: {
      type: Number,
      default: 3,
      min: 2,
      max: 3,
      validate: {
        validator: Number.isSafeInteger,
        message: "Submission limit must be a whole number",
      },
    },

    // Number of confirmed incorrect submissions
    incorrectAttemptsUsed: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "Attempt count must be a whole number",
      },
    },

    // Exceptional additional submissions authorized
    // by an administrator
    extraAttemptsGranted: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "Extra attempts must be a whole number",
      },
    },

    // Audit event for the latest administrator exception
    lastOverrideAuditEvent: {
      type: Schema.Types.ObjectId,
      ref: "VerificationAuditEvent",
      default: null,
    },

    // The configuration version used for this cycle
    policyVersion: {
      type: Number,
      default: 1,
      min: 1,
      validate: Number.isSafeInteger,
    },

    // Verification validity configuration captured
    // when the cycle starts
    validityMonthsSnapshot: {
      type: Number,
      default: 12,
      min: 1,
      validate: Number.isSafeInteger,
    },

    // Account identity revision at cycle creation
    identityRevisionAtStart: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    // Account lifecycle revision at cycle creation
    accountLifecycleRevisionAtStart: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    // Last time a confirmed incorrect submission
    // was recorded
    lastIncorrectAt: {
      type: Date,
      default: null,
    },

    // When the cycle finished
    closedAt: {
      type: Date,
      default: null,
    },

    // Used later for concurrency-safe updates
    stateVersion: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },
  },
  {
    timestamps: true,
  }
);

// Cross-field validation
verificationCycleSchema.pre("validate", function () {
  const totalAllowed =
    this.maxIncorrectSubmissions +
    this.extraAttemptsGranted;

  if (this.incorrectAttemptsUsed > totalAllowed) {
    this.invalidate(
      "incorrectAttemptsUsed",
      "Incorrect submissions cannot exceed the allowed total"
    );
  }

  if (
    this.extraAttemptsGranted > 0 &&
    !this.lastOverrideAuditEvent
  ) {
    this.invalidate(
      "lastOverrideAuditEvent",
      "Extra attempts require an administrative audit reference"
    );
  }
});

// A customer can have only one active cycle.
// Historical completed and exhausted cycles remain stored.
verificationCycleSchema.index(
  { user: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: "active",
    },
  }
);

// Efficient retrieval of verification history
verificationCycleSchema.index({
  user: 1,
  createdAt: -1,
});

const VerificationCycle = mongoose.model(
  "VerificationCycle",
  verificationCycleSchema
);

export default VerificationCycle;