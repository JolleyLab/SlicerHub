/**
 * PAYLOAD_SECRET for both Payload configs (backend Local API and payload-admin).
 * Payload signs its admin-login tokens with it, so a missing or well-known value must
 * stop startup rather than fall back to a public default. When Payload is not in use
 * (no PAYLOAD_DATABASE_URI) the secret is never used, so a placeholder is fine.
 */
const KNOWN_DEFAULTS = new Set(['dev-secret-please-change']);

export function resolvePayloadSecret(env = process.env) {
    const secret = String(env.PAYLOAD_SECRET || '').trim();
    const payloadEnabled = Boolean(String(env.PAYLOAD_DATABASE_URI || '').trim());
    if (!payloadEnabled) return secret || 'payload-not-configured';
    if (!secret || KNOWN_DEFAULTS.has(secret)) {
        throw new Error(
            'FATAL: PAYLOAD_SECRET must be set to a strong random value when PAYLOAD_DATABASE_URI is set '
            + '(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")'
        );
    }
    return secret;
}
