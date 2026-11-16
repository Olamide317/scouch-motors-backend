import mongoose from "mongoose";

const { Schema } = mongoose;

const verificationReviewSchema = new Schema(
  {
    // Customer whose verification requires review
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // What caused this review to be opened?
    reviewType: {
      type: String,
      enum: [
        "customer_appeal",
        "admin_investigation",
        "recovery_exhausted",
      ],
      required: true,
    },

    // Who initiated the review?
    origin: {
      type: String,
      enum: ["customer", "admin", "system"],
      required: true,
    },

    openedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Current administrative review status
    status: {
      type: String,
      enum: [
        "open",
        "in_review",
        "resolved",
        "withdrawn",
      ],
      default: "open",
    },

    // Optional verification-related references
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

    // Identifies the specific suspension being appealed
    suspensionAuditEvent: {
      type: Schema.Types.ObjectId,
      ref: "VerificationAuditEvent",
      default: null,
    },

    // Multiple bookings may be affected by one review
    affectedBookings: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "Booking",
        },
      ],
      default: [],
    },

    // Written explanation submitted by the customer
    customerStatement: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    // Internal administrative information
    internalReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    internalNotes: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },

    // Safe, general explanation visible to the customer
    customerMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    // Optional reference to independently established
    // evidence used for an authorized manual decision.
    // Never store raw NINs, licence numbers, or images.
    independentEvidenceReference: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    // Current administrator handling the case
    assignedAdmin: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Final administrative decision
    resolution: {
      outcome: {
        type: String,
        enum: [
          "restore_eligibility",
          "maintain_suspension",
          "require_reverification",
          "manual_verification_approved",
          "resolved_no_change",
        ],
        default: null,
      },

      notes: {
        type: String,
        trim: true,
        maxlength: 2000,
        default: "",
      },

      decidedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      decidedAt: {
        type: Date,
        default: null,
      },
    },

    // Helps prevent conflicting administrative updates
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

// Validate relationships between review fields
verificationReviewSchema.pre("validate", function () {
  // Appeals must refer to a particular suspension
  // and contain a written customer explanation.
  if (this.reviewType === "customer_appeal") {
    if (
      this.origin !== "customer" ||
      !this.openedBy ||
      !this.suspensionAuditEvent ||
      !this.customerStatement?.trim()
    ) {
      this.invalidate(
        "reviewType",
        "Customer appeals require a customer, suspension reference, and written explanation"
      );
    }
  }

  // Recovery reviews must identify the affected cycle.
  if (
    this.reviewType === "recovery_exhausted" &&
    !this.cycle
  ) {
    this.invalidate(
      "cycle",
      "Recovery reviews require a verification cycle"
    );
  }

  // A resolved review needs an explicit admin decision.
  if (this.status === "resolved") {
    if (
      !this.resolution?.outcome ||
      !this.resolution?.decidedBy ||
      !this.resolution?.decidedAt
    ) {
      this.invalidate(
        "resolution",
        "Resolved reviews require an administrative decision"
      );
    }

    // Manual verification cannot be based solely
    // on a customer's written appeal.
    if (
      this.resolution?.outcome ===
        "manual_verification_approved" &&
      !this.independentEvidenceReference
    ) {
      this.invalidate(
        "independentEvidenceReference",
        "Manual verification requires independent evidence"
      );
    }
  }
});

// Only one active customer appeal for a suspension
verificationReviewSchema.index(
  {
    user: 1,
    suspensionAuditEvent: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      reviewType: "customer_appeal",
      status: { $in: ["open", "in_review"] },
    },
  }
);

// Consolidate open recovery reviews by cycle
verificationReviewSchema.index(
  {
    user: 1,
    cycle: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      reviewType: "recovery_exhausted",
      status: { $in: ["open", "in_review"] },
    },
  }
);

// Retrieve customer review history
verificationReviewSchema.index({
  user: 1,
  createdAt: -1,
});

// Retrieve reviews by administrative status
verificationReviewSchema.index({
  status: 1,
  createdAt: -1,
});

// Retrieve cases assigned to an administrator
verificationReviewSchema.index({
  assignedAdmin: 1,
  status: 1,
});

const VerificationReview = mongoose.model(
  "VerificationReview",
  verificationReviewSchema
);

export default VerificationReview;