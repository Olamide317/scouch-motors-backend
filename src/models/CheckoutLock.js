import mongoose from "mongoose";

// Dates protected during checkout
const rentalPeriodSchema = new mongoose.Schema(
  {
    pickupAt: {
      type: Date,
      required: true,
    },

    returnAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false }
);

const checkoutLockSchema = new mongoose.Schema(
  {
    // Physical vehicle being checked out
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },

    // Booking associated with this checkout
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },

    // Customer initiating the checkout
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    rentalPeriod: {
      type: rentalPeriodSchema,
      required: true,
    },

    // Unique identifier for this lock attempt
    lockToken: {
      type: String,
      required: true,
    },

    // Deadline for completing checkout
    expiresAt: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "released", "converted"],
      default: "active",
    },

    releasedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Validate rental date order
checkoutLockSchema.pre("validate", function () {
  const period = this.rentalPeriod;

  if (
    period?.pickupAt instanceof Date &&
    period?.returnAt instanceof Date &&
    period.returnAt <= period.pickupAt
  ) {
    this.invalidate(
      "rentalPeriod.returnAt",
      "Return time must be after pickup time"
    );
  }
});

// One reusable checkout-lock record per booking
checkoutLockSchema.index(
  { booking: 1 },
  { unique: true }
);

// Unique identity for each checkout attempt
checkoutLockSchema.index(
  { lockToken: 1 },
  { unique: true }
);

// Supports checking overlapping active checkout locks
checkoutLockSchema.index({
  vehicle: 1,
  status: 1,
  expiresAt: 1,
  "rentalPeriod.pickupAt": 1,
  "rentalPeriod.returnAt": 1,
});

const CheckoutLock = mongoose.model(
  "CheckoutLock",
  checkoutLockSchema
);

export default CheckoutLock;