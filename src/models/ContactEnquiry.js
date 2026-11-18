import mongoose from "mongoose";

const contactEnquirySchema = new mongoose.Schema(
  {
    name: {
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
    number: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["new", "reviewed", "closed"],
      default: "new",
    },
  },
  { timestamps: true }
);

contactEnquirySchema.index({
  status: 1,
  createdAt: -1,
});

export default mongoose.model(
  "ContactEnquiry",
  contactEnquirySchema
);