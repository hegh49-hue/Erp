const express = require('express');
const { pool } = require('../db/pool');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/company', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM companies ORDER BY created_at LIMIT 1');
  res.json(rows[0] || null);
}));

router.put('/company', asyncHandler(async (req, res) => {
  const { name, vatNumber, phone, address, logo } = req.body;
  const { rows: existing } = await pool.query('SELECT id FROM companies ORDER BY created_at LIMIT 1');
  let row;
  if (existing[0]) {
    const { rows } = await pool.query(
      `UPDATE companies SET name=$1, vat_number=$2, phone=$3, address=$4, logo=$5, updated_at=now() WHERE id=$6 RETURNING *`,
      [name, vatNumber, phone, address, logo, existing[0].id]
    );
    row = rows[0];
  } else {
    const { rows } = await pool.query(
      `INSERT INTO companies (name, vat_number, phone, address, logo) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, vatNumber, phone, address, logo]
    );
    row = rows[0];
  }
  res.json(row);
}));

module.exports = router;
