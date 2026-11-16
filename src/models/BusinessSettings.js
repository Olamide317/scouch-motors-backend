import mongoose from "mongoose";

const pricingPolicySchema = new mongoose.Schema(
  {
    minimumRentalDays: {
      type: Number,
      default: 1,
      min: 1,
      max: 30,
    },

    maximumRentalDays: {
      type: Number,
      default: 90,
      min: 1,
      max: 365,
    },

    weeklyDays: {
      type: Number,
      default: 7,
      min: 2,
      max: 14,
    },

    monthlyDays: {
      type: Number,
      default: 30,
      min: 15,
      max: 45,
    },

    allowPackageUpgrade: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false },
);

const verificationPolicySchema = new mongoose.Schema(
  {
    version: {
      type: Number,
      default: 1,
      min: 1,
    },

    identityVerificationRequired: {
      type: Boolean,
      default: true,
    },

    acceptedMethods: {
      type: [String],
      enum: ["nin", "drivers_licence"],
      default: () => ["nin", "drivers_licence"],
      validate: {
        validator: (methods) =>
          Array.isArray(methods) &&
          methods.length > 0 &&
          new Set(methods).size === methods.length,
        message: "Accepted verification methods must be nonempty and unique",
      },
    },

    validityMonths: {
      type: Number,
      default: 12,
      min: 1,
      max: 60,
    },

    incorrectSubmissionsPerCycle: {
      type: Number,
      enum: [2, 3],
      default: 3,
    },

    automaticRecoveryHours: {
      type: Number,
      default: 24,
      min: 1,
      max: 168,
    },

    voluntaryRenewalLimit: {
      type: Number,
      enum: [2],
      default: 2,
    },

    renewalWindowDays: {
      type: Number,
      enum: [30],
      default: 30,
    },
  },
  { _id: false },
);

const businessSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: "primary",
    },

    pricingPolicy: {
      type: pricingPolicySchema,
      default: () => ({}),
    },

    verificationPolicy: {
      type: verificationPolicySchema,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

// Validate relationships between settings.
businessSettingsSchema.pre("validate", function () {
  const policy = this.pricingPolicy;

  if (policy.minimumRentalDays > policy.maximumRentalDays) {
    this.invalidate(
      "pricingPolicy.maximumRentalDays",
      "Maximum rental days must be at least the minimum",
    );
  }

  if (policy.monthlyDays <= policy.weeklyDays) {
    this.invalidate(
      "pricingPolicy.monthlyDays",
      "Monthly package must cover more days than weekly",
    );
  }
});

const BusinessSettings = mongoose.model(
  "BusinessSettings",
  businessSettingsSchema,
);

export default BusinessSettings;
