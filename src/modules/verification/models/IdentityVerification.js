import mongoose from "mongoose";

const { Schema } = mongoose;
const objectId = Schema.Types.ObjectId;

const identityVerificationSchema = new Schema(
  {
    user: {
      type: objectId,
      ref: "User",
      required: true,
      index: true,
    },

    method: {
      type: String,
      enum: ["nin", "drivers_licence"],
      required: true,
    },

    source: {
      type: String,
      enum: ["provider", "admin_manual"],
      required: true,
    },

    session: {
      type: objectId,
      ref: "VerificationSession",
      default: null,
    },

    review: {
      type: objectId,
      ref: "VerificationReview",
      default: null,
    },

    // Opaque references only, never raw identity numbers.
    provider: {
      type: String,
      trim: true,
      default: null,
    },

    providerReference: {
      type: String,
      trim: true,
      default: null,
    },

    providerEvidence: {
      surnameMatched: {
        type: Boolean,
        default: null,
      },
      givenNameMatched: {
        type: Boolean,
        default: null,
      },
      holderAuthenticated: {
        type: Boolean,
        default: null,
      },
    },

    verifiedIdentityRevision: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },

    eligibilityStatus: {
      type: String,
      enum: ["eligible", "suspended", "revoked"],
      default: "eligible",
    },

    verifiedAt: {
      type: Date,
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    supersedes: {
      type: objectId,
      ref: "IdentityVerification",
      default: null,
    },

    stateVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

identityVerificationSchema.pre("validate", function () {
  if (
    this.verifiedAt &&
    this.expiresAt &&
    this.expiresAt <= this.verifiedAt
  ) {
    this.invalidate(
      "expiresAt",
      "Expiration must follow verification"
    );
  }

  if (this.source === "provider") {
    if (!this.session || !this.provider || !this.providerReference) {
      this.invalidate(
        "session",
        "Provider verification requires session and provider references"
      );
    }

    const evidence = this.providerEvidence;

    if (
      evidence?.surnameMatched !== true ||
      evidence?.givenNameMatched !== true ||
      evidence?.holderAuthenticated !== true
    ) {
      this.invalidate(
        "providerEvidence",
        "Provider identity and holder authentication must be confirmed"
      );
    }
  }

  if (this.source === "admin_manual" && !this.review) {
    this.invalidate(
      "review",
      "Manual verification requires an audited review"
    );
  }
});

identityVerificationSchema.index({
  user: 1,
  verifiedAt: -1,
});

identityVerificationSchema.index({
  user: 1,
  eligibilityStatus: 1,
  expiresAt: -1,
});

identityVerificationSchema.index(
  { session: 1 },
  {
    unique: true,
    partialFilterExpression: {
      session: { $type: "objectId" },
    },
  }
);

export default mongoose.model(
  "IdentityVerification",
  identityVerificationSchema
);