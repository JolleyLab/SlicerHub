/**
 * Passkey helpers — @simplewebauthn/browser (industry standard WebAuthn client).
 */

import {
    startRegistration,
    startAuthentication,
    browserSupportsWebAuthn
} from '@simplewebauthn/browser';
import { API_URL } from '../config.js';

export function supportsWebAuthn() {
    try {
        return browserSupportsWebAuthn();
    } catch {
        return false;
    }
}

async function postJson(path, body, { credentials = 'include' } = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials,
        body: body != null ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const msg = data.error?.message || data.message || `Request failed (${response.status})`;
        const err = new Error(msg);
        err.status = response.status;
        err.code = data.error?.code;
        throw err;
    }
    return data;
}

async function getJson(path) {
    const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error?.message || data.message || 'Request failed');
    }
    return data;
}

/** Login with a platform passkey; returns { user }. */
export async function loginWithPasskey({ identity } = {}) {
    const options = await postJson('/api/auth/webauthn/login/options', {
        identity: identity || undefined
    });
    const assertion = await startAuthentication({ optionsJSON: options });
    return postJson('/api/auth/webauthn/login/verify', { credential: assertion });
}

/** Register a passkey for the signed-in user. */
export async function registerPasskey({ friendlyName } = {}) {
    const options = await postJson('/api/auth/webauthn/register/options', {});
    const attestation = await startRegistration({ optionsJSON: options });
    return postJson('/api/auth/webauthn/register/verify', {
        credential: attestation,
        friendlyName: friendlyName || undefined
    });
}

export async function listPasskeys() {
    const data = await getJson('/api/auth/webauthn/credentials');
    return data.credentials || [];
}

export async function revokePasskey(id) {
    const response = await fetch(`${API_URL}/api/auth/webauthn/credentials/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error?.message || data.message || 'Could not remove passkey');
    }
    return data;
}
