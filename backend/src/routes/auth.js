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

router.put('/me', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newEmail, newPassword, confirmPassword } = req.body;
  if (!currentPassword) throw new ApiError(400, 'كلمة المرور الحالية مطلوبة');
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'المستخدم غير موجود');
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw new ApiError(403, 'كلمة المرور الحالية غير صحيحة');

  let passwordHash = user.password_hash;
  if (newPassword || confirmPassword) {
    if (newPassword !== confirmPassword) throw new ApiError(400, 'كلمة المرور الجديدة غير مطابقة للتأكيد');
    if (newPassword.length < 8) throw new ApiError(400, 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
    passwordHash = await bcrypt.hash(newPassword, 10);
  }
  const email = newEmail?.trim() || user.email;

  try {
    const { rows: updated } = await pool.query(
      'UPDATE users SET email = $1, password_hash = $2 WHERE id = $3 RETURNING id, email, full_name, role',
      [email, passwordHash, user.id]
    );
    res.json({ user: updated[0] });
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'البريد الإلكتروني مستخدم من حساب آخر');
    throw err;
  }
}));

module.exports = router;
