import Vehicle from "../models/Vehicle.js";
import Booking from "../models/Booking.js";
import AvailabilityBlock from "../models/AvailabilityBlock.js";
import CheckoutLock from "../models/CheckoutLock.js";

export const checkVehicleAvailability = async ({
  vehicleId,
  pickupAt,
  returnAt,
}) => {
  // 1. Validate the vehicle ID
  if (typeof vehicleId !== "string" || !/^[a-fA-F0-9]{24}$/.test(vehicleId)) {
    throw new TypeError("Invalid vehicle ID");
  }

  // 2. Validate the rental dates
  if (!(pickupAt instanceof Date) && typeof pickupAt !== "string") {
    throw new TypeError("Invalid pickup date");
  }

  if (!(returnAt instanceof Date) && typeof returnAt !== "string") {
    throw new TypeError("Invalid return date");
  }

  const startDate = new Date(pickupAt);
  const endDate = new Date(returnAt);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new TypeError("Invalid rental dates");
  }

  if (startDate <= new Date()) {
    throw new RangeError("Pickup date must be in the future");
  }

  if (endDate <= startDate) {
    throw new RangeError("Return date must be after pickup date");
  }

  // 3. Find the vehicle
  const vehicle = await Vehicle.findById(vehicleId)
    .select("isActive operationalStatus")
    .lean();

  if (!vehicle) {
    return {
      available: false,
      reason: "vehicle_not_found",
    };
  }

  // 4. Check listing status
  if (!vehicle.isActive) {
    return {
      available: false,
      reason: "vehicle_inactive",
    };
  }

  // 5. Check operational readiness
  if (vehicle.operationalStatus !== "available") {
    return {
      available: false,
      reason: "vehicle_not_operational",
    };
  }

  // 6. Define overlapping rental periods
  const overlapFilter = {
    vehicle: vehicleId,
    "rentalPeriod.pickupAt": { $lt: endDate },
    "rentalPeriod.returnAt": { $gt: startDate },
  };

  // Reference time for checking checkout lock expiry
  const now = new Date();

  // Check three possible sources of unavailability
  const [conflictingBlock, conflictingBooking, conflictingCheckoutLock] =
    await Promise.all([
      // 1. Scheduled maintenance or inspections
      AvailabilityBlock.exists({
        vehicle: vehicleId,
        isActive: true,
        startAt: { $lt: endDate },
        endAt: { $gt: startDate },
      }),

      // 2. Confirmed and ongoing reservations
      Booking.exists({
        ...overlapFilter,
        status: {
          $in: ["confirmed", "in_progress"],
        },
      }),

      // 3. Active, unexpired checkout locks
      CheckoutLock.exists({
        vehicle: vehicleId,
        status: "active",
        expiresAt: { $gt: now },
        "rentalPeriod.pickupAt": { $lt: endDate },
        "rentalPeriod.returnAt": { $gt: startDate },
      }),
    ]);

  // 8. Check administrative restrictions
  if (conflictingBlock) {
    return {
      available: false,
      reason: "availability_block",
    };
  }

  // 9. Check existing reservations
  if (conflictingBooking) {
    return {
      available: false,
      reason: "existing_reservation",
    };
  }

  if (conflictingCheckoutLock) {
    return {
      available: false,
      reason: "checkout_in_progress",
    };
  }

  // 10. Vehicle is potentially available
  return {
    available: true,
    reason: null,
  };
};
