/**
 * Adds the user_created (Created By) accountability field to the attachment collection.
 * The collection must already exist; this definition only adds the missing field + relation.
 */
export const attachmentAccountabilityDefinition = {
    collection: 'attachment',
    meta: {},
    schema: {},
    fields: [
        {
            field: 'user_created',
            type: 'uuid',
            meta: {
                special: ['user-created'],
                interface: 'select-dropdown-m2o',
                display: 'user',
                readonly: true,
                hidden: true,
                width: 'half'
            },
            schema: {
                is_nullable: true,
                foreign_key_table: 'directus_users',
                foreign_key_column: 'id'
            }
        }
    ],
    relations: [
        {
            collection: 'attachment',
            field: 'user_created',
            related_collection: 'directus_users',
            meta: {
                many_collection: 'attachment',
                many_field: 'user_created',
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
