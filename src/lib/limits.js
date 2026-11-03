'use strict';
// In-memory rate limits. For several app instances behind a load balancer, give
// express-rate-limit a shared store (for example rate-limit-redis).
const rateLimit = require('express-rate-limit');

const make = (windowMin, limit, message) => rateLimit({
  windowMs: windowMin * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.DISABLE_RATE_LIMIT === '1',
  handler: (req, res) => {
    res.status(429);
    if (req.path.startsWith('/api/') || req.xhr) return res.json({ ok: false, message });
    res.render('store/error', { title: 'Slow down', status: 429, message });
  },
});

module.exports = {
  auth: make(15, 20, 'Too many sign in attempts. Wait 15 minutes and try again.'),
  checkout: make(10, 30, 'Too many checkout attempts. Wait a few minutes and try again.'),
  forms: make(10, 15, 'Too many submissions. Wait a few minutes and try again.'),
  api: make(1, 120, 'Too many requests. Slow down a little.'),
};
