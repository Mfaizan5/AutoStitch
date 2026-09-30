const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { generatePreview, tryOnPreview } = require('../controllers/customerPreviewController');

// Small in-memory limiter keyed by user (falls back to IP). Image generation costs
// real money, so it is much stricter than the global limiter.
const limiter = (windowMs, max, message) => {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits) {
      if (now - data.startTime > windowMs) hits.delete(key);
    }
  }, 60 * 1000);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const key = req.user?._id?.toString() || req.ip;
    const now = Date.now();
    const record = hits.get(key);
    if (!record || now - record.startTime > windowMs) {
      hits.set(key, { count: 1, startTime: now });
      return next();
    }
    record.count++;
    if (record.count > max) return res.status(429).json({ success: false, message });
    next();
  };
};

const previewLimiter = limiter(15 * 60 * 1000, 8, 'You have generated a lot of previews. Please wait a few minutes and try again.');
const tryOnLimiter = limiter(15 * 60 * 1000, 10, 'Too many try-on requests. Please wait a few minutes and try again.');

router.post('/', protect, previewLimiter, generatePreview);
router.post('/try-on', protect, tryOnLimiter, tryOnPreview);

module.exports = router;