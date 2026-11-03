import mongoose from "mongoose";

// Rental dates
const rentalPeriodSchema = new mongoose.Schema(
  {
    pickupAt: {
      type: Date,
      required: [true, "Pickup date and time are required"],
    },

    returnAt: {
      type: Date,
      required: [true, "Return date and time are required"],
    },
  },
  { _id: false },
);

// Pickup or return arrangement
const locationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

const rateBreakdownSchema = new mongoose.Schema(
  {
    plan: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      required: true,
    },

    daysCovered: {
      type: Number,
      required: true,
      min: 1,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

// Snapshot of rental prices at booking creation
const pricingSchema = new mongoose.Schema(
  {
    currency: {
      type: String,
      enum: ["NGN"],
      default: "NGN",
    },

    rentalDays: {
      type: Number,
      required: true,
      min: 1,
    },

    ratePlan: {
      type: String,
      enum: ["daily", "weekly", "monthly", "mixed"],
      required: true,
    },

    ratesSnapshot: {
      daily: {
        type: Number,
        required: true,
        min: 0,
      },

      weekly: {
        type: Number,
        required: true,
        min: 0,
      },

      monthly: {
        type: Number,
        required: true,
        min: 0,
      },
    },
    
    // NEW: Store how the best rental rate was calculated
    rateBreakdown: {
      type: [rateBreakdownSchema],
      default: [],
    },

    rentalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    pickupFee: {
      type: Number,
      required: true,
      min: 0,
    },

    returnFee: {
      type: Number,
      required: true,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Customer is required"],
      index: true,
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: [true, "Vehicle is required"],
      index: true,
    },

    rentalPeriod: {
      type: rentalPeriodSchema,
      required: true,
    },

    pickupLocation: {
      type: locationSchema,
      required: true,
    },

    returnLocation: {
      type: locationSchema,
      required: true,
    },

    pricing: {
      type: pricingSchema,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "requested",
        "provisionally_approved",
        "awaiting_payment",
        "confirmed",
        "in_progress",
        "completed",
        "rejected",
        "cancelled",
        "expired",
      ],
      default: "requested",
    },

    verificationStatus: {
      type: String,
      enum: ["not_submitted", "pending", "approved", "rejected"],
      default: "not_submitted",
    },

    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "failed", "refunded"],
      default: "unpaid",
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    holdExpiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Validate rental date order and location arrangements
bookingSchema.pre("validate", function () {
  const period = this.rentalPeriod;

  if (
    period?.pickupAt instanceof Date &&
    period?.returnAt instanceof Date &&
    period.returnAt <= period.pickupAt
  ) {
    this.invalidate(
      "rentalPeriod.returnAt",
      "Return time must be after pickup time",
    );
  }

  const pickup = this.pickupLocation;
  if (pickup) {
    if (!["office", "delivery"].includes(pickup.type)) {
      this.invalidate(
        "pickupLocation.type",
        "Pickup must be office or delivery",
      );
    }

    if (pickup.type === "delivery" && !pickup.address?.trim()) {
      this.invalidate("pickupLocation.address", "Delivery address is required");
    }
  }

  const returnLocation = this.returnLocation;
  if (returnLocation) {
    if (!["office", "collection"].includes(returnLocation.type)) {
      this.invalidate(
        "returnLocation.type",
        "Return must be office or collection",
      );
    }

    if (
      returnLocation.type === "collection" &&
      !returnLocation.address?.trim()
    ) {
      this.invalidate(
        "returnLocation.address",
        "Collection address is required",
      );
    }
  }
});

// Useful indexes for customer history and availability queries
bookingSchema.index({ customer: 1, createdAt: -1 });

bookingSchema.index({
  vehicle: 1,
  status: 1,
  "rentalPeriod.pickupAt": 1,
  "rentalPeriod.returnAt": 1,
});

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;
