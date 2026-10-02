import crypto from 'crypto';
import config from '../config/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { checkAndUpdate, getInstalledSha, peekChannelUpdate, getUpdateProgress } from '../services/slicerWebUpdater.js';

const VALID_CHANNELS = new Set(['stable', 'latest']);

export default function slicerWebRoutes(app) {
    // GET /api/slicerweb/check-update?channel=latest
    // SHA-only peek (no download). Returns { upToDate, installedSha, latestSha }.
    app.get('/api/slicerweb/check-update', authenticateToken, asyncHandler(async (req, res) => {
        const channel = String(req.query.channel || 'latest').trim();
        if (!VALID_CHANNELS.has(channel)) {
            return res.status(400).json({ error: 'Invalid channel. Must be stable or latest.' });
        }
        if (channel === 'latest' && !config.slicerWeb.devModeEnabled) {
            return res.status(403).json({ error: 'Developer mode is not enabled on this server.' });
        }
        if (!config.slicerWeb.hasCredentials) {
            return res.status(503).json({ error: 'No GitHub credentials configured for SlicerWeb updates.' });
        }
        const result = await peekChannelUpdate(channel);
        res.json(result);
    }));

    // POST /api/slicerweb/check-update?channel=latest
    // Check + install if a new build is available. Returns { upToDate, updated, sha }.
    app.post('/api/slicerweb/check-update', authenticateToken, asyncHandler(async (req, res) => {
        const channel = String(req.query.channel || 'latest').trim();
        if (!VALID_CHANNELS.has(channel)) {
            return res.status(400).json({ error: 'Invalid channel. Must be stable or latest.' });
        }
        if (channel === 'latest' && !config.slicerWeb.devModeEnabled) {
            return res.status(403).json({ error: 'Developer mode is not enabled on this server.' });
        }
        if (!config.slicerWeb.hasCredentials) {
            return res.status(503).json({ error: 'No GitHub credentials configured for SlicerWeb updates.' });
        }

        const result = await checkAndUpdate(channel);
        res.json(result);
    }));

    // POST /api/slicerweb/webhook
    // GitHub push webhook — verified via HMAC-SHA256 (X-Hub-Signature-256).
    // Responds immediately; clone runs in the background.
    // Setup: repo → Settings → Webhooks, secret = SLICERWEB_WEBHOOK_SECRET, Push events only.
    app.post('/api/slicerweb/webhook', (req, res) => {
        if (!config.slicerWeb.webhookSecret) {
            return res.status(503).json({ error: 'Webhook not configured (SLICERWEB_WEBHOOK_SECRET unset).' });
        }
        if (!config.slicerWeb.hasCredentials) {
            return res.status(503).json({ error: 'No GitHub credentials configured.' });
        }

        const sig = req.headers['x-hub-signature-256'];
        if (!sig) return res.status(401).json({ error: 'Missing X-Hub-Signature-256' });
        const expected = 'sha256=' + crypto
            .createHmac('sha256', config.slicerWeb.webhookSecret)
            .update(req.body) // Buffer — express.raw captured this before express.json ran
            .digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        let payload;
        try { payload = JSON.parse(req.body.toString()); } catch {
            return res.status(400).json({ error: 'Invalid JSON payload' });
        }

        const BRANCH_TO_CHANNEL = { 'deploy/latest': 'latest', 'deploy/stable': 'stable' };
        const branch = (payload.ref || '').replace('refs/heads/', '');
        const channel = BRANCH_TO_CHANNEL[branch];
        if (!channel) return res.status(200).json({ ignored: true, reason: `Not a deploy branch: ${branch}` });

        res.json({ accepted: true, channel });
        checkAndUpdate(channel).catch(err =>
            console.warn(`[SlicerWebUpdater] Webhook-triggered update failed (${channel}):`, err.message)
        );
    });

    // GET /api/slicerweb/update-progress?channel=latest
    // Live download progress while a clone is in flight. { phase, percent, message }
    app.get('/api/slicerweb/update-progress', authenticateToken, asyncHandler(async (req, res) => {
        const channel = String(req.query.channel || 'latest').trim();
        if (!VALID_CHANNELS.has(channel)) {
            return res.status(400).json({ error: 'Invalid channel.' });
        }
        res.json(getUpdateProgress(channel));
    }));

    // GET /api/slicerweb/status — installed SHA per channel (null if not populated)
    app.get('/api/slicerweb/status', authenticateToken, asyncHandler(async (_req, res) => {
        const [stable, latest] = await Promise.all([
            getInstalledSha('stable'),
            config.slicerWeb.devModeEnabled ? getInstalledSha('latest') : Promise.resolve(null)
        ]);
        res.json({ stable, latest: config.slicerWeb.devModeEnabled ? latest : undefined });
    }));
}
