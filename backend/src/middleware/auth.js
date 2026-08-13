const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية' });
  }
}

/**
 * Role gate. admin=everything, accountant=accounting+reports only,
 * cashier=POS+their own shift only. Use after requireAuth.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'لا تملك صلاحية الوصول لهذه الشاشة' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
