const money = (value) => Math.round(value * 100) / 100;
function calculateCityFare(
  rate,
  { distance_km, duration_minutes, passenger_count = 1, parcel_weight_kg = 0 },
  code,
) {
  if (Number(rate.is_pricing_enabled) !== 1)
    return {
      suggested_fare: null,
      message: "Pricing is disabled for this tariff.",
    };
  const base =
    rate.fare_model === "fixed"
      ? Number(rate.fixed_fare || 0)
      : Number(rate.base_fare || 0);
  const distance =
    rate.fare_model === "fixed"
      ? 0
      : Math.max(0, distance_km - Number(rate.included_distance_km || 0)) *
        Number(rate.per_km_rate || 0);
  const duration =
    rate.fare_model === "fixed"
      ? 0
      : Math.max(
          0,
          duration_minutes - Number(rate.included_duration_minutes || 0),
        ) * Number(rate.per_minute_rate || 0);
  const weight =
    code === "parcel"
      ? Math.max(0, parcel_weight_kg - Number(rate.included_weight_kg || 0)) *
        Number(rate.extra_per_kg_rate || 0)
      : 0;
  let unit = Math.max(
    Number(rate.minimum_fare || 0),
    base + distance + duration + weight,
  );
  if (rate.maximum_fare != null)
    unit = Math.min(Number(rate.maximum_fare), unit);
  const step = Math.max(1, Number(rate.rounding_increment || 1));
  unit = Math.ceil(unit / step) * step;
  const multiplier = code === "shared" ? passenger_count : 1;
  const booking = Number(rate.booking_fee || 0),
    subtotal = unit * multiplier + booking;
  const total = money(subtotal * (1 + Number(rate.tax_percent || 0) / 100));
  const commission = Math.min(
    total,
    money(
      (total * Number(rate.commission_percent || 0)) / 100 +
        Number(rate.commission_fixed || 0),
    ),
  );
  return {
    suggested_fare: total,
    base: money(base),
    distance: money(distance),
    duration: money(duration),
    weight: money(weight),
    unit_fare: money(unit),
    multiplier,
    booking_fee: booking,
    tax: money(total - subtotal),
    platform_commission: commission,
    driver_earnings: money(total - commission),
    currency: rate.currency,
  };
}
module.exports = { calculateCityFare };
