import mongoose from "mongoose";

const repairEnquirySchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },

    vehicle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    serviceType: {
      type: String,
      required: true,
      enum: [
        "Routine Servicing",
        "Mechanical Repairs",
        "Vehicle Diagnostics",
        "General Inspection",
        "Other",
      ],
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 3000,
    },

    status: {
      type: String,
      enum: ["new", "in_review", "closed"],
      default: "new",
    },
  },
  { timestamps: true }
);

repairEnquirySchema.index({
  status: 1,
  createdAt: -1,
});

export default mongoose.model(
  "RepairEnquiry",
  repairEnquirySchema
);