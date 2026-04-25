/**
 * Agrotorch — Commission Processing Engine
 * ─────────────────────────────────────────
 * Called server-side after every confirmed sale.
 * Requires NO Cloud Functions — runs in your Express route handler.
 *
 * Commission structure:
 *   • First sale flat fee : ₦500  (one-time per seller)
 *   • Recurring %         : 2 %   of transaction amount
 *
 * All earnings go to dormantEarnings first.
 * Admin approves → walletBalance (manual payout workflow).
 */

'use strict';

const User = require('../models/User');

// ── Commission constants ────────────────────────────────────────────────────
const FLAT_FEE_NAIRA      = 500;   // ₦500 one-time for agent on seller's first sale
const PERCENTAGE_RATE     = 0.02;  // 2 % of transaction amount
const MIN_AMOUNT_FOR_PCT  = 100;   // ignore tiny test transactions (< ₦100)

// ────────────────────────────────────────────────────────────────────────────
/**
 * processCommission(sellerId, amount)
 *
 * Finds the Agent who referred `sellerId`, then applies:
 *   1. ₦500 flat fee on the seller's FIRST sale (hasSoldBefore === false)
 *   2. 2 % of `amount` on every sale
 *
 * Both increments are applied in a SINGLE atomic $inc to prevent
 * race conditions under concurrent requests (MongoDB guarantees atomicity
 * at the document level).
 *
 * @param {string|ObjectId} sellerId  - Mongo _id of the seller (farmer)
 * @param {number}          amount    - Confirmed transaction amount in ₦
 * @returns {Promise<{
 *   agentId        : string | null,
 *   flatFee        : number,
 *   percentageFee  : number,
 *   totalCommission: number,
 *   isFirstSale    : boolean,
 * }>}
 */
async function processCommission (sellerId, amount) {
  // ── Guard: amount must be a positive number ──────────────────────────────
  if (!amount || typeof amount !== 'number' || amount < MIN_AMOUNT_FOR_PCT) {
    console.warn(`[Commission] Skipped — amount too small or invalid: ₦${amount}`);
    return { agentId: null, flatFee: 0, percentageFee: 0, totalCommission: 0, isFirstSale: false };
  }

  // ── Step 1: Fetch the seller ─────────────────────────────────────────────
  const seller = await User.findById(sellerId).select('referredBy hasSoldBefore name').lean();

  if (!seller) {
    console.warn(`[Commission] Seller not found: ${sellerId}`);
    return { agentId: null, flatFee: 0, percentageFee: 0, totalCommission: 0, isFirstSale: false };
  }

  if (!seller.referredBy) {
    // Organic signup — no agent to credit
    console.log(`[Commission] Seller ${seller.name || sellerId} has no referrer. Skipping.`);
    // Still flip hasSoldBefore if it was their first sale
    if (!seller.hasSoldBefore) {
      await User.findByIdAndUpdate(sellerId, { $set: { hasSoldBefore: true } });
    }
    return { agentId: null, flatFee: 0, percentageFee: 0, totalCommission: 0, isFirstSale: !seller.hasSoldBefore };
  }

  // ── Step 2: Calculate commission ─────────────────────────────────────────
  const isFirstSale    = !seller.hasSoldBefore;
  const flatFee        = isFirstSale ? FLAT_FEE_NAIRA : 0;
  const percentageFee  = Math.round(amount * PERCENTAGE_RATE); // round to whole naira
  const totalCommission = flatFee + percentageFee;

  // ── Step 3: Atomic update — agent's earnings ──────────────────────────────
  // $inc on dormantEarnings, affiliateStats.totalEarnings, affiliateStats.totalSales
  // All in one findByIdAndUpdate call → MongoDB guarantees atomicity on a single doc
  await User.findByIdAndUpdate(
    seller.referredBy,
    {
      $inc: {
        dormantEarnings               : totalCommission,
        'affiliateStats.totalEarnings': totalCommission,
        'affiliateStats.totalSales'   : 1,
      },
    },
    { new: false } // we don't need the returned doc; saves a round-trip copy
  );

  // ── Step 4: Flip hasSoldBefore on the seller (if first sale) ─────────────
  if (isFirstSale) {
    await User.findByIdAndUpdate(sellerId, { $set: { hasSoldBefore: true } });
  }

  console.log(
    `[Commission] Agent ${seller.referredBy} ← ₦${totalCommission} ` +
    `(flat:₦${flatFee} + ${PERCENTAGE_RATE*100}%:₦${percentageFee}) ` +
    `for seller ${seller.name || sellerId}`
  );

  return {
    agentId        : seller.referredBy.toString(),
    flatFee,
    percentageFee,
    totalCommission,
    isFirstSale,
  };
}

// ────────────────────────────────────────────────────────────────────────────
/**
 * approveEarnings(agentId, amount)
 *
 * Admin-only: Moves `amount` from dormantEarnings → walletBalance.
 * Called manually from the admin dashboard after payout verification.
 *
 * @param {string|ObjectId} agentId
 * @param {number}          amount   Amount in ₦ to approve (≤ dormantEarnings)
 * @returns {Promise<{ dormantEarnings: number, walletBalance: number }>}
 */
async function approveEarnings (agentId, amount) {
  if (!amount || amount <= 0) throw new Error('Approval amount must be > 0');

  const agent = await User.findById(agentId).select('dormantEarnings walletBalance name');
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  if (amount > agent.dormantEarnings) {
    throw new Error(
      `Approval amount (₦${amount}) exceeds dormant balance (₦${agent.dormantEarnings})`
    );
  }

  const updated = await User.findByIdAndUpdate(
    agentId,
    {
      $inc: {
        dormantEarnings: -amount,   // subtract from pending
        walletBalance  : +amount,   // add to approved
      },
    },
    { new: true, select: 'dormantEarnings walletBalance' }
  );

  console.log(`[Commission] Admin approved ₦${amount} for agent ${agent.name || agentId}`);
  return updated;
}

module.exports = { processCommission, approveEarnings };
