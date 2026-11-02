import { StatusCodes } from "http-status-codes";
import Vehicle from "../models/Vehicle.js";

export const createVehicle = async (req, res) => {
  try {
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
      images,
      pricing,
    } = req.body ?? {};

    // Validate basic string fields
    const requiredStrings = {
      brand,
      model,
      category,
      registrationNumber,
      transmission,
      fuelType,
    };

    const invalidField = Object.entries(requiredStrings).find(
      ([, value]) =>
        typeof value !== "string" || !value.trim()
    );

    if (invalidField) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: `${invalidField[0]} is required`,
      });
    }

    // Validate numeric fields
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

    // Validate rental prices in whole NGN amounts
    if (
      !pricing ||
      typeof pricing !== "object" ||
      ["daily", "weekly", "monthly"].some(
        (period) =>
          !Number.isSafeInteger(pricing[period]) ||
          pricing[period] < 0
      )
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Valid daily, weekly, and monthly prices are required",
      });
    }

    if (
      images !== undefined &&
      (!Array.isArray(images) ||
        images.some((image) => typeof image !== "string"))
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Images must be an array of strings",
      });
    }

    // Check registration number
    const existingVehicle = await Vehicle.findOne({
      registrationNumber: registrationNumber.trim().toUpperCase(),
    }).select("+registrationNumber");

    if (existingVehicle) {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "A vehicle with this registration number already exists",
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
      images,
      pricing: {
        daily: pricing.daily,
        weekly: pricing.weekly,
        monthly: pricing.monthly,
        currency: "NGN",
      },
    });

    // Do not return internal registration details.
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

export const getVehicles = async (req, res) => {
  try {
    const {
      brand,
      category,
      sort = "newest",
      page = "1",
      limit = "12",
    } = req.query;

    // Validate optional filters
    if (
      (brand !== undefined && typeof brand !== "string") ||
      (category !== undefined && typeof category !== "string")
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle filters",
      });
    }

    // Validate pagination values
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

    // Only return publicly listed, operational vehicles
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

export const getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId format
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // Retrieve only a publicly available vehicle
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

export const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate the MongoDB ID
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // Ensure the request body is an object
    if (
      !updates ||
      typeof updates !== "object" ||
      Array.isArray(updates)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid update data",
      });
    }

    // Only allow updates to these fields
    const allowedFields = [
      "brand",
      "model",
      "year",
      "category",
      "transmission",
      "fuelType",
      "seats",
      "description",
      "images",
      "pricing",
    ];

    const updateFields = Object.keys(updates);

    if (
      updateFields.length === 0 ||
      updateFields.some(
        (field) => !allowedFields.includes(field)
      )
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "One or more update fields are not allowed",
      });
    }

    // Retrieve the existing vehicle
    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    // Update approved fields
    for (const field of updateFields) {
      if (field === "pricing") {
        const pricing = updates.pricing;

        if (
          !pricing ||
          typeof pricing !== "object" ||
          Array.isArray(pricing) ||
          Object.keys(pricing).length === 0 ||
          Object.keys(pricing).some(
            (key) =>
              !["daily", "weekly", "monthly"].includes(key)
          )
        ) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            message: "Invalid pricing fields",
          });
        }

        // Update only the supplied pricing periods
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
      } else if (field === "images") {
        if (
          !Array.isArray(updates.images) ||
          updates.images.some(
            (image) =>
              typeof image !== "string" ||
              !/^https:\/\/\S+$/i.test(image)
          )
        ) {
          return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            message: "Images must contain HTTPS URLs",
          });
        }

        vehicle.images = updates.images;
      } else {
        vehicle[field] = updates[field];
      }
    }

    // Run Mongoose schema validation and save
    await vehicle.save();

    // Exclude internal fields from the response
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

    if (error.name === "ValidationError" ||
        error.name === "CastError") {
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