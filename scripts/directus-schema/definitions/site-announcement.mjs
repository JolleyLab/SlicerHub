/**
 * site_announcement — singleton for the maintenance / info banner shown to logged-in users.
 *
 * Update fields in the Directus admin panel to push or clear a banner without any code deploy.
 *
 * Fields:
 *   enabled     Toggle the banner on/off without clearing the message.
 *   message     The text shown in the banner.
 *   severity    'info' | 'warning' | 'error' — controls the banner color.
 *   expires_at  Optional. Banner auto-hides after this time even if enabled is true.
 */

/** @type {{ collection: string, meta: object, schema: object, fields: object[], relations: object[] }} */
export const siteAnnouncementDefinition = {
    collection: 'site_announcement',
    meta: {
        accountability: 'all',
        collection: 'site_announcement',
        icon: 'campaign',
        note: 'Maintenance / info banner shown to logged-in users. Toggle enabled or set expires_at to hide without deleting the message.',
        singleton: true,
        hidden: false
    },
    schema: { name: 'site_announcement' },
    fields: [
        {
            field: 'enabled',
            type: 'boolean',
            meta: {
                interface: 'boolean',
                special: ['cast-boolean'],
                width: 'half',
                note: 'Show the banner to logged-in users.'
            },
            schema: { default_value: false, is_nullable: false }
        },
        {
            field: 'severity',
            type: 'string',
            meta: {
                interface: 'select-dropdown',
                width: 'half',
                options: {
                    choices: [
                        { text: 'Info',    value: 'info' },
                        { text: 'Warning', value: 'warning' },
                        { text: 'Error',   value: 'error' }
                    ]
                },
                note: 'Controls the banner colour.'
            },
            schema: { default_value: 'info', is_nullable: false }
        },
        {
            field: 'message',
            type: 'text',
            meta: {
                interface: 'input-multiline',
                width: 'full',
                note: 'The text shown in the banner. Plain text — no HTML.'
            },
            schema: { is_nullable: true }
        },
        {
            field: 'expires_at',
            type: 'timestamp',
            meta: {
                interface: 'datetime',
                width: 'half',
                note: 'Optional. Banner auto-hides after this time even if enabled is still checked.'
            },
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
