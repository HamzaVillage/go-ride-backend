const { fail } = require("./employeeAccess");
const enabled = () => process.env.OFFERS_ENABLED === "true";
const money = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ACTIVE = "('Requested','Accepted','Arrived','Started','Ongoing')";
const benefit = (offer, gross) =>
  money(
    Math.min(
      gross,
      (gross * Number(offer.discount_percent)) / 100,
      offer.max_discount == null ? Infinity : Number(offer.max_discount),
    ),
  );
async function usage(conn, offer, userId) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS used FROM ride_promotions p JOIN ride_history r ON r.Ride_ID_Pk=p.ride_id WHERE p.offer_id=? AND p.actor_user_id=? AND p.state<>'released' AND (r.Ride_Status='Completed' OR r.Ride_Status IN ${ACTIVE})`,
    [offer.id, userId],
  );
  let used = Number(row.used);
  if (offer.eligibility === "first_rides") {
    const [[lifetime]] = await conn.query(
      offer.audience === "rider"
        ? "SELECT COUNT(*) AS completed FROM ride_history WHERE User_ID_Fk=? AND Ride_Status='Completed'"
        : "SELECT COUNT(*) AS completed FROM ride_history r JOIN drivers d ON d.id=r.Driver_ID_Fk WHERE d.User_ID_FK=? AND r.Ride_Status='Completed'",
      [userId],
    );
    const [[pending]] = await conn.query(
      `SELECT COUNT(*) AS pending FROM ride_promotions p JOIN ride_history r ON r.Ride_ID_Pk=p.ride_id WHERE p.offer_id=? AND p.actor_user_id=? AND p.state='reserved' AND r.Ride_Status IN ${ACTIVE}`,
      [offer.id, userId],
    );
    used = Math.max(used, Number(lifetime.completed) + Number(pending.pending));
  }
  return { used, remaining: Math.max(0, Number(offer.ride_limit) - used) };
}
const valid = (o, now) =>
  o.status === "active" &&
  Number(o.starts_at_ms) <= now &&
  Number(o.ends_at_ms) > now;
async function candidates(conn, audience, userId, gross, now = Date.now()) {
  if (!enabled()) return [];
  const [offers] = await conn.query(
    "SELECT * FROM promotions WHERE audience=? AND status='active' AND starts_at_ms<=? AND ends_at_ms>? ORDER BY id",
    [audience, now, now],
  );
  const result = [];
  for (const offer of offers) {
    const count = await usage(conn, offer, userId);
    if (count.remaining > 0)
      result.push({
        ...offer,
        ...count,
        discount: audience === "driver" ? money(gross) : benefit(offer, gross),
      });
  }
  return result.sort((a, b) => b.discount - a.discount || a.id - b.id);
}
function publicQuote(offer, gross) {
  return {
    offer_id: offer?.id || null,
    offer_name: offer?.name || null,
    discount_percent: offer ? Number(offer.discount_percent) : 0,
    original_fare: money(gross),
    discount_amount: offer?.discount || 0,
    customer_payable: money(gross - (offer?.discount || 0)),
    remaining_rides: offer?.remaining || 0,
    ends_at_ms: offer?.ends_at_ms || null,
  };
}
async function verifiedFare(conn, context) {
  let route;
  try {
    route = await require("./cityToCityGeography")
      .createGeography(null)
      .route(context?.pickup, context?.destination);
  } catch (e) {
    if (e.status === 400) throw e;
    throw fail(503, "Unable to verify the offer route fare. Please try again.");
  }
  const [[rate]] = await conn.query(
    "SELECT * FROM vehicle_fare_rate WHERE Vehicle_Type=? AND Is_Active=1 LIMIT 1",
    [context?.vehicle_type],
  );
  if (!rate || route.km > Number(rate.Maximum_Distance || 9999.99))
    throw fail(400, "This route is not available for the selected vehicle.");
  const {
    loadFarePolicy,
    scheduleStatus,
    calculateEstimatedFare,
  } = require("./farePolicy");
  const policy = await loadFarePolicy(conn),
    status = scheduleStatus(policy);
  return calculateEstimatedFare(
    rate,
    route.km,
    route.minutes,
    status.isPeak,
    status.isNight,
    0,
    policy,
  ).total_fare;
}
async function riderQuote(conn, userId, gross, context) {
  gross = Number(gross);
  if (!Number.isFinite(gross) || gross <= 0 || gross > 999999.99)
    throw fail(400, "Enter a valid positive fare.");
  let all = await candidates(conn, "rider", userId, gross);
  if (!all.length) return publicQuote(null, gross);
  const ceiling = await verifiedFare(conn, context);
  all = all
    .map((o) => ({ ...o, discount: benefit(o, Math.min(gross, ceiling)) }))
    .sort((a, b) => b.discount - a.discount || a.id - b.id);
  return { ...publicQuote(all[0], gross), discount_base_limit: ceiling };
}
async function reserve(
  conn,
  { rideId, userId, audience, gross, normalFee = 0, expected, verifiedLimit },
) {
  if (!enabled()) {
    const q = publicQuote(null, gross);
    if (
      audience === "rider" &&
      expected &&
      (expected.offer_id ||
        Number(expected.customer_payable) !== q.customer_payable)
    )
      throw fail(409, "Your offer changed. Review the updated fare.");
    return q;
  }
  const now = Date.now(),
    all = await candidates(
      conn,
      audience,
      userId,
      audience === "driver"
        ? normalFee
        : Math.min(gross, verifiedLimit ?? gross),
      now,
    );
  if (
    audience === "rider" &&
    all.length &&
    (!Number.isFinite(verifiedLimit) || verifiedLimit <= 0)
  )
    throw fail(409, "Refresh the fare to verify the current offer.");
  let selected;
  const locked = [];
  // Campaigns are locked in a stable order even when different fares rank offers
  // differently. Quota reads then use the caller's READ COMMITTED transaction.
  for (const option of [...all].sort((a, b) => Number(a.id) - Number(b.id))) {
    const [[offer]] = await conn.query(
      "SELECT * FROM promotions WHERE id=? FOR UPDATE",
      [option.id],
    );
    if (offer && valid(offer, Date.now()))
      locked.push({
        ...offer,
        discount:
          audience === "driver"
            ? money(normalFee)
            : benefit(offer, Math.min(gross, verifiedLimit)),
      });
  }
  locked.sort((a, b) => b.discount - a.discount || a.id - b.id);
  for (const offer of locked) {
    const count = await usage(conn, offer, userId);
    if (count.remaining) {
      selected = { ...offer, ...count };
      break;
    }
  }
  const quote = {
    ...publicQuote(selected, gross),
    remaining_rides: selected ? Math.max(0, selected.remaining - 1) : 0,
  };
  if (
    audience === "rider" &&
    expected &&
    (Number(expected.customer_payable) !== quote.customer_payable ||
      String(expected.offer_id || "") !== String(quote.offer_id || ""))
  )
    throw fail(
      409,
      "Your offer changed. Review the updated fare before booking again.",
    );
  if (!selected) return quote;
  await conn.query(
    "INSERT INTO ride_promotions (ride_id,offer_id,audience,actor_user_id,offer_name,discount_percent,max_discount,discount_base_limit,original_fare,benefit_amount) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      rideId,
      selected.id,
      audience,
      userId,
      selected.name,
      selected.discount_percent,
      selected.max_discount,
      verifiedLimit ?? gross,
      gross,
      selected.discount,
    ],
  );
  if (audience === "rider")
    await conn.query(
      "UPDATE ride_history SET Rider_Discount=?,Customer_Payable=?,Rider_Offer_ID=? WHERE Ride_ID_Pk=?",
      [quote.discount_amount, quote.customer_payable, selected.id, rideId],
    );
  else
    await conn.query(
      "UPDATE ride_history SET Driver_Commission_Waived=1,Driver_Offer_ID=? WHERE Ride_ID_Pk=?",
      [selected.id, rideId],
    );
  return quote;
}
async function driverBenefit(conn, driver, balance) {
  if (!enabled() || Number(balance) < 0) return null;
  if (!driver.User_ID_FK) return null;
  const [offer] = await candidates(conn, "driver", driver.User_ID_FK, 1);
  if (offer)
    return {
      offer_id: offer.id,
      offer_name: offer.name,
      remaining_rides: offer.remaining,
      ends_at_ms: Number(offer.ends_at_ms),
    };
  const [[reserved]] = await conn.query(
    "SELECT p.offer_id,p.offer_name,o.ends_at_ms FROM ride_promotions p JOIN ride_history r ON r.Ride_ID_Pk=p.ride_id JOIN promotions o ON o.id=p.offer_id WHERE p.actor_user_id=? AND p.audience='driver' AND p.state='reserved' AND r.Driver_ID_Fk=? AND r.Ride_Status IN ('Accepted','Arrived','Started','Ongoing') AND r.Driver_Commission_Waived=1 LIMIT 1",
    [driver.User_ID_FK, driver.id],
  );
  return reserved
    ? {
        offer_id: reserved.offer_id,
        offer_name: reserved.offer_name,
        remaining_rides: 0,
        ends_at_ms: Number(reserved.ends_at_ms),
        current_ride: true,
      }
    : null;
}
async function finish(conn, ride) {
  if (!ride.Rider_Offer_ID && !ride.Driver_Offer_ID) return;
  await conn.query(
    "UPDATE ride_promotions SET state='consumed' WHERE ride_id=? AND state='reserved'",
    [ride.Ride_ID_Pk],
  );
}
async function updateRiderFare(conn, ride, gross) {
  if (!Object.hasOwn(ride, "Customer_Payable")) return null;
  let discount = 0;
  if (ride.Rider_Offer_ID) {
    const [[snapshot]] = await conn.query(
      "SELECT * FROM ride_promotions WHERE ride_id=? AND audience='rider' AND state='reserved' FOR UPDATE",
      [ride.Ride_ID_Pk],
    );
    if (!snapshot)
      throw fail(409, "Offer reservation is unavailable. Please book again.");
    discount = benefit(
      snapshot,
      Math.min(gross, Number(snapshot.discount_base_limit)),
    );
    await conn.query(
      "UPDATE ride_promotions SET original_fare=?,benefit_amount=? WHERE ride_id=? AND audience='rider'",
      [gross, discount, ride.Ride_ID_Pk],
    );
  }
  await conn.query(
    "UPDATE ride_history SET Rider_Discount=?,Customer_Payable=? WHERE Ride_ID_Pk=?",
    [discount, money(gross - discount), ride.Ride_ID_Pk],
  );
  return {
    discount_amount: discount,
    customer_payable: money(gross - discount),
  };
}
async function creditRiderDiscount(conn, ride, amount) {
  if (amount === 0) return;
  const reference = `RIDER_DISCOUNT_${ride.Ride_ID_Pk}`;
  const [rows] = await conn.query(
    "SELECT amount,transaction_type,status FROM driver_wallet WHERE driver_id=? AND reference_id=? LIMIT 1",
    [ride.Driver_ID_Fk, reference],
  );
  if (rows.length) {
    if (
      rows[0].transaction_type !== "credit" ||
      rows[0].status !== "completed" ||
      money(rows[0].amount) !== amount
    )
      throw new Error("Conflicting rider discount reimbursement");
    return;
  }
  await conn.query(
    "INSERT INTO driver_wallet (driver_id,transaction_type,amount,description,reference_id,payment_method,status,created_at) VALUES (?,'credit',?,?,?,'other','completed',NOW())",
    [
      ride.Driver_ID_Fk,
      amount,
      `Rider discount reimbursement for Ride #${ride.Ride_ID_Pk}`,
      reference,
    ],
  );
}
async function personalUser(pool, claims) {
  return (
    await require("./cityToCityIdentity").resolveCityToCityIdentity(
      pool,
      claims,
    )
  ).userId;
}
module.exports = {
  personalUser,
  enabled,
  usage,
  benefit,
  riderQuote,
  reserve,
  driverBenefit,
  finish,
  updateRiderFare,
  creditRiderDiscount,
  publicQuote,
};
