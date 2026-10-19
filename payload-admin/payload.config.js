import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'

// NOTE: The `cases` collection here must stay in sync with backend/src/payload/payload.config.js.
// Both configs share the same payload-db Postgres instance.

const Users = {
    slug: 'users',
    auth: true,
    admin: { useAsTitle: 'email' },
    fields: [
        { name: 'name', type: 'text', label: 'Full Name' },
    ],
}

const Cases = {
    slug: 'cases',
    admin: { useAsTitle: 'title' },
    fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'description', type: 'textarea' },
        {
            name: 'owner_id',
            type: 'number',
            label: 'Owner (SQLite user ID)',
            required: true,
        },
        {
            name: 'status',
            type: 'select',
            options: [
                { label: 'Active', value: 'active' },
                { label: 'Archived', value: 'archived' },
            ],
            defaultValue: 'active',
            required: true,
        },
    ],
}

export default buildConfig({
    secret: process.env.PAYLOAD_SECRET || 'dev-secret-please-change',
    db: postgresAdapter({
        pool: { connectionString: process.env.PAYLOAD_DATABASE_URI },
    }),
    editor: lexicalEditor(),
    admin: {
        user: Users.slug,
    },
    collections: [Users, Cases],
})
