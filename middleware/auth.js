/**
 * Agrotorch — Auth Middleware
 * ────────────────────────────
 * requireAuth   — verifies JWT, attaches req.user
 * requireAdmin  — requireAuth + role === 'admin' check
 */

'use strict';

const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'replace-with-strong-secret';

async function requireAuth (req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'No token provided. Please log in.' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user    = await User.findById(payload.id).select('_id role email name').lean();

    if (!user) {
      return res.status(401).json({ error: 'User not found. Token may be stale.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

async function requireAdmin (req, res, next) {
  await requireAuth(req, res, async () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
