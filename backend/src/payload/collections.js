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
            name: 'owner_id',
            type: 'text',
            label: 'Owner (Keycloak sub)',
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

export const CaseComments = {
    slug: 'case-comments',
    admin: { useAsTitle: 'body' },
    fields: [
        {
            name: 'case',
            type: 'relationship',
            relationTo: 'cases',
            required: true,
            index: true,
        },
        {
            name: 'body',
            type: 'textarea',
            required: true,
        },
        {
            // Keycloak subject ID. Display name is resolved from Keycloak at
            // read time — never stored here.
            name: 'author_id',
            type: 'text',
            label: 'Author (Keycloak sub)',
            required: true,
        },
    ],
};

export const CaseInvites = {
    slug: 'case-invites',
    admin: { useAsTitle: 'invitee_email' },
    fields: [
        {
            // 'signup' = email not yet in Keycloak; 'existing' = already has a KC account
            name: 'kind',
            type: 'select',
            options: [
                { label: 'Signup (new account)',   value: 'signup' },
                { label: 'Existing (KC account)',  value: 'existing' },
            ],
            required: true,
        },
        {
            name: 'status',
            type: 'select',
            options: [
                { label: 'Pending approval',  value: 'pending_approval' },
                { label: 'Pending signup',    value: 'pending_signup' },
                { label: 'Accepted',          value: 'accepted' },
                { label: 'Rejected',          value: 'rejected' },
                { label: 'Expired',           value: 'expired' },
            ],
            required: true,
            defaultValue: 'pending_approval',
        },
        { name: 'invitee_email',    type: 'email', required: true },
        { name: 'inviter_id',       type: 'text' },  // Keycloak sub of whoever submitted the invite
        {
            name: 'case',
            type: 'relationship',
            relationTo: 'cases',
            required: true,
            index: true,
        },
        {
            name: 'role',
            type: 'select',
            options: [
                { label: 'Admin',        value: 'admin' },
                { label: 'Collaborator', value: 'collaborator' },
                { label: 'Read Only',    value: 'read_only' },
            ],
            required: true,
            defaultValue: 'collaborator',
        },
        { name: 'keycloak_user_id', type: 'text' },  // set once KC user exists
        { name: 'token_hash',       type: 'text', index: true },  // for signup invite links
        { name: 'expires_at',       type: 'date' },
    ],
};

export const UserPreferences = {
    slug: 'user-preferences',
    admin: { useAsTitle: 'keycloak_sub' },
    fields: [
        { name: 'keycloak_sub', type: 'text', required: true, index: true, unique: true, label: 'Keycloak sub (user ID)' },
        {
            name: 'theme',
            type: 'select',
            options: [{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }],
            defaultValue: 'light',
        },
        { name: 'use_full_slicer',          type: 'checkbox', defaultValue: false },
        { name: 'use_simplified_viewer',    type: 'checkbox', defaultValue: false },
        { name: 'home_layout',              type: 'json' },
        {
            name: 'slicer_web_channel',
            type: 'select',
            options: [{ label: 'Stable', value: 'stable' }, { label: 'Latest (dev)', value: 'latest' }],
            defaultValue: 'stable',
        },
        { name: 'notify_registration_approval', type: 'checkbox', defaultValue: true },
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
            name: 'uploaded_by',
            type: 'text',
            label: 'Uploaded by (Keycloak sub)',
            required: true,
        },
    ],
};
