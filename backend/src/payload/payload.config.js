import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { Users, Cases, Attachments, CaseComments, CaseInvites, CaseGroupAccess, UserPreferences, RegistrationRequests, Groups, GroupMembers, UserNotifications, SiteAnnouncement } from './collections.js'
import { resolvePayloadSecret } from './secret.js'

export default buildConfig({
    secret: resolvePayloadSecret(),

    db: postgresAdapter({
        pool: {
            connectionString: process.env.PAYLOAD_DATABASE_URI,
        },
    }),

    // Users must be listed here even though the backend doesn't use auth routes —
    // both this config and payload-admin share the same Postgres instance, and
    // Payload will try to DROP any column it doesn't recognise. Including Users
    // keeps the schema in sync and prevents the interactive migration prompt.
    collections: [Users, Cases, Attachments, CaseComments, CaseInvites, CaseGroupAccess, UserPreferences, RegistrationRequests, Groups, GroupMembers, UserNotifications],
    globals: [SiteAnnouncement],
})
