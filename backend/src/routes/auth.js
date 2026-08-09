const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { asyncHandler, ApiError } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(400, 'البريد وكلمة المرور مطلوبان');
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active', [email]);
  const user = rows[0];
  if (!user) throw new ApiError(401, 'بيانات الدخول غير صحيحة');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new ApiError(401, 'بيانات الدخول غير صحيحة');
  const token = jwt.sign(
    { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
  res.json({ token, user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role } });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
