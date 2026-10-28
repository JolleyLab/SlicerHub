import { getPayload } from 'payload'
import config from './payload.config.js'

let _payload = null

/**
 * Initialize Payload. No-ops gracefully when PAYLOAD_DATABASE_URI is not set.
 * Safe to call multiple times — only initializes once.
 */
export async function initPayload() {
    if (_payload) return _payload

    const uri = (process.env.PAYLOAD_DATABASE_URI || '').trim()
    if (!uri) {
        console.log('Payload: PAYLOAD_DATABASE_URI not set — Cases unavailable (start with --profile payload to enable)')
        return null
    }

    try {
        _payload = await getPayload({ config })
        console.log('Payload: initialized — Cases + UserPreferences collections ready')
    } catch (err) {
        console.warn('Payload: init failed —', err.message)
        console.warn('Payload: Cases will not be available. Is payload-db running? (docker compose --profile payload up -d)')
    }

    return _payload
}

/**
 * Returns the initialized Payload client, or null if Payload is not enabled.
 * Callers should check for null before using.
 */
export function getPayloadClient() {
    return _payload
}
