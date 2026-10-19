import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'

export default buildConfig({
    secret: process.env.PAYLOAD_SECRET || 'dev-secret-please-change',

    db: postgresAdapter({
        pool: {
            connectionString: process.env.PAYLOAD_DATABASE_URI,
        },
    }),

    collections: [
        {
            slug: 'cases',
            admin: {
                useAsTitle: 'title',
            },
            fields: [
                {
                    name: 'title',
                    type: 'text',
                    required: true,
                },
                {
                    name: 'description',
                    type: 'textarea',
                },
                {
                    // SQLite user ID of the owning user — temporary bridge until full user migration
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
        },
    ],
})
