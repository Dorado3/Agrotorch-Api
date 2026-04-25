/**
 * Agrotorch — Express Application Entry Point
 * ─────────────────────────────────────────────
 * Wires up all middleware, routes, and DB connection.
 * Run: node app.js  (or:  npx nodemon app.js)
 *
 * Environment variables (.env):
 *   MONGO_URI    — MongoDB connection string
 *   JWT_SECRET   — Strong random string (min 32 chars)
 *   PORT         — Server port (default 4000)
 *   APP_URL      — Frontend URL (for share links)
 *   NODE_ENV     — development | production
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

// ── Route imports ────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const affiliateRoutes = require('./routes/affiliate');

const app  = express();
const PORT = process.env.PORT || 4000;

// ════════════════════════════════════════════════════════════════════════════
// Security middleware
// ════════════════════════════════════════════════════════════════════════════
app.use(helmet());            // sets secure HTTP headers
app.use(cors({
  origin: process.env.APP_URL || 'https://greenmarket-d3ffc.web.app',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate-limit auth endpoints — prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,   // 15 minutes
  max      : 20,                // 20 requests per window per IP
  message  : { error: 'Too many requests. Please wait 15 minutes.' },
});

app.use(express.json({ limit: '10kb' }));   // body parser + size guard

// ════════════════════════════════════════════════════════════════════════════
// Routes
// ════════════════════════════════════════════════════════════════════════════
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/affiliate', affiliateRoutes);

// Health-check (useful for uptime monitors)
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

// 404 catch-all
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` }));

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[Unhandled]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

// ════════════════════════════════════════════════════════════════════════════
// MongoDB connection + server start
// ════════════════════════════════════════════════════════════════════════════
async function startServer () {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser   : true,
      useUnifiedTopology: true,
    });
    console.log('✅  MongoDB connected');

    app.listen(PORT, () =>
      console.log(`🚀  Agrotorch API running on port ${PORT}`)
    );
  } catch (err) {
    console.error('❌  DB connection failed:', err.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;   // for testing
