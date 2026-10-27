import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { Users, Cases, Attachments, CaseComments, CaseInvites } from './collections.js'

export default buildConfig({
    secret: process.env.PAYLOAD_SECRET || 'dev-secret-please-change',

    db: postgresAdapter({
        pool: {
            connectionString: process.env.PAYLOAD_DATABASE_URI,
        },
    }),

    // Users must be listed here even though the backend doesn't use auth routes —
    // both this config and payload-admin share the same Postgres instance, and
    // Payload will try to DROP any column it doesn't recognise. Including Users
    // keeps the schema in sync and prevents the interactive migration prompt.
    collections: [Users, Cases, Attachments, CaseComments, CaseInvites],
})
