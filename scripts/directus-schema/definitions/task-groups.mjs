/**
 * task_groups — named groups of users with capability flags.
 * task_group_members — junction table linking directus_users to task_groups.
 *
 * After applying this schema, grant the service token role Read/Create/Update/Delete
 * permissions on both collections in Directus Studio.
 */

/** @type {{ collection: string, meta: object, schema: object, fields: object[], relations: object[] }} */
export const taskGroupsDefinition = {
    collection: 'task_groups',
    meta: {
        accountability: 'all',
        collection: 'task_groups',
        icon: 'group',
        note: 'Named groups of users with shared capabilities (e.g. can approve registration requests).',
        singleton: false,
        hidden: false,
        display_template: '{{name}}'
    },
    schema: { name: 'task_groups' },
    fields: [
        {
            field: 'id',
            type: 'uuid',
            meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
            schema: { is_primary_key: true, length: 36, has_auto_increment: false }
        },
        {
            field: 'name',
            type: 'string',
            meta: { interface: 'input', required: true, width: 'half' },
            schema: { is_nullable: false }
        },
        {
            field: 'description',
            type: 'text',
            meta: { interface: 'input-multiline', width: 'full' },
            schema: { is_nullable: true }
        },
        {
            field: 'can_approve_registrations',
            type: 'boolean',
            meta: {
                interface: 'boolean',
                special: ['cast-boolean'],
                width: 'half',
                note: 'Members of this group can approve or reject registration requests.'
            },
            schema: { default_value: false, is_nullable: false }
        },
        {
            field: 'date_created',
            type: 'timestamp',
            meta: { interface: 'datetime', special: ['date-created'], readonly: true, hidden: true, width: 'half' },
            schema: { is_nullable: true }
        },
        {
            field: 'date_updated',
            type: 'timestamp',
            meta: { interface: 'datetime', special: ['date-updated'], readonly: true, hidden: true, width: 'half' },
            schema: { is_nullable: true }
        }
    ],
    relations: []
};

/** @type {{ collection: string, meta: object, schema: object, fields: object[], relations: object[] }} */
export const taskGroupMembersDefinition = {
    collection: 'task_group_members',
    meta: {
        accountability: 'all',
        collection: 'task_group_members',
        icon: 'person',
        note: 'Maps Directus users to task groups. Managed by the BFF — not for direct editing.',
        singleton: false,
        hidden: true,
        display_template: '{{directus_user}}'
    },
    schema: { name: 'task_group_members' },
    fields: [
        {
            field: 'id',
            type: 'uuid',
            meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
            schema: { is_primary_key: true, length: 36, has_auto_increment: false }
        },
        {
            field: 'task_group',
            type: 'uuid',
            meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                required: true,
                width: 'half',
                options: { template: '{{name}}' }
            },
            schema: { is_nullable: false, foreign_key_table: 'task_groups', foreign_key_column: 'id' }
        },
        {
            field: 'directus_user',
            type: 'uuid',
            meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                required: true,
                width: 'half',
                options: { template: '{{email}}' }
            },
            schema: { is_nullable: false, foreign_key_table: 'directus_users', foreign_key_column: 'id' }
        },
        {
            field: 'can_manage_group',
            type: 'boolean',
            meta: {
                interface: 'boolean',
                special: ['cast-boolean'],
                width: 'half',
                note: 'Member can add/remove members and edit group settings.'
            },
            schema: { default_value: false, is_nullable: false }
        },
        {
            field: 'date_created',
            type: 'timestamp',
            meta: { interface: 'datetime', special: ['date-created'], readonly: true, hidden: true, width: 'half' },
            schema: { is_nullable: true }
        }
    ],
    relations: [
        {
            collection: 'task_group_members',
            field: 'task_group',
            related_collection: 'task_groups',
            meta: {
                many_collection: 'task_group_members',
                many_field: 'task_group',
                one_collection: 'task_groups',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: { on_delete: 'CASCADE' }
        },
        {
            collection: 'task_group_members',
            field: 'directus_user',
            related_collection: 'directus_users',
            meta: {
                many_collection: 'task_group_members',
                many_field: 'directus_user',
                one_collection: 'directus_users',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: { on_delete: 'CASCADE' }
        }
    ]
};
