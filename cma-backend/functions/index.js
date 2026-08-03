const { onRequest } = require('firebase-functions/v2/https');
const { computeAll } = require('./engine');
// trigger deploy
// This function receives the raw form data (state) from the CMA Studio app,
// runs the full calculation engine here on the server, and returns only the
// computed results. The formulas themselves never leave this server, so they
// cannot be extracted from the app / APK on a user's device.
exports.calculateCMA = onRequest(
  {
    cors: true, // allows the browser-based app to call this function directly
    region: 'asia-south1', // Mumbai — closest region for India-based users; change if needed
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Use POST' });
      return;
    }
    try {
      const state = req.body;
      if (!state || typeof state !== 'object') {
        res.status(400).json({ success: false, error: 'Missing or invalid request body' });
        return;
      }
      const computed = computeAll(state);
      res.status(200).json({ success: true, computed });
    } catch (e) {
      console.error('CMA calculation error:', e);
      res.status(400).json({ success: false, error: e.message || 'Calculation failed' });
    }
  }
);
