/**
 * Target Directus model for case invite queues (existing-user + signup).
 * Replaces SQLite `case_invites` + `case_signup_invites` when the BFF is cut over.
 *
 * Not applied by the running app — only by ensure-schema.mjs with DIRECTUS_SCHEMA_TOKEN.
 */

/** @typedef {{ field: string, type: string, meta?: object, schema?: object }} FieldDef */

/** @type {{ collection: string, meta: object, schema: object, fields: FieldDef[], relations: object[] }} */
export const caseInvitesDefinition = {
    collection: 'case_invites',
    meta: {
        accountability: 'all',
        collection: 'case_invites',
        icon: 'forward_to_inbox',
        note:
            'Pending case invites (existing Directus users + signup emails). '
            + 'Managed by the product BFF; clinicians use call-as-user, not Data Model.',
        singleton: false,
        hidden: false,
        display_template: '{{invitee_email}} — {{status}}'
    },
    schema: {
        name: 'case_invites'
    },
    fields: [
        {
            field: 'id',
            type: 'uuid',
            meta: {
                hidden: true,
                readonly: true,
                interface: 'input',
                special: ['uuid']
            },
            schema: {
                is_primary_key: true,
                length: 36,
                has_auto_increment: false
            }
        },
        {
            field: 'status',
            type: 'string',
            meta: {
                interface: 'select-dropdown',
                width: 'half',
                required: true,
                options: {
                    choices: [
                        { text: 'Pending (existing user)', value: 'pending' },
                        { text: 'Pending approval (signup)', value: 'pending_approval' },
                        { text: 'Pending signup', value: 'pending_signup' },
                        { text: 'Approved', value: 'approved' },
                        { text: 'Accepted', value: 'accepted' },
                        { text: 'Rejected', value: 'rejected' },
                        { text: 'Cancelled', value: 'cancelled' },
                        { text: 'Expired', value: 'expired' }
                    ]
                }
            },
            schema: {
                is_nullable: false,
                default_value: 'pending'
            }
        },
        {
            field: 'kind',
            type: 'string',
            meta: {
                interface: 'select-dropdown',
                width: 'half',
                required: true,
                options: {
                    choices: [
                        { text: 'Existing user', value: 'existing' },
                        { text: 'Signup email', value: 'signup' }
                    ]
                }
            },
            schema: {
                is_nullable: false,
                default_value: 'existing'
            }
        },
        {
            field: 'case',
            type: 'uuid',
            meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                required: true,
                width: 'full',
                options: {
                    template: '{{title}}'
                }
            },
            schema: {
                is_nullable: false,
                foreign_key_table: 'case',
                foreign_key_column: 'id'
            }
        },
        {
            field: 'case_title',
            type: 'string',
            meta: {
                interface: 'input',
                note: 'Denormalized title for notifications / emails',
                width: 'full'
            },
            schema: {
                is_nullable: true
            }
        },
        {
            field: 'invitee_email',
            type: 'string',
            meta: {
                interface: 'input',
                required: true,
                width: 'half'
            },
            schema: {
                is_nullable: false
            }
        },
        {
            field: 'invitee_directus_user',
            type: 'uuid',
            meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                width: 'half',
                options: {
                    template: '{{email}}'
                }
            },
            schema: {
                is_nullable: true,
                foreign_key_table: 'directus_users',
                foreign_key_column: 'id'
            }
        },
        {
            field: 'proposed_role',
            type: 'string',
            meta: {
                interface: 'select-dropdown',
                width: 'half',
                required: true,
                options: {
                    choices: [
                        { text: 'Admin', value: 'admin' },
                        { text: 'Collaborator', value: 'collaborator' },
                        // Match case_directus_users.role spelling (not SQLite read_only)
                        { text: 'Read only', value: 'readonly' }
                    ]
                }
            },
            schema: {
                is_nullable: false,
                default_value: 'collaborator'
            }
        },
        {
            field: 'inviter_directus_user',
            type: 'uuid',
            meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                required: true,
                width: 'half',
                options: {
                    template: '{{email}}'
                }
            },
            schema: {
                is_nullable: false,
                foreign_key_table: 'directus_users',
                foreign_key_column: 'id'
            }
        },
        {
            field: 'token_hash',
            type: 'string',
            meta: {
                interface: 'input',
                hidden: true,
                note: 'SHA-256 of signup redeem token (never store the raw token)',
                width: 'full'
            },
            schema: {
                is_nullable: true
            }
        },
        {
            field: 'expires_at',
            type: 'timestamp',
            meta: {
                interface: 'datetime',
                width: 'half'
            },
            schema: {
                is_nullable: true
            }
        },
        {
            field: 'resolved_at',
            type: 'timestamp',
            meta: {
                interface: 'datetime',
                width: 'half',
                readonly: true
            },
            schema: {
                is_nullable: true
            }
        },
        {
            field: 'resolved_by_directus_user',
            type: 'uuid',
            meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                width: 'half',
                options: {
                    template: '{{email}}'
                }
            },
            schema: {
                is_nullable: true,
                foreign_key_table: 'directus_users',
                foreign_key_column: 'id'
            }
        },
        {
            field: 'accepted_directus_user',
            type: 'uuid',
            meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                width: 'half',
                options: {
                    template: '{{email}}'
                }
            },
            schema: {
                is_nullable: true,
                foreign_key_table: 'directus_users',
                foreign_key_column: 'id'
            }
        },
        {
            field: 'date_created',
            type: 'timestamp',
            meta: {
                interface: 'datetime',
                special: ['date-created'],
                readonly: true,
                width: 'half'
            },
            schema: {
                is_nullable: true
            }
        },
        {
            field: 'date_updated',
            type: 'timestamp',
            meta: {
                interface: 'datetime',
                special: ['date-updated'],
                readonly: true,
                width: 'half'
            },
            schema: {
                is_nullable: true
            }
        }
    ],
    relations: [
        {
            collection: 'case_invites',
            field: 'case',
            related_collection: 'case',
            meta: {
                many_collection: 'case_invites',
                many_field: 'case',
                one_collection: 'case',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: {
                on_delete: 'CASCADE'
            }
        },
        {
            collection: 'case_invites',
            field: 'invitee_directus_user',
            related_collection: 'directus_users',
            meta: {
                many_collection: 'case_invites',
                many_field: 'invitee_directus_user',
                one_collection: 'directus_users',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: {
                on_delete: 'SET NULL'
            }
        },
        {
            collection: 'case_invites',
            field: 'inviter_directus_user',
            related_collection: 'directus_users',
            meta: {
                many_collection: 'case_invites',
                many_field: 'inviter_directus_user',
                one_collection: 'directus_users',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: {
                on_delete: 'SET NULL'
            }
        },
        {
            collection: 'case_invites',
            field: 'resolved_by_directus_user',
            related_collection: 'directus_users',
            meta: {
                many_collection: 'case_invites',
                many_field: 'resolved_by_directus_user',
                one_collection: 'directus_users',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: {
                on_delete: 'SET NULL'
            }
        },
        {
            collection: 'case_invites',
            field: 'accepted_directus_user',
            related_collection: 'directus_users',
            meta: {
                many_collection: 'case_invites',
                many_field: 'accepted_directus_user',
                one_collection: 'directus_users',
                one_field: null,
                one_deselect_action: 'nullify'
            },
            schema: {
                on_delete: 'SET NULL'
            }
        }
    ]
};
