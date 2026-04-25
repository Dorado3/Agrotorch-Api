/**
 * Agrotorch — Affiliate & Commission Routes
 * ──────────────────────────────────────────
 * GET  /api/affiliate/me            — Agent's own dashboard data
 * GET  /api/affiliate/leaderboard   — Top agents by earnings
 * POST /api/affiliate/transaction   — Called after confirmed sale (internal)
 * POST /api/affiliate/approve       — Admin approves dormant earnings
 * GET  /api/affiliate/agents        — Admin: list all agents + stats
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const { processCommission, approveEarnings } = require('../utils/commission');

// ── Auth middleware (attach to req.user) ────────────────────────────────────
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ════════════════════════════════════════════════════════════════════════════
// GET /api/affiliate/me
// Returns the authenticated agent's full affiliate dashboard data.
// ════════════════════════════════════════════════════════════════════════════
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('name email role referralCode dormantEarnings walletBalance affiliateStats')
      .lean();

    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Build the share link dynamically
    const baseUrl   = process.env.APP_URL || 'https://greenmarket-d3ffc.web.app';
    const shareLink = `${baseUrl}/?ref=${user.referralCode}`;

    return res.json({
      agent    : user,
      shareLink,
      summary: {
        dormantEarnings : user.dormantEarnings,
        walletBalance   : user.walletBalance,
        totalEarnings   : user.affiliateStats?.totalEarnings   || 0,
        totalSignups    : user.affiliateStats?.totalSignups    || 0,
        totalSales      : user.affiliateStats?.totalSales      || 0,
      },
    });
  } catch (err) {
    console.error('[GET /affiliate/me]', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/affiliate/leaderboard
// Top 20 agents by total earnings — public or internal use.
// ════════════════════════════════════════════════════════════════════════════
router.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    const agents = await User.find({ role: 'agent' })
      .select('name state affiliateStats referralCode')
      .sort({ 'affiliateStats.totalEarnings': -1 })
      .limit(20)
      .lean();

    return res.json({ leaderboard: agents });
  } catch (err) {
    console.error('[GET /affiliate/leaderboard]', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/affiliate/transaction
// Internal route called by your checkout / order-confirmed handler.
// Should NOT be exposed publicly — protect with requireAuth or an API secret.
//
// Body: { sellerId: "mongo_id", amount: 25000 }
// ════════════════════════════════════════════════════════════════════════════
router.post('/transaction', requireAuth, async (req, res) => {
  try {
    const { sellerId, amount } = req.body;

    if (!sellerId || !amount) {
      return res.status(400).json({ error: 'sellerId and amount are required.' });
    }

    const result = await processCommission(sellerId, Number(amount));

    return res.json({
      message : 'Commission processed.',
      result,
    });
  } catch (err) {
    console.error('[POST /affiliate/transaction]', err.message);
    res.status(500).json({ error: 'Commission processing failed: ' + err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/affiliate/approve                      [ADMIN ONLY]
// Moves dormantEarnings → walletBalance for a specific agent.
// Admin verifies proof of payout (bank transfer, etc.) then calls this.
//
// Body: { agentId: "mongo_id", amount: 5000 }
// ════════════════════════════════════════════════════════════════════════════
router.post('/approve', requireAdmin, async (req, res) => {
  try {
    const { agentId, amount } = req.body;

    if (!agentId || !amount) {
      return res.status(400).json({ error: 'agentId and amount are required.' });
    }

    const updated = await approveEarnings(agentId, Number(amount));

    return res.json({
      message        : `₦${amount} approved for agent ${agentId}.`,
      dormantEarnings: updated.dormantEarnings,
      walletBalance  : updated.walletBalance,
    });
  } catch (err) {
    console.error('[POST /affiliate/approve]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/affiliate/agents                        [ADMIN ONLY]
// Full agent list with stats — for admin panel.
// ════════════════════════════════════════════════════════════════════════════
router.get('/agents', requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip  = (page - 1) * limit;

    const [agents, total] = await Promise.all([
      User.find({ role: 'agent' })
        .select('name email phone state referralCode dormantEarnings walletBalance affiliateStats createdAt')
        .sort({ 'affiliateStats.totalEarnings': -1 })
        .skip(skip).limit(limit).lean(),
      User.countDocuments({ role: 'agent' }),
    ]);

    return res.json({ agents, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[GET /affiliate/agents]', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
