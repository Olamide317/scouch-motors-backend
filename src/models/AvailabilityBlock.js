import mongoose from "mongoose";

const availabilityBlockSchema = new mongoose.Schema(
  {
    // The physical vehicle being restricted
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: [true, "Vehicle is required"],
    },

    // Why the vehicle cannot be rented
    reason: {
      type: String,
      enum: ["maintenance", "inspection", "other"],
      required: [true, "Block reason is required"],
    },

    // Beginning of the unavailable period
    startAt: {
      type: Date,
      required: [true, "Start date and time are required"],
    },

    // End of the unavailable period
    endAt: {
      type: Date,
      required: [true, "End date and time are required"],
    },

    // Internal explanation for administrators
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    // Allows an admin to cancel a scheduled block
    // without deleting its record
    isActive: {
      type: Boolean,
      default: true,
    },

    // Administrator who created the restriction
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Administrator is required"],
    },

    deactivatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deactivatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// End time must be after start time
availabilityBlockSchema.pre("validate", function () {
  if (
    this.startAt instanceof Date &&
    this.endAt instanceof Date &&
    this.endAt <= this.startAt
  ) {
    this.invalidate("endAt", "End time must be after start time");
  }
});

// Helps retrieve active restrictions for a vehicle
availabilityBlockSchema.index({
  vehicle: 1,
  isActive: 1,
  startAt: 1,
  endAt: 1,
});

const AvailabilityBlock = mongoose.model(
  "AvailabilityBlock",
  availabilityBlockSchema,
);

export default AvailabilityBlock;
