import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { Users, Cases, Attachments, CaseComments, CaseInvites, CaseGroupAccess, UserPreferences, RegistrationRequests, Groups, GroupMembers, UserNotifications } from '../backend/src/payload/collections.js'
import { resolvePayloadSecret } from '../backend/src/payload/secret.js'

// Collection definitions live in backend/src/payload/collections.js — edit there.
// Both this file and backend/src/payload/payload.config.js share the same
// payload-db Postgres instance and must use identical collection schemas.

export default buildConfig({
    secret: resolvePayloadSecret(),
    db: postgresAdapter({
        pool: { connectionString: process.env.PAYLOAD_DATABASE_URI },
    }),
    editor: lexicalEditor(),
    admin: {
        user: Users.slug,
    },
    collections: [Users, Cases, Attachments, CaseComments, CaseInvites, CaseGroupAccess, UserPreferences, RegistrationRequests, Groups, GroupMembers, UserNotifications],
})
