import RepairEnquiry from "../models/RepairEnquiry.js";

const allowedServices = new Set([
  "Routine Servicing",
  "Mechanical Repairs",
  "Vehicle Diagnostics",
  "General Inspection",
  "Other",
]);

const allowedStatuses = new Set([
  "new",
  "in_review",
  "closed",
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[\d\s()-]+$/;
const validIdPattern = /^[a-fA-F0-9]{24}$/;

// POST /api/repair-enquiries
export async function createRepairEnquiry(req, res) {
  try {
    const {
      fullName,
      email,
      phone,
      vehicle,
      serviceType,
      description,
    } = req.body ?? {};

    const values = [
      fullName,
      email,
      phone,
      vehicle,
      serviceType,
      description,
    ];

    if (
      values.some(
        (value) =>
          typeof value !== "string" || !value.trim()
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields.",
      });
    }

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanVehicle = vehicle.trim();
    const cleanService = serviceType.trim();
    const cleanDescription = description.trim();

    const phoneDigits = cleanPhone.replace(/\D/g, "");

    if (
      cleanName.length > 100 ||
      cleanEmail.length > 254 ||
      !emailPattern.test(cleanEmail) ||
      cleanPhone.length > 30 ||
      !phonePattern.test(cleanPhone) ||
      phoneDigits.length < 7 ||
      phoneDigits.length > 15 ||
      cleanVehicle.length > 120 ||
      !allowedServices.has(cleanService) ||
      cleanDescription.length > 3000
    ) {
      return res.status(400).json({
        success: false,
        message: "Please enter valid service enquiry details.",
      });
    }

    const enquiry = await RepairEnquiry.create({
      fullName: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      vehicle: cleanVehicle,
      serviceType: cleanService,
      description: cleanDescription,
    });

    return res.status(201).json({
      success: true,
      message: "Service enquiry submitted successfully.",
      enquiryId: enquiry._id,
    });
  } catch (error) {
    console.error("Create repair enquiry failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit service enquiry.",
    });
  }
}

// GET /api/repair-enquiries
// Administrator only.
export async function getRepairEnquiries(req, res) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const requestedStatus = req.query.status;

    const skip = (page - 1) * limit;

    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(skip)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid pagination parameters.",
      });
    }

    const filter = {};

    if (requestedStatus !== undefined) {
      if (
        typeof requestedStatus !== "string" ||
        !allowedStatuses.has(requestedStatus)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid enquiry status.",
        });
      }

      filter.status = requestedStatus;
    }

    const [enquiries, total] = await Promise.all([
      RepairEnquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      RepairEnquiry.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      enquiries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: skip + enquiries.length < total,
      },
    });
  } catch (error) {
    console.error("Get repair enquiries failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve service enquiries.",
    });
  }
}

// PATCH /api/repair-enquiries/:id/status
// Administrator only.
export async function updateRepairEnquiryStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body ?? {};

    if (!validIdPattern.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid enquiry ID.",
      });
    }

    if (
      typeof status !== "string" ||
      !allowedStatuses.has(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid enquiry status.",
      });
    }

    const enquiry = await RepairEnquiry.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true, runValidators: true }
    );

    if (!enquiry) {
      return res.status(404).json({
        success: false,
        message: "Service enquiry not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Enquiry status updated successfully.",
      enquiry: {
        id: enquiry._id,
        status: enquiry.status,
        updatedAt: enquiry.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update repair enquiry failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update service enquiry.",
    });
  }
}