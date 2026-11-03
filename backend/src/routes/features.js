import config from '../config/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPublicAuthConfig } from '../auth/index.js';

export default function featuresRoutes(app) {
    app.get('/api/features', asyncHandler(async (_req, res) => {
        res.json({
            /** Case signup invite email delivery (SMTP). Copy-link works either way. */
            inviteEmail: Boolean(config.mail?.enabled && config.mail?.host),
            /** Allow users to opt into the SlicerWeb latest channel from Settings. */
            slicerWebDevMode: Boolean(config.slicerWeb.devModeEnabled && config.slicerWeb.hasCredentials),
            /** Set ENABLE_MY_FILES=false to hide My Files from the sidebar. Default: true. */
            myFiles: Boolean(config.myFiles.enabled),
            auth: getPublicAuthConfig()
        });
    }));
}
