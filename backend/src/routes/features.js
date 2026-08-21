import config from '../config/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isDirectusConfigured } from '../services/directus.js';
import { getPublicAuthConfig } from '../auth/index.js';

export default function featuresRoutes(app) {
    /**
     * Public feature flags for the SPA (no secrets).
     * Cases requires both the env flag and Directus credentials on the server.
     */
    app.get('/api/features', asyncHandler(async (_req, res) => {
        res.json({
            directusCases: config.directus.casesEnabled && isDirectusConfigured(),
            auth: getPublicAuthConfig()
        });
    }));
}
