/**
 * WebAuthn / passkeys via @simplewebauthn/server (industry standard).
 * Enrollment requires an authenticated product session; login issues product session via session.js.
 */

import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} from '@simplewebauthn/server';
import config from '../../config/index.js';
import User from '../../models/User.js';
import { ValidationError, UnauthorizedError, AppError } from '../../utils/errors.js';
import { storeChallenge, consumeChallenge } from './challenges.js';
import {
    listCredentialsForUser,
    findCredentialById,
    insertCredential,
    updateCredentialCounter,
    deleteCredential,
    toPublicCredentialList,
    toSimpleWebAuthnAuthenticator
} from './credentialsStore.js';
import { linkIdentity } from '../identityStore.js';

const PROVIDER = 'webauthn';

export function isWebAuthnEnabled() {
    return config.auth?.webauthn?.enabled === true;
}

function requireWebAuthn() {
    if (!isWebAuthnEnabled()) {
        throw new ValidationError('Passkeys are not enabled on this server');
    }
}

function rpConfig() {
    const rpID = config.auth.webauthn.rpID;
    const origins = config.auth.webauthn.origins;
    if (!rpID || !origins?.length) {
        throw new AppError('WebAuthn is misconfigured (rpID / origins)', 503);
    }
    return {
        rpID,
        rpName: config.auth.webauthn.rpName || 'Slicer Web',
        origins
    };
}

function userIdBytes(userId) {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setBigUint64(0, BigInt(userId), false);
    return buf;
}

function extractChallengeFromClientData(clientDataJSON) {
    if (!clientDataJSON) return null;
    try {
        const json = Buffer.from(String(clientDataJSON), 'base64url').toString('utf8');
        const parsed = JSON.parse(json);
        return parsed.challenge || null;
    } catch {
        return null;
    }
}

function resolveLocalUser(identity) {
    const key = String(identity || '').trim();
    if (!key) return null;
    return User.findByEmail(key) || User.findByUsername(key);
}

/**
 * Authenticated: begin passkey registration.
 */
export async function registrationOptionsForUser(user) {
    requireWebAuthn();
    const { rpID, rpName } = rpConfig();
    const existing = listCredentialsForUser(user.id);

    const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: user.email || user.username || String(user.id),
        userDisplayName: user.username || user.email || `user-${user.id}`,
        userID: userIdBytes(user.id),
        attestationType: 'none',
        excludeCredentials: existing.map((row) => ({
            id: row.credential_id,
            transports: row.transports_json ? JSON.parse(row.transports_json) : undefined
        })),
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred'
        }
    });

    storeChallenge({
        challenge: options.challenge,
        type: 'registration',
        userId: user.id
    });

    return options;
}

/**
 * Authenticated: verify attestation and store public key.
 */
export async function verifyRegistrationForUser(user, responseBody, friendlyName = null) {
    requireWebAuthn();
    const { rpID, origins } = rpConfig();

    const body = responseBody?.credential || responseBody;
    const challengeFromClient = extractChallengeFromClientData(body?.response?.clientDataJSON);
    if (!challengeFromClient) {
        throw new ValidationError('Invalid registration response');
    }

    const stored = consumeChallenge(challengeFromClient, 'registration');
    if (!stored || Number(stored.user_id) !== Number(user.id)) {
        throw new UnauthorizedError('Registration challenge expired or invalid');
    }

    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: stored.challenge,
            expectedOrigin: origins,
            expectedRPID: rpID,
            requireUserVerification: false
        });
    } catch (err) {
        throw new UnauthorizedError(err.message || 'Passkey registration failed');
    }

    if (!verification.verified || !verification.registrationInfo) {
        throw new UnauthorizedError('Passkey registration could not be verified');
    }

    const {
        credential,
        credentialDeviceType,
        credentialBackedUp
    } = verification.registrationInfo;

    const row = insertCredential({
        userId: user.id,
        credentialID: credential.id,
        credentialPublicKey: credential.publicKey,
        counter: credential.counter,
        transports: body.response?.transports || credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        friendlyName: friendlyName || null
    });

    try {
        linkIdentity(user.id, PROVIDER, row.credential_id);
    } catch {
        /* already linked */
    }

    return toPublicCredentialList([
        findCredentialById(row.credential_id || row.credentialId)
    ].filter(Boolean))[0] || toPublicCredentialList([row])[0];
}

/**
 * Public: begin passkey login options.
 */
export async function authenticationOptions({ identityHint } = {}) {
    requireWebAuthn();
    const { rpID } = rpConfig();

    let allowCredentials;
    let userId = null;

    if (identityHint) {
        const resolved = resolveLocalUser(identityHint);
        if (resolved) {
            userId = resolved.id;
            const creds = listCredentialsForUser(resolved.id);
            if (creds.length) {
                allowCredentials = creds.map((row) => ({
                    id: row.credential_id,
                    transports: row.transports_json ? JSON.parse(row.transports_json) : undefined
                }));
            }
        }
    }

    const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'preferred',
        allowCredentials: allowCredentials?.length ? allowCredentials : undefined
    });

    storeChallenge({
        challenge: options.challenge,
        type: 'authentication',
        userId
    });

    return options;
}

/**
 * Public: verify assertion → local user (caller issues product session).
 * @returns {{ user: object } | null}
 */
export async function verifyAuthentication(responseBody) {
    requireWebAuthn();
    const { rpID, origins } = rpConfig();

    const body = responseBody?.credential || responseBody;
    if (!body?.id || !body?.response?.clientDataJSON) {
        throw new ValidationError('Authentication response is required');
    }

    const challengeFromClient = extractChallengeFromClientData(body.response.clientDataJSON);
    if (!challengeFromClient) {
        throw new ValidationError('Invalid authentication clientDataJSON');
    }

    const stored = consumeChallenge(challengeFromClient, 'authentication');
    if (!stored) {
        throw new UnauthorizedError('Authentication challenge expired or invalid');
    }

    const credRow = findCredentialById(body.id);
    if (!credRow) {
        return null;
    }

    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: stored.challenge,
            expectedOrigin: origins,
            expectedRPID: rpID,
            credential: toSimpleWebAuthnAuthenticator(credRow),
            requireUserVerification: false
        });
    } catch (err) {
        throw new UnauthorizedError(err.message || 'Passkey authentication failed');
    }

    if (!verification.verified) {
        return null;
    }

    const newCounter = verification.authenticationInfo?.newCounter;
    if (typeof newCounter === 'number') {
        if (newCounter < Number(credRow.counter || 0)) {
            throw new UnauthorizedError(
                'Passkey authenticator counter regression',
                'WEBAUTHN_CLONE'
            );
        }
        updateCredentialCounter(credRow.credential_id, newCounter);
    }

    const user = User.findById(credRow.user_id);
    if (!user || user.is_active === 0 || user.is_active === false) {
        return null;
    }

    User.touchLastLogin(user.id);
    return { user };
}

export function listUserPasskeys(userId) {
    return toPublicCredentialList(listCredentialsForUser(userId));
}

export function removeUserPasskey(userId, credentialRowId) {
    return deleteCredential(userId, credentialRowId);
}
