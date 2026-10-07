/**
 * pending_registration — registration requests submitted before a Directus account exists.
 *
 * user_updated / date_updated are Directus auto-tracking fields.
 * They record who last patched each row (the approver/rejector) and when,
 * enabling the "Approved by X / Rejected by X" attribution UI without
 * querying the activity log separately.
 *
 * notify_registration_approval is a per-user opt-out on directus_users,
 * not on this collection — see the directus_users section in the docs.
 */

/** @type {{ collection: string, meta: object, schema: object, fields: object[], relations: object[] }} */
export const pendingRegistrationDefinition = {
    collection: 'pending_registration',
    meta: {
        accountability: 'all',
        collection: 'pending_registration',
        icon: 'how_to_reg',
        note: 'Registration requests submitted before a Directus account exists. Managed by the BFF.',
        singleton: false,
        hidden: true,
        display_template: '{{email}}'
    },
    schema: { name: 'pending_registration' },
    fields: [
        {
            field: 'id',
            type: 'uuid',
            meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
            schema: { is_primary_key: true, length: 36, has_auto_increment: false }
        },
        {
            field: 'email',
            type: 'string',
            meta: { interface: 'input', required: true, width: 'half' },
            schema: { is_nullable: false }
        },
        {
            field: 'first_name',
            type: 'string',
            meta: { interface: 'input', width: 'half' },
            schema: { is_nullable: true }
        },
        {
            field: 'last_name',
            type: 'string',
            meta: { interface: 'input', width: 'half' },
            schema: { is_nullable: true }
        },
        {
            field: 'affiliation',
            type: 'string',
            meta: { interface: 'input', width: 'half' },
            schema: { is_nullable: true }
        },
        {
            field: 'intended_use',
            type: 'text',
            meta: { interface: 'input-multiline', width: 'full' },
            schema: { is_nullable: true }
        },
        {
            field: 'status',
            type: 'string',
            meta: {
                interface: 'select-dropdown',
                width: 'half',
                options: {
                    choices: [
                        { text: 'Pending',  value: 'pending' },
                        { text: 'Approved', value: 'approved' },
                        { text: 'Rejected', value: 'rejected' }
                    ]
                }
            },
            schema: { default_value: 'pending', is_nullable: false }
        },
        {
            field: 'is_org_admin',
            type: 'boolean',
            meta: { interface: 'boolean', special: ['cast-boolean'], width: 'half' },
            schema: { default_value: false, is_nullable: false }
        },
        {
            field: 'completion_token_hash',
            type: 'string',
            meta: { hidden: true, readonly: true },
            schema: { is_nullable: true }
        },
        {
            field: 'completion_token_expires_at',
            type: 'timestamp',
            meta: { interface: 'datetime', hidden: true, readonly: true, width: 'half' },
            schema: { is_nullable: true }
        },
        {
            field: 'date_created',
            type: 'timestamp',
            meta: { interface: 'datetime', special: ['date-created'], readonly: true, hidden: true, width: 'half' },
            schema: { is_nullable: true }
        },
        // Auto-tracking: who last updated this row (the approver/rejector).
        {
            field: 'user_updated',
            type: 'uuid',
            meta: {
                special: ['user-updated'],
                interface: 'select-dropdown-m2o',
                display: 'user',
                readonly: true,
                hidden: true,
                width: 'half',
                options: { template: '{{first_name}} {{last_name}}' }
            },
            schema: {
                data_type: 'char',
                max_length: 36,
                is_nullable: true,
                foreign_key_table: 'directus_users',
                foreign_key_column: 'id'
            }
        },
        {
            field: 'date_updated',
            type: 'timestamp',
            meta: { interface: 'datetime', special: ['date-updated'], readonly: true, hidden: true, width: 'half' },
            schema: { is_nullable: true }
        }
    ],
    relations: [
        {
            collection: 'pending_registration',
            field: 'user_updated',
            related_collection: 'directus_users',
            meta: {
                many_collection: 'pending_registration',
                many_field: 'user_updated',
                one_collection: 'directus_users',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: { on_delete: 'SET NULL' }
        }
    ]
};
