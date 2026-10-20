/**
 * Shared Payload collection definitions.
 *
 * Imported by both:
 *   backend/src/payload/payload.config.js  (runtime Local API)
 *   payload-admin/payload.config.js        (standalone Next.js admin UI)
 *
 * Both configs connect to the same payload-db Postgres instance, so the
 * schema MUST stay identical. Edit here — never in the two config files.
 *
 * Users is defined here (with auth:true) so both instances agree on the schema.
 * Auth API routes are only accessible through the payload-admin UI, not the backend.
 */

export const Users = {
    slug: 'users',
    auth: true,
    admin: { useAsTitle: 'email' },
    fields: [
        { name: 'name', type: 'text', label: 'Full Name' },
    ],
};


export const Cases = {
    slug: 'cases',
    admin: { useAsTitle: 'title' },
    fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'description', type: 'textarea' },
        {
            // Temporary bridge until full Keycloak/Payload user migration
            name: 'owner_id',
            type: 'number',
            label: 'Owner (SQLite user ID)',
            required: true,
        },
        {
            name: 'status',
            type: 'select',
            options: [
                { label: 'Active',   value: 'active' },
                { label: 'Archived', value: 'archived' },
            ],
            defaultValue: 'active',
            required: true,
        },
    ],
};

export const Attachments = {
    slug: 'attachments',
    admin: { useAsTitle: 'original_filename' },
    fields: [
        {
            name: 'case',
            type: 'relationship',
            relationTo: 'cases',
            required: true,
            index: true,
        },
        {
            // Object key in the storage abstraction, e.g. caseFiles/{caseId}/{filename}
            name: 'storage_key',
            type: 'text',
            required: true,
        },
        {
            name: 'original_filename',
            type: 'text',
            required: true,
        },
        {
            name: 'mime_type',
            type: 'text',
        },
        {
            name: 'size_bytes',
            type: 'number',
        },
        {
            // Temporary bridge until full Keycloak/Payload user migration
            name: 'uploaded_by',
            type: 'number',
            label: 'Uploaded by (SQLite user ID)',
            required: true,
        },
    ],
};
