
import {
  calculateBestRentalRate,
} from "./src/services/pricingService.js";

const policy = {
  minimumRentalDays: 1,
  maximumRentalDays: 90,
  weeklyDays: 7,
  monthlyDays: 30,
  allowPackageUpgrade: true,
};

const rates = {
  daily: 85000,
  weekly: 540000,
  monthly: 2000000,
};

const pickupAt = "2026-11-10T09:00:00+01:00";

const tests = [
  { name: "1 day", days: 1 },
  { name: "7 days", days: 7 },
  { name: "10 days", days: 10 },
  { name: "28 days", days: 28 },
  { name: "31 days", days: 31 },
];

for (const test of tests) {
  const returnAt = new Date(
    new Date(pickupAt).getTime() +
    test.days * 24 * 60 * 60 * 1000
  ).toISOString();

  const quote = calculateBestRentalRate({
    pickupAt,
    returnAt,
    rates,
    policy,
  });

  console.log({
    rentalDays: quote.rentalDays,
    amount: quote.rentalAmount,
    ratePlan: quote.ratePlan,
    coveredDays: quote.coveredDays,
  });
}
