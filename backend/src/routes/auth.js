import {
    authenticateToken
} from '../middleware/authMiddleware.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
    getPublicAuthConfig,
    getAuthProviderName,
    logoutCurrentSession,
    logoutAllSessions
} from '../auth/index.js';
import { issueAppSession } from '../auth/session.js';
import { getKeycloakUser, updateKeycloakUserProfile, getRegistrationAttributes } from '../services/keycloakAdmin.js';
import { sendRegistrationReceivedEmail } from '../services/mail.js';
import { requireAllowedWebOrigin } from '../auth/originCheck.js';
import { recordAuthEvent } from '../auth/auditLog.js';
import config from '../config/index.js';
import { msg } from '../i18n/index.js';
import express from 'express';
import multer from 'multer';
import {
    beginLogin, completeLogin, buildLogoutUrl, verifyLogoutToken,
    txCookieName, TX_COOKIE_PREFIX, LEGACY_TX_COOKIE, MAX_TX_COOKIES,
} from '../auth/oidc.js';
import { authCookieOptions } from '../auth/session.js';
import { encryptTokenPayload, decryptTokenPayload } from '../auth/tokenCrypto.js';
import {
    getSessionOidc, deleteSessionsByKcSid, decodeToken, deleteSession,
    touchSessionActivity, clearSessionProcedure,
} from '../middleware/authMiddleware.js';
import { procedureModeSettings, resolveProcedureRequest, procedureIntentFromQuery } from '../auth/procedureMode.js';
import jwtLib from 'jsonwebtoken';

/**
 * Answer for a sign-in done in a popup (re-sign-in without leaving the page, or
 * confirming procedure mode): tell the opener, then close. The message carries no
 * secrets; the opener checks the origin.
 */
function sendPopupResult(res, { ok, code = null }) {
    const origin = (() => { try { return new URL(config.publicAppUrl).origin; } catch { return '*'; } })();
    const message = JSON.stringify({ type: 'slicerhub:signed-in', ok, code });
    const text = ok ? 'You are signed in. You can close this window.' : 'Sign-in did not complete. You can close this window and try again.';
    res.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>SlicerHub sign-in</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;padding:24px;color:#040316;background:#ecf4f9">
<p>${text}</p>
<script>
try { if (window.opener) window.opener.postMessage(${message}, ${JSON.stringify(origin)}); } catch (e) {}
window.close();
</script>
</body></html>`);
}

/** Procedure mode of the session the browser holds, if still running; else null. */
function currentCookieSessionProcedure(req) {
    const raw = req.cookies?.token;
    const jti = raw ? decodeToken(raw)?.jti : null;
    const { procedureUntil, procedureOpenEnded } = getSessionOidc(jti);
    if (!procedureUntil || Date.parse(procedureUntil) <= Date.now()) return null;
    return { procedureUntil, procedureOpenEnded };
}

/** End the session the browser currently holds (a new sign-in replaces it). */
function endCurrentCookieSession(req) {
    const raw = req.cookies?.token;
    const jti = raw ? decodeToken(raw)?.jti : null;
    if (jti) deleteSession(jti);
}
import { forgetAccount } from '../auth/accountRefresh.js';
import { isAppUserGateReady } from '../services/appUserGate.js';
import { ensureAccountRequest } from '../services/registrationRequestStore.js';
import { notifyNewRequest } from '../services/registrationGroupNotifier.js';
import { getPayloadClient } from '../payload/index.js';

/**
 * Invitees set up their account through Keycloak's emailed link, which the app isn't
 * told about; the first time they sign in, their signup invites become accepted.
 * Checked once per user per backend process.
 */
const invitesSettled = new Set();
async function acceptSignupInvitesOnFirstSignIn(kcSub) {
    if (!kcSub || invitesSettled.has(kcSub)) return;
    const payload = getPayloadClient();
    if (!payload) return;
    await payload.update({
        collection: 'case-invites',
        where: {
            and: [
                { keycloak_user_id: { equals: kcSub } },
                { status: { in: ['pending_signup', 'expired'] } },
            ],
        },
        data: { status: 'accepted' },
    });
    invitesSettled.add(kcSub);
}
import heicConvert from 'heic-convert';
import { isUserInCapabilityGroup, CAPABILITIES } from '../services/groupCapabilities.js';
import { getPreferencesByKcSub, updatePreferencesByKcSub, hasCustomPreferences } from '../services/payloadPreferences.js';
import storage from '../storage/index.js';
import { findAvatarKey, forgetAvatar } from '../services/avatars.js';
import { IMAGE_MIME, sniffImageType, sendStoredImage } from '../utils/storedImage.js';

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});


function publicUser(user) {
    const firstName = String(user?.firstName || user?.first_name || '').trim() || null;
    const lastName = String(user?.lastName || user?.last_name || '').trim() || null;
    const preferredName = String(user?.preferredName || '').trim() || null;
    const email = String(user?.email || '').trim() || null;
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return {
        id: user.id,
        username: user.username,
        email,
        firstName,
        lastName,
        preferredName,
        displayName: preferredName || fullName || email || String(user?.username || '').trim() || 'Guest',
        role: user.role,
        preferences: user.preferences,
        avatarUrl: user.avatarUrl || null
    };
}

export default function authRoutes(app) {
    /**
     * Public auth UI flags (provider, registration, identity labels).
     */
    app.get('/api/auth/config', asyncHandler(async (_req, res) => {
        res.json(getPublicAuthConfig());
    }));

    /** Update display name. Body: { firstName, lastName, preferredName? } */
    app.put(
        '/api/auth/profile',
        requireAllowedWebOrigin,
        authenticateToken,
        asyncHandler(async (req, res) => {
            const firstName     = String(req.body?.firstName    || req.body?.first_name    || '').trim();
            const lastName      = String(req.body?.lastName     || req.body?.last_name     || '').trim();
            const preferredName = String(req.body?.preferredName ?? '').trim().slice(0, 80);
            if (!firstName) throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
            if (!lastName)  throw new ValidationError(msg('auth.last_name_required'),  null, 'auth.last_name_required');

            // The account is the signed-in Keycloak user (app user id = Keycloak sub).
            // Not the old SQLite users table: accounts created since the migration aren't in it.
            const kcSub = req.user.keycloakSub;
            if (!kcSub) throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');

            await updateKeycloakUserProfile(kcSub, { firstName, lastName, preferredName });
            const kcUser = await getKeycloakUser(kcSub).catch(() => null);

            // Re-issue the session so the new name is in the token; same sign-in time,
            // Keycloak link, procedure mode and approval state.
            const { user: updatedUser } = issueAppSession(req, res, {
                id: req.user.id,
                username: req.user.username,
                role: req.user.role,
                approved: req.user.approved,
                keycloakSub: kcSub,
                email: kcUser?.email || null,
                firstName,
                lastName,
            });
            return res.json({ user: publicUser({ ...updatedUser, preferredName: preferredName || null }) });
        })
    );

    // ── Sign-in (Keycloak's sign-in page; the only way in) ──────────────────
    // docs/redirect-login-and-sessions-design.md ("Login flow").

    const txCookieOptions = (maxAge) => ({
        httpOnly: true,
        secure: authCookieOptions().secure,
        // Lax: the cookie must come back on the top-level redirect from Keycloak.
        sameSite: 'lax',
        path: '/api/auth',
        ...(maxAge != null ? { maxAge } : {}),
    });

    /**
     * Sign-ins already in progress in this browser beyond the newest MAX_TX_COOKIES - 1
     * are dropped (each lasts 10 minutes anyway), so a stuck page can't pile up cookies.
     */
    function dropOldSignIns(req, res) {
        const inProgress = Object.keys(req.cookies || {})
            .filter((name) => name.startsWith(TX_COOKIE_PREFIX))
            .map((name) => ({ name, iat: Number(jwtLib.decode(req.cookies[name])?.iat) || 0 }))
            .sort((a, b) => b.iat - a.iat);
        for (const { name } of inProgress.slice(MAX_TX_COOKIES - 1)) res.clearCookie(name, txCookieOptions());
        if (req.cookies?.[LEGACY_TX_COOKIE]) res.clearCookie(LEGACY_TX_COOKIE, txCookieOptions());
    }

    /**
     * Starting procedure mode and changing the password act on the signed-in account,
     * so they need a live session; the account that signs in at Keycloak must be it.
     */
    const needsSignedInAccount = (query) => Boolean(query.procedure) || query.action === 'password';
    function requireSessionForAccountActions(req, res, next) {
        if (!needsSignedInAccount(req.query)) return next();
        authenticateToken(req, res, (err) => {
            if (!err) return next();
            if (req.query.popup === '1') return sendPopupResult(res, { ok: false, code: 'login_expired' });
            return next(err);
        });
    }

    /**
     * Start sign-in: GET /api/auth/login/start?returnTo=/path → 302 to Keycloak.
     *   popup=1                      sign in in a popup window (keeps the page and unsaved work)
     *   procedure=<hours>|open&ack=1 start procedure mode (always asks for the password)
     *   action=password              change the password on Keycloak's page
     */
    app.get('/api/auth/login/start', requireSessionForAccountActions, asyncHandler(async (req, res) => {
        const popup = req.query.popup === '1';
        const procedure = procedureIntentFromQuery(req.query);
        if (procedure) resolveProcedureRequest(procedure); // validate now, apply at the callback
        let started;
        try {
            started = await beginLogin({
                returnTo: req.query.returnTo,
                popup,
                forceReauth: Boolean(procedure) || req.query.reauth === '1',
                procedure,
                action: req.query.action === 'password' ? 'password' : null,
                expectSub: needsSignedInAccount(req.query) ? req.user?.keycloakSub : null,
            });
        } catch (err) {
            // Keycloak unreachable: a page the person can read, not a JSON error.
            console.warn('[auth] Could not start sign-in:', err?.message);
            res.set('Cache-Control', 'no-store');
            if (popup) return sendPopupResult(res, { ok: false, code: 'login_unavailable' });
            return res.redirect(302, '/?login_error=login_unavailable');
        }
        dropOldSignIns(req, res);
        res.cookie(started.txCookieName, started.txCookie, txCookieOptions(started.txMaxAgeMs));
        res.set('Cache-Control', 'no-store');
        res.redirect(302, started.url);
    }));

    /** Keycloak returns here with ?code&state (or ?error). */
    app.get('/api/auth/callback', asyncHandler(async (req, res) => {
        // This sign-in's own cookie (another tab may have its own sign-in in progress).
        const cookieName = txCookieName(req.query.state);
        const txCookie = cookieName ? req.cookies?.[cookieName] : undefined;
        // Only to choose how to answer (page vs popup); completeLogin verifies the cookie.
        const wantsPopup = jwtLib.decode(txCookie || '')?.popup === true;
        if (cookieName) res.clearCookie(cookieName, txCookieOptions());
        res.set('Cache-Control', 'no-store');
        let result;
        let procedure = null;
        try {
            result = await completeLogin({ query: req.query, txCookie });
            if (result.procedure) procedure = resolveProcedureRequest(result.procedure);
        } catch (err) {
            // Keycloak keeps the login events (decision 6); the app log only says why.
            const code = err?.code && String(err.code).startsWith('login_') ? err.code : 'login_failed';
            console.warn(`[auth] Sign-in failed (${code}): ${err?.message}`);
            if (wantsPopup) return sendPopupResult(res, { ok: false, code });
            return res.redirect(302, `/?login_error=${encodeURIComponent(code)}`);
        }

        // A password change keeps procedure mode if it was on: same person, same workstation.
        const previous = result.action === 'password' ? currentCookieSessionProcedure(req) : null;
        endCurrentCookieSession(req);
        const procedureFields = procedure
            ? { procedureUntil: procedure.procedureUntil, procedureOpenEnded: procedure.procedureOpenEnded }
            : (previous || {});
        issueAppSession(req, res, result.user, {
            kcSid: result.kcSid,
            idTokenEnc: encryptTokenPayload({ idToken: result.idToken }),
            ...procedureFields,
        });
        if (result.action === 'password') {
            recordAuthEvent({ event: 'password_change', provider: 'keycloak-redirect', userId: result.user.id });
        }
        if (procedure) {
            recordAuthEvent({ event: 'procedure_mode_start', provider: 'keycloak-redirect', userId: result.user.id, detail: procedure.procedureOpenEnded ? 'until_ended' : `${procedure.hours}h` });
        }
        if (result.popup) return sendPopupResult(res, { ok: true });
        res.redirect(302, result.returnTo);
    }));

    /**
     * Real use reported by the page (keys, pointer, viewer interaction) — the only thing
     * that keeps a normal session from idling out. Background polling doesn't call this.
     */
    app.post('/api/auth/activity', authenticateToken, (req, res) => {
        touchSessionActivity(req.user.sessionId);
        res.set('Cache-Control', 'no-store');
        res.status(204).end();
    });

    /** End procedure mode: back to normal session rules (idle window restarts now). */
    app.post('/api/auth/procedure-mode/end', requireAllowedWebOrigin, authenticateToken, (req, res) => {
        if (req.user.procedureUntil) {
            clearSessionProcedure(req.user.sessionId);
            recordAuthEvent({ event: 'procedure_mode_end', provider: getAuthProviderName(), userId: req.user.id, detail: 'ended_by_user' });
        }
        res.json({ procedureMode: { active: false } });
    });

    /**
     * OIDC back-channel logout: Keycloak POSTs a signed logout_token when a Keycloak
     * session is ended (sign-out elsewhere, an admin ending it, a disabled account),
     * and every app session started from it ends too.
     */
    app.post('/api/auth/backchannel-logout',
        express.urlencoded({ extended: false, limit: '16kb' }),
        asyncHandler(async (req, res) => {
            res.set('Cache-Control', 'no-store');
            let claims;
            try {
                claims = await verifyLogoutToken(req.body?.logout_token);
            } catch (err) {
                console.warn('[auth] Rejected back-channel logout:', err?.code || err?.message);
                return res.status(400).json({ error: 'invalid_request' });
            }
            // Keycloak sends sid (the client is configured to require it). A token with
            // only sub would mean "every session of this user"; we don't act on that
            // without a sid, since sessions from password login carry no sid.
            const ended = claims.sid ? deleteSessionsByKcSid(claims.sid) : 0;
            console.info(`[auth] Back-channel logout: ended ${ended} app session(s)`);
            // Re-check this account on its next request rather than up to 5 minutes later:
            // Keycloak's "log out user" sends one call but stamps notBefore for all sessions.
            if (claims.sub) forgetAccount(claims.sub);
            if (ended) {
                recordAuthEvent({ event: 'logout_backchannel', provider: 'keycloak-redirect', userId: claims.sub || null });
            }
            res.status(200).end();
        })
    );

    /**
     * Logout. Also returns `logoutUrl` (Keycloak's end-session URL) so the browser ends
     * the Keycloak sign-in too when the person signs out.
     */
    app.post('/api/auth/logout', requireAllowedWebOrigin, asyncHandler(async (req, res) => {
        const authHeader = req.headers['authorization'];
        const rawToken = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;
        const jti = rawToken ? decodeToken(rawToken)?.jti : null;
        const { idTokenEnc } = getSessionOidc(jti);
        const idToken = idTokenEnc ? decryptTokenPayload(idTokenEnc)?.idToken : null;
        const logoutUrl = await buildLogoutUrl(idToken).catch((err) => {
            console.warn('[auth] Could not build Keycloak logout URL:', err?.message);
            return null;
        });

        logoutCurrentSession(req, res);
        recordAuthEvent({ event: 'logout', provider: getAuthProviderName(), req });
        res.json({ message: 'Logout successful', ...(logoutUrl ? { logoutUrl } : {}) });
    }));

    /**
     * Get current user info
     */
    app.get('/api/auth/me', authenticateToken, asyncHandler(async (req, res) => {
        const kcSub = req.user.keycloakSub;
        const [preferences, hasPrefs, avatarKey, kcProfile] = await Promise.all([
            getPreferencesByKcSub(kcSub),
            hasCustomPreferences(kcSub),
            findAvatarKey(kcSub),
            kcSub ? getKeycloakUser(kcSub).catch(() => null) : null,
        ]);
        const isOrgAdmin = req.user.role === 'admin' || req.user.role === 'org-admin';
        const isRegistrationReviewer = kcSub
            ? await isUserInCapabilityGroup(kcSub, CAPABILITIES.APPROVE_REGISTRATIONS).catch(() => false)
            : false;
        const avatarUrl = avatarKey ? `/api/auth/avatar?v=${Date.now()}` : null;
        const preferredName = kcProfile?.preferredName || null;
        const firstName = req.user.firstName || null;
        const lastName  = req.user.lastName  || null;
        const fullName  = [firstName, lastName].filter(Boolean).join(' ').trim();

        // Approval gate: an account without app-user gets a pending review item (once)
        // and the SPA shows "Access pending approval" instead of the app.
        const accessPending = req.user.approved === false;
        if (!accessPending) {
            acceptSignupInvitesOnFirstSignIn(kcSub).catch((err) =>
                console.warn('[invites] Could not mark signup invites accepted:', err.message));
        }
        if (accessPending && kcSub) {
            try {
                // Fields entered on Keycloak's sign-up page (none for hospital-SSO accounts).
                const extra = await getRegistrationAttributes(kcSub).catch(() => ({}));
                const { created, request } = await ensureAccountRequest({
                    kcSub,
                    email: kcProfile?.email,
                    firstName: kcProfile?.firstName || firstName,
                    lastName: kcProfile?.lastName || lastName,
                    affiliation: extra.affiliation,
                    intendedUse: extra.intendedUse,
                });
                if (created) {
                    notifyNewRequest().catch(() => {});
                    if (request?.email) {
                        sendRegistrationReceivedEmail({ to: request.email, firstName: request.firstName })
                            .catch(() => {});
                    }
                }
            } catch (err) {
                console.warn('[gate] Could not record pending access request:', err.message);
            }
        }

        res.set('Cache-Control', 'no-store');
        res.json({
            accessPending,
            // Session rules for the page: idle warning, re-sign-in, procedure mode banner.
            session: {
                idleMinutes: config.security.sessionIdleMinutes,
                maxHours: config.security.sessionMaxHours,
                signedInAt: req.user.iat ? new Date(req.user.iat * 1000).toISOString() : null,
                procedureMode: req.user.procedureUntil
                    ? { active: true, until: req.user.procedureUntil, openEnded: req.user.procedureOpenEnded }
                    : { active: false },
                procedureSettings: procedureModeSettings(),
            },
            user: {
                id: req.user.id,
                username: req.user.username,
                // The session token doesn't carry the email; Keycloak's profile does.
                email: kcProfile?.email || req.user.email || null,
                firstName,
                lastName,
                preferredName,
                displayName: preferredName || fullName || req.user.username || 'Guest',
                role: req.user.role,
                avatarUrl,
                preferences,
                hasCustomPreferences: hasPrefs,
            },
            identity: { keycloakLinked: true },
            isOrgAdmin: accessPending ? false : isOrgAdmin,
            isRegistrationReviewer: accessPending ? false : isRegistrationReviewer,
            keycloakSub: kcSub,
        });
    }));

    /**
     * Update current user preferences (theme, local viewer options).
     * Stored in the Payload user-preferences collection, keyed by Keycloak sub.
     */
    app.put('/api/auth/preferences', authenticateToken, asyncHandler(async (req, res) => {
        const kcSub = req.user.keycloakSub;
        if (!kcSub) throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');

        const patch = {};
        if (req.body?.theme !== undefined) patch.theme = req.body.theme;
        if (req.body?.useFullSlicer !== undefined) patch.useFullSlicer = req.body.useFullSlicer === true;
        if (req.body?.useSimplifiedViewer !== undefined) patch.useSimplifiedViewer = req.body.useSimplifiedViewer === true;
        if (req.body?.homeLayout !== undefined) patch.homeLayout = req.body.homeLayout;
        if (req.body?.slicerWebChannel !== undefined) patch.slicerWebChannel = req.body.slicerWebChannel === 'latest' ? 'latest' : 'stable';
        if (req.body?.notifyRegistrationApproval !== undefined) patch.notifyRegistrationApproval = req.body.notifyRegistrationApproval === true;
        if (req.body?.shareNameInGroups !== undefined) patch.shareNameInGroups = req.body.shareNameInGroups === true;
        if (req.body?.activityFilters !== undefined) patch.activityFilters = req.body.activityFilters;

        const { viewerModeChanged } = await import('../gpu/userPreferences.js');
        const before = await getPreferencesByKcSub(kcSub);
        const preferences = await updatePreferencesByKcSub(kcSub, patch);
        if (viewerModeChanged(before, preferences)) {
            try {
                const { stopSlicerGuiSession } = await import('../slicerGui/sessionManager.js');
                await stopSlicerGuiSession({ userId: String(req.user.id) });
            } catch (err) {
                console.warn('Full Slicer recycle after preference change:', err.message);
            }
        }

        res.json({ preferences });
    }));

    /** Upload or replace the current user's avatar (object storage, keyed by Keycloak sub). */
    app.post('/api/auth/avatar', authenticateToken, avatarUpload.single('avatar'), asyncHandler(async (req, res) => {
        if (!req.file) throw new ValidationError(msg('avatar.required'), null, 'avatar.required');
        let { buffer } = req.file;
        const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
        if (ext === 'heic' || ext === 'heif') {
            const converted = await heicConvert({ buffer, format: 'JPEG', quality: 0.85 });
            buffer = Buffer.from(converted);
        }
        // Stored and served by what the file is, not what it's called: others see this picture.
        const finalExt = sniffImageType(buffer);
        if (!finalExt) throw new ValidationError(msg('avatar.invalid_type'), null, 'avatar.invalid_type');
        const existingKey = await findAvatarKey(req.user.keycloakSub);
        if (existingKey) await storage.delete(existingKey);
        const key = storage.avatarKeyForSub(req.user.keycloakSub, finalExt);
        await storage.write({ key, buffer, contentType: IMAGE_MIME[finalExt] });
        forgetAvatar(req.user.keycloakSub);
        res.json({ ok: true, avatarUrl: `/api/auth/avatar?v=${Date.now()}` });
    }));

    /** Serve the current user's avatar. */
    app.get('/api/auth/avatar', authenticateToken, asyncHandler(async (req, res) => {
        const key = await findAvatarKey(req.user.keycloakSub);
        if (!key) return res.status(404).end();
        return sendStoredImage(res, key);
    }));

    /** Remove the current user's avatar. */
    app.delete('/api/auth/avatar', authenticateToken, asyncHandler(async (req, res) => {
        const key = await findAvatarKey(req.user.keycloakSub);
        if (key) await storage.delete(key);
        forgetAvatar(req.user.keycloakSub);
        res.json({ ok: true });
    }));

    /**
     * Logout all sessions (security feature)
     */
    app.post('/api/auth/logout-all', requireAllowedWebOrigin, authenticateToken, asyncHandler(async (req, res) => {
        logoutAllSessions(req.user.id, res);
        try {
            const { cleanupLocalViewerSessionsForUser } = await import('../sessions/cleanup.js');
            await cleanupLocalViewerSessionsForUser(req.user.id);
        } catch (err) {
            console.warn('Local viewer cleanup during logout-all:', err.message);
        }
        recordAuthEvent({
            event: 'logout_all',
            provider: getAuthProviderName(),
            userId: req.user.id,
            req
        });
        res.json({ message: 'All sessions terminated' });
    }));
}
