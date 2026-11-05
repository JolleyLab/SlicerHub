/**
 * Authorization check for viewer traffic proxied by nginx (Full Slicer noVNC seats,
 * Trame sessions). nginx calls this through `auth_request` before every request and
 * WebSocket upgrade to a viewer container; 2xx lets the request through, 401/403 block it.
 *
 * nginx passes the normalized request path (its $uri, the same value its location regexes
 * matched) in X-Viewer-URI. Calling this endpoint directly is harmless: it only answers
 * whether the caller's own session may open that path.
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { getSession } from '../sessions/leaseRegistry.js';
import { SESSION_KINDS } from '../sessions/kinds.js';

/**
 * Decide whether `user` may reach the viewer at `uri`.
 * Mirrors the container-name construction in nginx/default.conf.
 *
 * @param {string} uri      Normalized request path (no query string)
 * @param {{ id: string|number, role?: string }} user
 * @param {{ getTrameSession?: (userId: string) => any }} [deps]
 * @returns {boolean}
 */
export function isViewerPathAllowed(uri, user, { getTrameSession } = {}) {
    if (!user || user.id == null) return false;
    const userId = String(user.id);
    const path = String(uri || '');

    // /slicer-gui/user-{X}/...  → container slicer-gui-{X}; X is {userId} or {userId}-seat{n}
    const seat = /^\/slicer-gui\/user-([^/]+)(?:\/.*)?$/.exec(path);
    if (seat) {
        const target = seat[1];
        return target === userId
            || (target.startsWith(`${userId}-seat`) && /^[0-9]+$/.test(target.slice(userId.length + 5)));
    }

    // /trame-session/user-{X}/... → container trame-session-{X}
    const trame = /^\/trame-session\/user-([^/]+)(?:\/.*)?$/.exec(path);
    if (trame) {
        return trame[1] === userId;
    }

    // /trame-session-port/{port}/... → the port of the caller's own Trame session
    const port = /^\/trame-session-port\/([0-9]+)(?:\/.*)?$/.exec(path);
    if (port) {
        const lookup = getTrameSession || ((id) => getSession(SESSION_KINDS.TRAME, id));
        const session = lookup(userId);
        const owned = Number(session?.metadata?.sessionPort);
        return Number.isInteger(owned) && owned === Number(port[1]);
    }

    // Shared debug desktop (/slicer-gui/...) and legacy single Trame (/trame/...): admins only.
    if (path === '/slicer-gui' || path.startsWith('/slicer-gui/')
        || path === '/trame' || path.startsWith('/trame/')) {
        return user.role === 'admin';
    }

    return false;
}

export default function viewerAuthRoutes(app) {
    app.get('/api/internal/viewer-auth', authenticateToken, (req, res) => {
        const uri = String(req.get('x-viewer-uri') || '');
        res.set('Cache-Control', 'no-store');
        res.status(isViewerPathAllowed(uri, req.user) ? 204 : 403).end();
    });
}
