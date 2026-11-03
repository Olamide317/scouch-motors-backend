const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const calculateRentalDays = (pickupAt, returnAt) => {
  const pickupDate = new Date(pickupAt);
  const returnDate = new Date(returnAt);

  // 1. Check that both dates are valid
  if (
    Number.isNaN(pickupDate.getTime()) ||
    Number.isNaN(returnDate.getTime())
  ) {
    throw new Error("Invalid pickup or return date");
  }

  // 2. Ensure the return time is after pickup
  if (returnDate <= pickupDate) {
    throw new Error("Return time must be after pickup time");
  }

  // 3. Calculate the duration in milliseconds
  const duration = returnDate.getTime() - pickupDate.getTime();

  // 4. Convert duration to billable rental days
  const rentalDays = Math.ceil(
    duration / MILLISECONDS_PER_DAY
  );

  return rentalDays;
};

export const calculateBestRentalRate = ({
  pickupAt,
  returnAt,
  rates,
  policy,
}) => {
  const rentalDays = calculateRentalDays(pickupAt, returnAt);

  const {
    minimumRentalDays,
    maximumRentalDays,
    weeklyDays,
    monthlyDays,
    allowPackageUpgrade,
  } = policy ?? {};

  // Validate the pricing policy.
  if (
    ![
      minimumRentalDays,
      maximumRentalDays,
      weeklyDays,
      monthlyDays,
    ].every(Number.isSafeInteger) ||
    minimumRentalDays < 1 ||
    maximumRentalDays < minimumRentalDays ||
    weeklyDays < 2 ||
    monthlyDays <= weeklyDays ||
    typeof allowPackageUpgrade !== "boolean"
  ) {
    throw new Error("Invalid rental pricing policy");
  }

  if (
    rentalDays < minimumRentalDays ||
    rentalDays > maximumRentalDays
  ) {
    throw new Error(
      `Rental duration must be between ${minimumRentalDays} and ${maximumRentalDays} days`
    );
  }

  // Only whole, non-negative NGN amounts are supported.
  if (
    !rates ||
    !["daily", "weekly", "monthly"].every(
      (key) =>
        Number.isSafeInteger(rates[key]) &&
        rates[key] >= 0
    )
  ) {
    throw new Error("Valid rental rates are required");
  }

  const plans = [
    {
      plan: "daily",
      daysCovered: 1,
      unitPrice: rates.daily,
    },
    {
      plan: "weekly",
      daysCovered: weeklyDays,
      unitPrice: rates.weekly,
    },
    {
      plan: "monthly",
      daysCovered: monthlyDays,
      unitPrice: rates.monthly,
    },
  ];

  // best[i] stores the cheapest combination covering
  // at least i requested rental days.
  const best = Array(rentalDays + 1).fill(null);

  best[0] = {
    total: 0,
    coveredDays: 0,
    breakdown: [],
  };

  for (let covered = 0; covered < rentalDays; covered++) {
    const current = best[covered];

    if (!current) continue;

    for (const plan of plans) {
      if (
        !allowPackageUpgrade &&
        covered + plan.daysCovered > rentalDays
      ) {
        continue;
      }

      const nextCovered = Math.min(
        rentalDays,
        covered + plan.daysCovered
      );

      const candidateTotal =
        current.total + plan.unitPrice;

      if (!Number.isSafeInteger(candidateTotal)) {
        throw new Error("Rental total exceeds safe integer range");
      }

      const candidate = {
        total: candidateTotal,
        coveredDays:
          current.coveredDays + plan.daysCovered,
        breakdown: [...current.breakdown, plan],
      };

      const previous = best[nextCovered];

      // Prioritize lowest cost, then least unused coverage,
      // then fewer packages.
      if (
        !previous ||
        candidate.total < previous.total ||
        (
          candidate.total === previous.total &&
          candidate.coveredDays < previous.coveredDays
        ) ||
        (
          candidate.total === previous.total &&
          candidate.coveredDays === previous.coveredDays &&
          candidate.breakdown.length <
            previous.breakdown.length
        )
      ) {
        best[nextCovered] = candidate;
      }
    }
  }

  const result = best[rentalDays];

  if (!result) {
    throw new Error("No eligible rental package combination");
  }

  const usedPlans = new Set(
    result.breakdown.map((item) => item.plan)
  );

  return {
    rentalDays,
    coveredDays: result.coveredDays,

    ratePlan:
      usedPlans.size === 1
        ? result.breakdown[0].plan
        : "mixed",

    ratesSnapshot: {
      daily: rates.daily,
      weekly: rates.weekly,
      monthly: rates.monthly,
    },

    rentalAmount: result.total,

    rateBreakdown: result.breakdown.map((item) => ({
      ...item,
      subtotal: item.unitPrice,
    })),
  };
};
