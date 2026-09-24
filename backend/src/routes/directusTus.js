import config from '../config/index.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserTokenCached } from '../auth/directusUserSession.js';
import { createTusProxyHandler, TUS_PROXY_PATH } from '../services/tusProxy.js';

/**
 * Mount the Directus resumable-upload proxy (services/tusProxy.js) behind the same auth as the other
 * Cases routes. Chunk requests use the cached Directus token, not a refresh per request.
 */
export default function directusTusRoutes(app) {
    if (!config.directus.casesEnabled) return;

    const collabAuth = [authenticateToken, requireDirectusLink, requireDirectusUserTokenCached];
    const handler = asyncHandler(createTusProxyHandler({ directusUrl: config.directus.url }));
    app.all(TUS_PROXY_PATH, ...collabAuth, handler);
    app.all(`${TUS_PROXY_PATH}/:uploadId`, ...collabAuth, handler);
}
