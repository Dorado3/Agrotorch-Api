/**
 * Agrotorch — Authentication Routes
 * ───────────────────────────────────
 * POST /api/auth/register  — new user signup with optional referral code
 * POST /api/auth/login     — email + password login
 *
 * Security highlights:
 *   • Self-referral prevention: code owner cannot use their own code
 *   • Code validation: code must exist and belong to a real agent
 *   • Password hashed with bcrypt (salt rounds = 12)
 *   • JWT issued on success (7-day expiry)
 */

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const router   = express.Router();
const User     = require('../models/User');

const JWT_SECRET  = process.env.JWT_SECRET  || 'replace-with-strong-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const SALT_ROUNDS = 12;

// ── Helper: sign JWT ────────────────────────────────────────────────────────
function signToken (userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ── Helper: safe user response (strip sensitive fields) ─────────────────────
function safeUser (user) {
  const u = user.toObject();
  delete u.passwordHash;
  return u;
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/register
// ════════════════════════════════════════════════════════════════════════════
/**
 * Body:
 * {
 *   name        : "Emeka Adeyemi",
 *   email       : "emeka@farm.ng",
 *   password    : "Str0ngPass!",
 *   phone       : "08012345678",     // optional
 *   state       : "Ogun",            // optional
 *   role        : "farmer",          // farmer | agent | (admin blocked)
 *   referralCode: "AGT-7X2P3KR"     // optional — agent's code
 * }
 */
router.post('/register', async (req, res) => {
  try {
    const {
      name, email, password, phone,
      state, role, referralCode,
    } = req.body;

    // ── Validate required fields ───────────────────────────────────────────
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    // ── Prevent admin self-assignment via API ──────────────────────────────
    const assignedRole = role === 'admin' ? 'farmer' : (role || 'farmer');

    // ── Check email uniqueness ─────────────────────────────────────────────
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // ── Resolve referral code (if provided) ────────────────────────────────
    let referrer = null;

    if (referralCode && referralCode.trim()) {
      const code = referralCode.trim().toUpperCase();

      // Find the agent who owns this code
      referrer = await User.findOne({ referralCode: code }).select('_id email role');

      if (!referrer) {
        return res.status(400).json({ error: `Referral code "${code}" is invalid.` });
      }

      // ── SELF-REFERRAL PREVENTION ────────────────────────────────────────
      // Check by email (catches the obvious case) and by DB id
      if (
        referrer.email.toLowerCase() === email.toLowerCase().trim() ||
        referrer._id.toString() === existing?._id?.toString()
      ) {
        return res.status(400).json({ error: 'You cannot use your own referral code.' });
      }
    }

    // ── Hash password ──────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // ── Create user ────────────────────────────────────────────────────────
    const newUser = await User.create({
      name       : name.trim(),
      email      : email.toLowerCase().trim(),
      passwordHash,                                  // add this field to schema if needed
      phone      : phone?.trim() || undefined,
      state      : state?.trim() || undefined,
      role       : assignedRole,
      referredBy : referrer ? referrer._id : null,
    });

    // ── Increment agent's totalSignups atomically ──────────────────────────
    if (referrer) {
      await User.findByIdAndUpdate(referrer._id, {
        $inc: { 'affiliateStats.totalSignups': 1 },
      });
    }

    // ── Issue JWT ──────────────────────────────────────────────────────────
    const token = signToken(newUser._id);

    return res.status(201).json({
      message : 'Account created successfully. Welcome to Agrotorch!',
      token,
      user    : safeUser(newUser),
    });

  } catch (err) {
    // Duplicate key on referralCode (race condition — extremely rare)
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate entry. Please try again.' });
    }
    console.error('[/register]', err.message);
    return res.status(500).json({ error: 'Server error. Please try again later.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // ++ add passwordHash to userSchema select if using this route
    const user = await User.findOne({ email: email.toLowerCase().trim() })
                           .select('+passwordHash');
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = signToken(user._id);
    return res.json({
      message: 'Logged in successfully.',
      token,
      user   : safeUser(user),
    });

  } catch (err) {
    console.error('[/login]', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
