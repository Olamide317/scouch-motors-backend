import mongoose from "mongoose";

const vehicleImageAssetSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },

    publicId: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const vehicleSchema = new mongoose.Schema(
  {
    brand: {
      type: String,
      required: [true, "Vehicle brand is required"],
      trim: true,
    },

    model: {
      type: String,
      required: [true, "Vehicle model is required"],
      trim: true,
    },

    year: {
      type: Number,
      required: [true, "Vehicle year is required"],
      min: [1900, "Invalid manufacturing year"],
    },

    category: {
      type: String,
      required: [true, "Vehicle category is required"],
      enum: ["sedan", "suv", "coupe", "hatchback", "pickup", "van", "luxury"],
    },

    registrationNumber: {
      type: String,
      required: [true, "Registration number is required"],
      unique: true,
      trim: true,
      uppercase: true,
      select: false,
    },

    transmission: {
      type: String,
      required: true,
      enum: ["automatic", "manual"],
    },

    fuelType: {
      type: String,
      required: true,
      enum: ["petrol", "diesel", "hybrid", "electric"],
    },

    seats: {
      type: Number,
      required: true,
      min: 1,
    },

    climateControl: {
      type: String,
      enum: ["A/C", "Automatic Climate Control", "None"],
      default: undefined,
    },

    mileageKm: {
      type: Number,
      min: [0, "Mileage cannot be negative"],
      default: undefined,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    images: {
      type: [String],
      default: [],
    },

    imageAssets: {
      type: [vehicleImageAssetSchema],
      default: [],
      select: false,
    },

    isDemo: {
      type: Boolean,
      default: false,
    },

    pricing: {
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
      currency: {
        type: String,
        enum: ["NGN"],
        default: "NGN",
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    operationalStatus: {
      type: String,
      enum: ["available", "maintenance", "out_of_service"],
      default: "available",
    },

    // Used to serialize availability-changing transactions
    availabilityRevision: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

const Vehicle = mongoose.model("Vehicle", vehicleSchema);

export default Vehicle;
