const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Reading company info (name/logo/business-day/loyalty rates) is needed by every role
// just to render the UI; only changing it is admin-only.
router.get('/company', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM companies ORDER BY created_at LIMIT 1');
  res.json(rows[0] || null);
}));

router.put('/company', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, vatNumber, phone, address, logo, businessDayStartHour, loyaltyRiyalPerPoint, loyaltyPointValue, currencyDenominations } = req.body;
  const { rows: existing } = await pool.query('SELECT * FROM companies ORDER BY created_at LIMIT 1');
  const current = existing[0] || {};
  const startHour = businessDayStartHour !== undefined
    ? Math.min(23, Math.max(0, Number(businessDayStartHour) || 0))
    : (current.business_day_start_hour ?? 6);
  const riyalPerPoint = loyaltyRiyalPerPoint !== undefined ? Number(loyaltyRiyalPerPoint) || 10 : (current.loyalty_riyal_per_point ?? 10);
  const pointValue = loyaltyPointValue !== undefined ? Number(loyaltyPointValue) || 0.5 : (current.loyalty_point_value ?? 0.5);
  const denominations = currencyDenominations !== undefined ? currencyDenominations : (current.currency_denominations ?? [500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25]);

  let row;
  if (existing[0]) {
    const { rows } = await pool.query(
      `UPDATE companies SET name=$1, vat_number=$2, phone=$3, address=$4, logo=$5, business_day_start_hour=$6,
         loyalty_riyal_per_point=$7, loyalty_point_value=$8, currency_denominations=$9, updated_at=now() WHERE id=$10 RETURNING *`,
      [name, vatNumber, phone, address, logo, startHour, riyalPerPoint, pointValue, JSON.stringify(denominations), existing[0].id]
    );
    row = rows[0];
  } else {
    const { rows } = await pool.query(
      `INSERT INTO companies (name, vat_number, phone, address, logo, business_day_start_hour, loyalty_riyal_per_point, loyalty_point_value, currency_denominations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, vatNumber, phone, address, logo, startHour, riyalPerPoint, pointValue, JSON.stringify(denominations)]
    );
    row = rows[0];
  }
  res.json(row);
}));

module.exports = router;
