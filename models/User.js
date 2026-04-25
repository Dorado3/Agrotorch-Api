/**
 * Agrotorch — User Model with Affiliate & Referral System
 * ─────────────────────────────────────────────────────────
 * Stack  : Node.js / Express / Mongoose (MongoDB)
 * Model  : Dormant commissions — calculated instantly, paid out manually
 *          by admin. Zero Cloud Functions required; works on Free Tier.
 */

'use strict';

const mongoose = require('mongoose');

// ── Non-ambiguous character set ────────────────────────────────────────────
// Removes visually confusing chars: 0/O, 1/I/L
const CODE_CHARS  = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_SUFFIX = 7; // e.g. AGT-7X2P3KR  (4-char prefix + 7 suffix = 11 total)

// ── Affiliate Stats (embedded sub-document) ────────────────────────────────
const affiliateStatsSchema = new mongoose.Schema({
  totalEarnings : { type: Number, default: 0, min: 0 }, // lifetime (dormant + approved)
  totalSignups  : { type: Number, default: 0, min: 0 }, // farmers onboarded
  totalSales    : { type: Number, default: 0, min: 0 }, // qualifying transactions counted
}, { _id: false });

// ── Main User Schema ───────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    // ── Core identity ────────────────────────────────────────────────────────
    name : { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type     : String, required: true, unique: true,
      lowercase: true, trim: true,
      match    : [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'],
    },
    phone  : { type: String, trim: true },
    state  : { type: String, trim: true },
    role   : { type: String, enum: ['farmer', 'agent', 'admin'], default: 'farmer' },

    // ── Firebase UID (bridges the single-file Agrotorch PWA) ────────────────
    firebaseUid: { type: String, unique: true, sparse: true },

    // ── Referral / Affiliate ─────────────────────────────────────────────────
    /**
     * Unique code assigned at registration.
     * Agents share this link: agrotorch.ng/?ref=AGT-7X2P3KR
     * sparse:true — allows documents without a code (legacy records).
     */
    referralCode: {
      type     : String, unique: true, sparse: true,
      uppercase: true, trim: true,
    },

    /**
     * ObjectId of the Agent who referred this seller.
     * Populated during signup when a valid ?ref= code is supplied.
     * Remains null for organic sign-ups.
     */
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Flips to true after the seller's FIRST successful transaction.
     * Triggers a one-time ₦500 flat fee to the referring agent.
     * Subsequent sales only trigger the 2% percentage commission.
     */
    hasSoldBefore: { type: Boolean, default: false },

    /**
     * Commissions earned but NOT yet approved by admin.
     * Admin reviews and approves → moves to walletBalance.
     * This dormant model keeps logic entirely in Express routes;
     * no scheduled Cloud Functions or Blaze plan needed.
     */
    dormantEarnings: { type: Number, default: 0, min: 0 },

    /**
     * Admin-approved funds ready for agent withdrawal.
     * Admin manually transfers from dormantEarnings → walletBalance.
     */
    walletBalance: { type: Number, default: 0, min: 0 },

    /** Aggregate stats for the Agent Dashboard card. */
    affiliateStats: { type: affiliateStatsSchema, default: () => ({}) },
  },
  { timestamps: true } // auto-manages createdAt / updatedAt
);

// ── Compound indexes ───────────────────────────────────────────────────────
userSchema.index({ referralCode : 1 }, { unique: true, sparse: true });
userSchema.index({ referredBy   : 1 });
userSchema.index({ firebaseUid  : 1 }, { unique: true, sparse: true });

// ── Pre-save: auto-generate referral code for new users ───────────────────
userSchema.pre('save', async function (next) {
  if (!this.isNew || this.referralCode) return next();
  try {
    this.referralCode = await generateUniqueCode();
    next();
  } catch (err) {
    next(err);
  }
});

const User = mongoose.model('User', userSchema);
module.exports = User;


// ════════════════════════════════════════════════════════════════════════════
// UTILITY — Unique Referral Code Generator
// ════════════════════════════════════════════════════════════════════════════

/**
 * generateUniqueCode()
 * Generates a collision-free 7-character referral code with AGT- prefix.
 * Uses the compound index for efficient DB lookup (O log n).
 *
 * @returns {Promise<string>}  e.g. "AGT-7X2P3KR"
 * @throws  {Error}            after 10 failed attempts (expand CODE_SUFFIX then)
 */
async function generateUniqueCode () {
  let code, exists, attempts = 0;

  do {
    let suffix = '';
    for (let i = 0; i < CODE_SUFFIX; i++) {
      suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    code   = `AGT-${suffix}`;
    exists = await User.exists({ referralCode: code });

    if (++attempts > 10) {
      throw new Error(
        'generateUniqueCode: 10 collisions hit. Consider increasing CODE_SUFFIX.'
      );
    }
  } while (exists);

  return code;
}

module.exports.generateUniqueCode = generateUniqueCode;
