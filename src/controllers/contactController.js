import ContactEnquiry from "../models/ContactEnquiry.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[\d\s()-]+$/;

export async function createContactEnquiry(req, res) {
  try {
    const { name, email, number, message } = req.body ?? {};

    const fields = [name, email, number, message];

    if (
      fields.some(
        (value) =>
          typeof value !== "string" || !value.trim()
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all contact fields.",
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanNumber = number.trim();
    const cleanMessage = message.trim();

    const digits = cleanNumber.replace(/\D/g, "");

    if (
      cleanName.length > 100 ||
      cleanEmail.length > 254 ||
      !emailPattern.test(cleanEmail) ||
      cleanNumber.length > 30 ||
      !phonePattern.test(cleanNumber) ||
      digits.length < 7 ||
      digits.length > 15 ||
      cleanMessage.length > 2000
    ) {
      return res.status(400).json({
        success: false,
        message: "Please enter valid contact details.",
      });
    }

    const enquiry = await ContactEnquiry.create({
      name: cleanName,
      email: cleanEmail,
      number: cleanNumber,
      message: cleanMessage,
    });

    return res.status(201).json({
      success: true,
      message: "Your enquiry was submitted successfully.",
      enquiryId: enquiry._id,
    });
  } catch (error) {
    console.error("Contact submission failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit your enquiry.",
    });
  }
}

export async function getContactEnquiries(req, res) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);

    if (
      !Number.isSafeInteger(page) ||
      !Number.isSafeInteger(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger((page - 1) * limit)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid pagination parameters.",
      });
    }

    const [enquiries, total] = await Promise.all([
      ContactEnquiry.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ContactEnquiry.countDocuments(),
    ]);

    return res.status(200).json({
      success: true,
      enquiries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Contact retrieval failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve enquiries.",
    });
  }
}