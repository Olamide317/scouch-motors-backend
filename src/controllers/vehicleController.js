import { StatusCodes } from "http-status-codes";
import Vehicle from "../models/Vehicle.js";

// Create a new vehicle.
export const createVehicle = async (req, res) => {
  try {
    // Images must be uploaded through the dedicated image endpoint.
    if (Object.hasOwn(req.body ?? {}, "images")) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message:
          "Create the vehicle first, then upload images through the dedicated image endpoint.",
      });
    }

    const {
      brand,
      model,
      year,
      category,
      registrationNumber,
      transmission,
      fuelType,
      seats,
      description,
      pricing,
      climateControl,
      mileageKm,
    } = req.body ?? {};

    // Validate required string fields.
    const requiredStrings = {
      brand,
      model,
      category,
      registrationNumber,
      transmission,
      fuelType,
    };

    const invalidField = Object.entries(requiredStrings).find(
      ([, value]) => typeof value !== "string" || !value.trim(),
    );

    if (invalidField) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: `${invalidField[0]} is required`,
      });
    }

    // Validate numeric fields.
    if (
      !Number.isInteger(year) ||
      year < 1900 ||
      !Number.isInteger(seats) ||
      seats < 1
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle year or seating capacity",
      });
    }

    // Validate rental prices in whole NGN amounts.
    if (
      !pricing ||
      typeof pricing !== "object" ||
      Array.isArray(pricing) ||
      ["daily", "weekly", "monthly"].some(
        (period) =>
          !Number.isSafeInteger(pricing[period]) ||
          pricing[period] < 0,
      )
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Valid daily, weekly, and monthly prices are required",
      });
    }

    // Check for an existing registration number.
    const existingVehicle = await Vehicle.findOne({
      registrationNumber: registrationNumber.trim().toUpperCase(),
    }).select("+registrationNumber");

    if (existingVehicle) {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "A vehicle with this registration number already exists",
      });
    }

    // Validate climate control.
    if (
      climateControl != null &&
      !["A/C", "Automatic Climate Control", "None"].includes(
        climateControl,
      )
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid climate control option",
      });
    }

    // Validate mileage.
    if (
      mileageKm != null &&
      (!Number.isSafeInteger(mileageKm) || mileageKm < 0)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Mileage must be a non-negative whole number",
      });
    }

    // Only explicitly approved fields are accepted.
    const vehicle = await Vehicle.create({
      brand: brand.trim(),
      model: model.trim(),
      year,
      category: category.trim().toLowerCase(),
      registrationNumber: registrationNumber.trim().toUpperCase(),
      transmission: transmission.trim().toLowerCase(),
      fuelType: fuelType.trim().toLowerCase(),
      seats,
      description,
      climateControl: climateControl ?? undefined,
      mileageKm: mileageKm ?? undefined,

      // New admin-created vehicles are demonstration listings.
      // Keep them inactive until their details and images are ready.
      isDemo: true,
      isActive: false,

      pricing: {
        daily: pricing.daily,
        weekly: pricing.weekly,
        monthly: pricing.monthly,
        currency: "NGN",
      },
    });

    // Do not expose internal registration details.
    const vehicleData = vehicle.toObject();
    delete vehicleData.registrationNumber;

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Vehicle created successfully",
      vehicle: vehicleData,
    });
  } catch (error) {
    console.error("Create vehicle error:", error);

    if (error.code === 11000) {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "A vehicle with this registration number already exists",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: Object.values(error.errors)
          .map((err) => err.message)
          .join(", "),
      });
    }

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to create vehicle",
    });
  }
};

// Get publicly available vehicles.
export const getVehicles = async (req, res) => {
  try {
    const {
      brand,
      category,
      sort = "newest",
      page = "1",
      limit = "12",
    } = req.query;

    // Validate optional filters.
    if (
      (brand !== undefined && typeof brand !== "string") ||
      (category !== undefined && typeof category !== "string")
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle filters",
      });
    }

    // Validate pagination values.
    const isPositiveInteger = (value) =>
      /^\d+$/.test(String(value)) && Number(value) > 0;

    if (
      !isPositiveInteger(page) ||
      !isPositiveInteger(limit) ||
      !Number.isSafeInteger(Number(page)) ||
      !Number.isSafeInteger(Number(limit)) ||
      Number(limit) > 50
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid pagination parameters",
      });
    }

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    // Only return publicly listed, operational vehicles.
    const filter = {
      isActive: true,
      operationalStatus: "available",
    };

    if (brand?.trim()) {
      filter.brand = brand.trim();
    }

    if (category?.trim()) {
      filter.category = category.trim().toLowerCase();
    }

    const sortOptions = {
      newest: { createdAt: -1, _id: -1 },
      price_asc: { "pricing.daily": 1, _id: 1 },
      price_desc: { "pricing.daily": -1, _id: -1 },
      year_desc: { year: -1, _id: -1 },
    };

    if (!Object.hasOwn(sortOptions, sort)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid sorting option",
      });
    }

    const skip = (pageNumber - 1) * limitNumber;

    if (!Number.isSafeInteger(skip)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Page number is too large",
      });
    }

    const [vehicles, totalVehicles] = await Promise.all([
      Vehicle.find(filter)
        .select("-registrationNumber -__v")
        .sort(sortOptions[sort])
        .skip(skip)
        .limit(limitNumber)
        .collation({ locale: "en", strength: 2 })
        .lean(),

      Vehicle.countDocuments(filter).collation({
        locale: "en",
        strength: 2,
      }),
    ]);

    return res.status(StatusCodes.OK).json({
      success: true,
      results: vehicles.length,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalVehicles / limitNumber),
        totalVehicles,
      },
      vehicles,
    });
  } catch (error) {
    console.error("Get vehicles error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve vehicles",
    });
  }
};

// Get one publicly available vehicle.
export const getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId format.
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // Retrieve only a publicly available vehicle.
    const vehicle = await Vehicle.findOne({
      _id: id,
      isActive: true,
      operationalStatus: "available",
    })
      .select("-registrationNumber -__v")
      .lean();

    if (!vehicle) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      vehicle,
    });
  } catch (error) {
    console.error("Get vehicle error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve vehicle",
    });
  }
};

// Update approved vehicle information.
// Images can only be changed through the dedicated image endpoints.
export const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate the MongoDB ID.
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // Ensure the request body is an object.
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid update data",
      });
    }

    // Only allow updates to these fields.
    // Images are deliberately excluded.
    const allowedFields = [
      "brand",
      "model",
      "year",
      "category",
      "transmission",
      "fuelType",
      "seats",
      "description",
      "climateControl",
      "mileageKm",
      "pricing",
    ];

    const updateFields = Object.keys(updates);

    if (
      updateFields.length === 0 ||
      updateFields.some((field) => !allowedFields.includes(field))
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "One or more update fields are not allowed",
      });
    }

    // Retrieve the existing vehicle.
    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    // Update approved fields.
    for (const field of updateFields) {
      if (field === "pricing") {
        const pricing = updates.pricing;

        if (
          !pricing ||
          typeof pricing !== "object" ||
          Array.isArray(pricing) ||
          Object.keys(pricing).length === 0 ||
          Object.keys(pricing).some(
            (key) => !["daily", "weekly", "monthly"].includes(key),
          )
        ) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            message: "Invalid pricing fields",
          });
        }

        // Update only the supplied pricing periods.
        for (const period of Object.keys(pricing)) {
          if (
            !Number.isSafeInteger(pricing[period]) ||
            pricing[period] < 0
          ) {
            return res.status(StatusCodes.BAD_REQUEST).json({
              success: false,
              message: `Invalid ${period} rental price`,
            });
          }

          vehicle.pricing[period] = pricing[period];
        }
      } else {
        vehicle[field] = updates[field];
      }
    }

    // Run Mongoose schema validation and save.
    await vehicle.save();

    // Exclude internal fields from the response.
    const vehicleData = vehicle.toObject();
    delete vehicleData.registrationNumber;
    delete vehicleData.__v;

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Vehicle updated successfully",
      vehicle: vehicleData,
    });
  } catch (error) {
    console.error("Update vehicle error:", error);

    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle information",
      });
    }

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to update vehicle",
    });
  }
};

// Deactivate a vehicle listing.
export const deactivateVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId.
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // Find the vehicle.
    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    // Check if the vehicle is already deactivated.
    if (!vehicle.isActive) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Vehicle is already deactivated",
      });
    }

    // Deactivate the vehicle.
    vehicle.isActive = false;

    await vehicle.save();

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Vehicle deactivated successfully",
      vehicle: {
        id: vehicle._id,
        brand: vehicle.brand,
        model: vehicle.model,
        isActive: vehicle.isActive,
        operationalStatus: vehicle.operationalStatus,
      },
    });
  } catch (error) {
    console.error("Deactivate vehicle error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to deactivate vehicle",
    });
  }
};

// Activate a vehicle listing.
export const activateVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId.
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // Atomically activate only an inactive vehicle that has an image.
    // This prevents a concurrent image removal from leaving an active
    // listing without photos.
    const vehicle = await Vehicle.findOneAndUpdate(
      {
        _id: id,
        isActive: false,
        "images.0": { $exists: true },
      },
      {
        $set: { isActive: true },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!vehicle) {
      // Find the current state to identify why activation did not happen.
      const currentVehicle = await Vehicle.findById(id);

      if (!currentVehicle) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: "Vehicle not found",
        });
      }

      if (currentVehicle.isActive) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Vehicle is already active",
          vehicle: {
            id: currentVehicle._id,
            brand: currentVehicle.brand,
            model: currentVehicle.model,
            isActive: currentVehicle.isActive,
            operationalStatus: currentVehicle.operationalStatus,
          },
        });
      }

      if (!currentVehicle.images || currentVehicle.images.length === 0) {
        return res.status(StatusCodes.CONFLICT).json({
          success: false,
          message:
            "Upload at least one vehicle image before activating this listing.",
        });
      }

      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "Vehicle details changed. Refresh and try again.",
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Vehicle activated successfully",
      vehicle: {
        id: vehicle._id,
        brand: vehicle.brand,
        model: vehicle.model,
        isActive: vehicle.isActive,
        operationalStatus: vehicle.operationalStatus,
      },
    });
  } catch (error) {
    console.error("Activate vehicle error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to activate vehicle",
    });
  }
};

// Update a vehicle's operational status.
export const updateVehicleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { operationalStatus } = req.body ?? {};

    // Validate the vehicle ID.
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // Validate the requested status.
    const allowedStatuses = [
      "available",
      "maintenance",
      "out_of_service",
    ];

    if (
      typeof operationalStatus !== "string" ||
      !allowedStatuses.includes(operationalStatus)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message:
          "Invalid operational status. Use available, maintenance, or out_of_service",
      });
    }

    // Find the vehicle.
    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    // Check whether the status is already set.
    if (vehicle.operationalStatus === operationalStatus) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Vehicle already has this operational status",
        vehicle: {
          id: vehicle._id,
          brand: vehicle.brand,
          model: vehicle.model,
          isActive: vehicle.isActive,
          operationalStatus: vehicle.operationalStatus,
        },
      });
    }

    // Update operational status.
    vehicle.operationalStatus = operationalStatus;

    await vehicle.save();

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Vehicle operational status updated successfully",
      vehicle: {
        id: vehicle._id,
        brand: vehicle.brand,
        model: vehicle.model,
        isActive: vehicle.isActive,
        operationalStatus: vehicle.operationalStatus,
      },
    });
  } catch (error) {
    console.error("Update vehicle status error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to update vehicle status",
    });
  }
};

// Get every vehicle for the administrator inventory.
export const getAdminVehicles = async (req, res) => {
  try {
    // Retrieve all vehicles regardless of activation
    // or operational status.
    const vehicles = await Vehicle.find({})
      .select("-registrationNumber -__v")
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return res.status(StatusCodes.OK).json({
      success: true,
      results: vehicles.length,
      vehicles,
    });
  } catch (error) {
    console.error("Get admin vehicles error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve vehicle inventory",
    });
  }
};