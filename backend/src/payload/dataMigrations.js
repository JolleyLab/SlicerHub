/**
 * Data fixes that must run before Payload's schema sync changes a column, because the old
 * schema is the only record of what a value meant. Each statement is idempotent and guards
 * itself on that old schema, so it's a no-op on a fresh database or once the sync has run.
 *
 * Two places run them, each right before its own schema sync:
 * - initPayload() when Payload pushes the schema itself (any NODE_ENV but production);
 * - scripts/setup-payload.mjs (production), as part of its retired-schema step.
 */

/**
 * The SlicerWeb version setting gained "Default". Under the old checkbox every saved
 * preference stored 'stable' whether or not the person touched it, so 'stable' can't be told
 * apart from "never chose": those rows move to Default (NULL reads as default). 'latest' was
 * always a deliberate opt-in and is kept. Runs only while the enum still lacks 'default',
 * so a Stable picked from the new dropdown is never touched.
 */
export const SLICER_WEB_CHANNEL_TO_DEFAULT = `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_user_preferences_slicer_web_channel')
        AND NOT EXISTS (
            SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'enum_user_preferences_slicer_web_channel' AND e.enumlabel = 'default'
        ) THEN
        UPDATE user_preferences SET slicer_web_channel = NULL WHERE slicer_web_channel = 'stable';
    END IF;
END $$`;

export const PRE_SYNC_DATA_MIGRATIONS = Object.freeze([SLICER_WEB_CHANNEL_TO_DEFAULT]);

/** True when Payload will push its schema on connect (mirrors @payloadcms/db-postgres connect). */
export function payloadWillPushSchema(env = process.env) {
    return env.NODE_ENV !== 'production' && env.PAYLOAD_MIGRATING !== 'true';
}

/** Run PRE_SYNC_DATA_MIGRATIONS in one transaction on a connected pg client. */
export async function applyPreSyncDataMigrations(client) {
    try {
        await client.query('BEGIN');
        for (const statement of PRE_SYNC_DATA_MIGRATIONS) await client.query(statement);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    }
}

/**
 * Open a connection of its own and apply the migrations, before Payload connects.
 * pg is loaded here, not at the top, so setup-payload.mjs can import this module on the host.
 */
export async function runPreSyncDataMigrations(connectionString) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
        await applyPreSyncDataMigrations(client);
    } finally {
        await client.end();
    }
}
