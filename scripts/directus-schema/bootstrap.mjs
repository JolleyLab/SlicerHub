/**
 * GENERATED FILE — do not hand-edit. Regenerate with:
 *   node scripts/directus-schema/generate-bootstrap.mjs
 *
 * Built 2026-10-15T18:31:07.126Z from reference-schema.mjs
 * (that extraction was taken 2026-10-15T17:49:16.118Z).
 *
 * This is a ONE-TIME SETUP SCRIPT, not a live mirror of any server: the model below
 * (roles, policies, permissions, role-level access, and the full data model) is a
 * point-in-time snapshot, hard-coded here. It will NOT track future changes to the
 * source instance on its own.
 *
 * To refresh it after the source schema changes:
 *   1. node scripts/directus-schema/export-schema.mjs --format=module \
 *        --out=scripts/directus-schema/reference-schema.mjs
 *   2. node scripts/directus-schema/generate-bootstrap.mjs
 *   3. review the diff to this file, commit it
 *
 * Run this file directly to set up a target instance — never destructive by default:
 *   node scripts/directus-schema/bootstrap.mjs --target-url=<url> --dry-run
 *   node scripts/directus-schema/bootstrap.mjs --target-url=<url>
 *
 * Schema (collections/fields/relations) only applies if every change against the target
 * is a pure addition; pass --allow-changes to also apply edits/deletions. Roles / policies
 * / permissions / access are always additive-only — matched by name or content, existing
 * ones are never edited. Security model same as ensure-schema.mjs: CLI only, interactive
 * Directus Administrator login by default (or --paste-token), nothing admin-level ever
 * touches .env.
 *
 * Usage:
 *   node scripts/directus-schema/bootstrap.mjs --target-url=https://your-fresh-instance --dry-run
 *   node scripts/directus-schema/bootstrap.mjs --target-url=https://your-fresh-instance
 *
 * Prod: same command, same safety guarantees — but dry-run it first, and prefer trying it
 * against a scratch/staging instance before ever pointing it at real prod.
 */

import { loadRepoEnv } from './lib/env.mjs';
import { createDirectusAdminClient } from './lib/client.mjs';
import { logoutDirectus } from './lib/login.mjs';
import { resolveAuth, parseAuthFlags } from './lib/auth.mjs';
import { applyAccessControl } from './lib/accessControl.mjs';
import { applySchemaSnapshot } from './lib/schemaDiff.mjs';
import { seedInviteApprovers } from './lib/seed.mjs';

loadRepoEnv();

// --- The hard-coded model (see the file header for how to refresh these) ---

const SCHEMA_SNAPSHOT = {
  "version": 1,
  "directus": "12.0.2",
  "vendor": "postgres",
  "collections": [
    {
      "collection": "attachment",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "attachment",
        "color": null,
        "display_template": "{{name}}",
        "group": null,
        "hidden": false,
        "icon": "attach_file",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "attachment"
      }
    },
    {
      "collection": "case",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "case",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": "folder",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "case"
      }
    },
    {
      "collection": "case_directus_users",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "case_directus_users",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": true,
        "icon": "import_export",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "case_directus_users"
      }
    },
    {
      "collection": "case_invite",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": "archived",
        "archive_value": "true",
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "case_invite",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": null,
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": "sort",
        "status": "active",
        "translations": null,
        "unarchive_value": "false",
        "versioning": false
      },
      "schema": {
        "name": "case_invite"
      }
    },
    {
      "collection": "case_invites",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "case_invites",
        "color": null,
        "display_template": "{{invitee_email}} — {{status}}",
        "group": null,
        "hidden": false,
        "icon": "forward_to_inbox",
        "item_duplication_fields": null,
        "note": "Pending case invites (existing Directus users + signup emails). Managed by the product BFF; clinicians use call-as-user, not Data Model.",
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "case_invites"
      }
    },
    {
      "collection": "pending_registration",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "pending_registration",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": null,
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": "sort",
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "pending_registration"
      }
    },
    {
      "collection": "process_order",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "process_order",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": "assignment",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "process_order"
      }
    },
    {
      "collection": "process_step",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "process_step",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": "list_alt",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "process_step"
      }
    },
    {
      "collection": "process_template",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "process_template",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": "schema",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "process_template"
      }
    },
    {
      "collection": "site_announcement",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "site_announcement",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": "campaign",
        "item_duplication_fields": null,
        "note": "Maintenance / info banner shown to logged-in users. Toggle enabled or set expires_at to hide without deleting the message.",
        "preview_url": null,
        "singleton": true,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "site_announcement"
      }
    },
    {
      "collection": "task",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "task",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": "task_alt",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "task"
      }
    },
    {
      "collection": "task_group_members",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "task_group_members",
        "color": null,
        "display_template": "{{directus_user}}",
        "group": null,
        "hidden": true,
        "icon": "person",
        "item_duplication_fields": null,
        "note": "Maps Directus users to task groups. Managed by the BFF — not for direct editing.",
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "task_group_members"
      }
    },
    {
      "collection": "task_groups",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "task_groups",
        "color": null,
        "display_template": "{{name}}",
        "group": null,
        "hidden": false,
        "icon": "group",
        "item_duplication_fields": null,
        "note": "Named groups of users with shared capabilities (e.g. can approve registration requests).",
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "task_groups"
      }
    },
    {
      "collection": "team",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "team",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": false,
        "icon": "groups",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "team"
      }
    },
    {
      "collection": "team_directus_users",
      "meta": {
        "accountability": "all",
        "archive_app_filter": true,
        "archive_field": null,
        "archive_value": null,
        "autosave_revision_interval": null,
        "collapse": "open",
        "collection": "team_directus_users",
        "color": null,
        "display_template": null,
        "group": null,
        "hidden": true,
        "icon": "import_export",
        "item_duplication_fields": null,
        "note": null,
        "preview_url": null,
        "singleton": false,
        "sort": null,
        "sort_field": null,
        "status": "active",
        "translations": null,
        "unarchive_value": null,
        "versioning": false
      },
      "schema": {
        "name": "team_directus_users"
      }
    }
  ],
  "fields": [
    {
      "collection": "attachment",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "attachment",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "attachment",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "attachment",
      "field": "case",
      "type": "uuid",
      "meta": {
        "collection": "attachment",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "case",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "case",
        "table": "attachment",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "attachment",
      "field": "file",
      "type": "uuid",
      "meta": {
        "collection": "attachment",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "file",
        "group": null,
        "hidden": false,
        "interface": "file",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": [
          "file"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "file",
        "table": "attachment",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_files",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "attachment",
      "field": "name",
      "type": "string",
      "meta": {
        "collection": "attachment",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "name",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "name",
        "table": "attachment",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "attachment",
      "field": "parent",
      "type": "uuid",
      "meta": {
        "collection": "attachment",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "parent",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "parent",
        "table": "attachment",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "attachment",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "attachment",
      "field": "user_created",
      "type": "uuid",
      "meta": {
        "collection": "attachment",
        "conditions": null,
        "display": "user",
        "display_options": null,
        "field": "user_created",
        "group": null,
        "hidden": true,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 6,
        "special": [
          "user-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "user_created",
        "table": "attachment",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "case",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "case",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case",
      "field": "title",
      "type": "string",
      "meta": {
        "collection": "case",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "title",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "title",
        "table": "case",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case",
      "field": "description",
      "type": "text",
      "meta": {
        "collection": "case",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "description",
        "group": null,
        "hidden": false,
        "interface": "input-multiline",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "description",
        "table": "case",
        "data_type": "text",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case",
      "field": "status",
      "type": "string",
      "meta": {
        "collection": "case",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "status",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Active",
              "value": "active"
            },
            {
              "text": "Archived",
              "value": "archived"
            }
          ]
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "status",
        "table": "case",
        "data_type": "character varying",
        "default_value": "active",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case",
      "field": "attachments",
      "type": "alias",
      "meta": {
        "collection": "case",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "attachments",
        "group": null,
        "hidden": false,
        "interface": "list-o2m",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": [
          "o2m"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      }
    },
    {
      "collection": "case",
      "field": "collaborators",
      "type": "alias",
      "meta": {
        "collection": "case",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "collaborators",
        "group": null,
        "hidden": false,
        "interface": "list-m2m",
        "note": null,
        "options": {
          "allowDuplicates": true
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 6,
        "special": [
          "m2m"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      }
    },
    {
      "collection": "case",
      "field": "user_created",
      "type": "uuid",
      "meta": {
        "collection": "case",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "user_created",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 7,
        "special": [
          "m2o",
          "user-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "user_created",
        "table": "case",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_directus_users",
      "field": "id",
      "type": "integer",
      "meta": {
        "collection": "case_directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": null,
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "case_directus_users",
        "data_type": "integer",
        "default_value": "nextval('case_directus_users_id_seq'::regclass)",
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": true,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_directus_users",
      "field": "case_id",
      "type": "uuid",
      "meta": {
        "collection": "case_directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "case_id",
        "group": null,
        "hidden": true,
        "interface": null,
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "case_id",
        "table": "case_directus_users",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "case",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_directus_users",
      "field": "directus_users_id",
      "type": "uuid",
      "meta": {
        "collection": "case_directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "directus_users_id",
        "group": null,
        "hidden": true,
        "interface": null,
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "directus_users_id",
        "table": "case_directus_users",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_directus_users",
      "field": "role",
      "type": "string",
      "meta": {
        "collection": "case_directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "role",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Admin",
              "value": "admin"
            },
            {
              "text": "Collaborator",
              "value": "collaborator"
            },
            {
              "text": "Read only",
              "value": "read_only"
            }
          ]
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": null,
        "translations": null,
        "validation": {
          "role": {
            "_in": [
              "admin",
              "collaborator",
              "read_only"
            ]
          }
        },
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "role",
        "table": "case_directus_users",
        "data_type": "character varying",
        "default_value": "collaborator",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "id",
      "type": "integer",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "case_invite",
        "data_type": "integer",
        "default_value": "nextval('case_invite_id_seq'::regclass)",
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": true,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "archived",
      "type": "boolean",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": "boolean",
        "display_options": {
          "colorOff": "transparent",
          "colorOn": "var(--theme--foreground-subdued)",
          "iconOff": "unarchive",
          "iconOn": "archive",
          "labelOff": "$t:not_archived",
          "labelOn": "$t:archived"
        },
        "field": "archived",
        "group": null,
        "hidden": false,
        "interface": "boolean",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": [
          "cast-boolean"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "archived",
        "table": "case_invite",
        "data_type": "boolean",
        "default_value": false,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "sort",
      "type": "integer",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "sort",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "sort",
        "table": "case_invite",
        "data_type": "integer",
        "default_value": null,
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "user_created",
      "type": "uuid",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": "user",
        "display_options": null,
        "field": "user_created",
        "group": null,
        "hidden": true,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{avatar}} {{first_name}} {{last_name}}"
        },
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": [
          "user-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "user_created",
        "table": "case_invite",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invite",
      "field": "date_created",
      "type": "timestamp",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": "datetime",
        "display_options": {
          "relative": true
        },
        "field": "date_created",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": [
          "date-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_created",
        "table": "case_invite",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "user_updated",
      "type": "uuid",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": "user",
        "display_options": null,
        "field": "user_updated",
        "group": null,
        "hidden": true,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{avatar}} {{first_name}} {{last_name}}"
        },
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 6,
        "special": [
          "user-updated"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "user_updated",
        "table": "case_invite",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invite",
      "field": "date_updated",
      "type": "timestamp",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": "datetime",
        "display_options": {
          "relative": true
        },
        "field": "date_updated",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 7,
        "special": [
          "date-updated"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_updated",
        "table": "case_invite",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "kind",
      "type": "string",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "kind",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Existing",
              "value": "existing"
            },
            {
              "text": "New User",
              "value": "signup"
            }
          ]
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 8,
        "special": null,
        "translations": null,
        "validation": {
          "_or": [
            {
              "kind": {
                "_eq": "existing"
              }
            },
            {
              "kind": {
                "_eq": "signup"
              }
            }
          ]
        },
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "kind",
        "table": "case_invite",
        "data_type": "character varying",
        "default_value": "signup",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "status",
      "type": "string",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "status",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Pending Approval",
              "value": "pending_approval"
            },
            {
              "text": "Pending Signup",
              "value": "pending_signup"
            },
            {
              "text": "Approved",
              "value": "approved"
            },
            {
              "text": "Rejected",
              "value": "rejected"
            },
            {
              "text": "Accepted",
              "value": "accepted"
            }
          ]
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 9,
        "special": null,
        "translations": null,
        "validation": {
          "status": {
            "_in": [
              "pending_approval",
              "pending_signup",
              "approved",
              "rejected",
              "accepted"
            ]
          }
        },
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "status",
        "table": "case_invite",
        "data_type": "character varying",
        "default_value": "pending_approval",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "case",
      "type": "uuid",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "case",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 10,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "case",
        "table": "case_invite",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "case",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invite",
      "field": "invitee_email",
      "type": "string",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "invitee_email",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": {
          "placeholder": "name@website.com"
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 11,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "invitee_email",
        "table": "case_invite",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "invitee_user",
      "type": "uuid",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "invitee_user",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 12,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "invitee_user",
        "table": "case_invite",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invite",
      "field": "proposed_role",
      "type": "string",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "proposed_role",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Admin",
              "value": "admin"
            },
            {
              "text": "Collaborator",
              "value": "collaborator"
            },
            {
              "text": "Read Only",
              "value": "read_only"
            }
          ]
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 13,
        "special": null,
        "translations": null,
        "validation": {
          "proposed_role": {
            "_in": [
              "admin",
              "collaborator",
              "read_only"
            ]
          }
        },
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "proposed_role",
        "table": "case_invite",
        "data_type": "character varying",
        "default_value": "collaborator",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "inviter",
      "type": "uuid",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "inviter",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 14,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "inviter",
        "table": "case_invite",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invite",
      "field": "expires_at",
      "type": "dateTime",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "expires_at",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 16,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "expires_at",
        "table": "case_invite",
        "data_type": "timestamp without time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "resolved_at",
      "type": "dateTime",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "resolved_at",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 17,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "resolved_at",
        "table": "case_invite",
        "data_type": "timestamp without time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invite",
      "field": "accepted_user",
      "type": "uuid",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "accepted_user",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 18,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "accepted_user",
        "table": "case_invite",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invite",
      "field": "resolved_by",
      "type": "uuid",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "resolved_by",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 19,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "resolved_by",
        "table": "case_invite",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invite",
      "field": "token_hash",
      "type": "string",
      "meta": {
        "collection": "case_invite",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "token_hash",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 20,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "token_hash",
        "table": "case_invite",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "case_invites",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "status",
      "type": "string",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "status",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Pending (existing user)",
              "value": "pending"
            },
            {
              "text": "Pending approval (signup)",
              "value": "pending_approval"
            },
            {
              "text": "Pending signup",
              "value": "pending_signup"
            },
            {
              "text": "Approved",
              "value": "approved"
            },
            {
              "text": "Accepted",
              "value": "accepted"
            },
            {
              "text": "Rejected",
              "value": "rejected"
            },
            {
              "text": "Cancelled",
              "value": "cancelled"
            },
            {
              "text": "Expired",
              "value": "expired"
            }
          ]
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "status",
        "table": "case_invites",
        "data_type": "character varying",
        "default_value": "pending",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "kind",
      "type": "string",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "kind",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Existing user",
              "value": "existing"
            },
            {
              "text": "Signup email",
              "value": "signup"
            }
          ]
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "kind",
        "table": "case_invites",
        "data_type": "character varying",
        "default_value": "existing",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "case",
      "type": "uuid",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "case",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{title}}"
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 4,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "case",
        "table": "case_invites",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "case",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invites",
      "field": "case_title",
      "type": "string",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "case_title",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": "Denormalized title for notifications / emails",
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "case_title",
        "table": "case_invites",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "invitee_email",
      "type": "string",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "invitee_email",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 6,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "invitee_email",
        "table": "case_invites",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "invitee_directus_user",
      "type": "uuid",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "invitee_directus_user",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{email}}"
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 7,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "invitee_directus_user",
        "table": "case_invites",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invites",
      "field": "proposed_role",
      "type": "string",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "proposed_role",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Admin",
              "value": "admin"
            },
            {
              "text": "Collaborator",
              "value": "collaborator"
            },
            {
              "text": "Read only",
              "value": "readonly"
            }
          ]
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 8,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "proposed_role",
        "table": "case_invites",
        "data_type": "character varying",
        "default_value": "collaborator",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "inviter_directus_user",
      "type": "uuid",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "inviter_directus_user",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{email}}"
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 9,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "inviter_directus_user",
        "table": "case_invites",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invites",
      "field": "token_hash",
      "type": "string",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "token_hash",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": "SHA-256 of signup redeem token (never store the raw token)",
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 10,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "token_hash",
        "table": "case_invites",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "expires_at",
      "type": "timestamp",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "expires_at",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 11,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "expires_at",
        "table": "case_invites",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "resolved_at",
      "type": "timestamp",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "resolved_at",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 12,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "resolved_at",
        "table": "case_invites",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "resolved_by_directus_user",
      "type": "uuid",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "resolved_by_directus_user",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{email}}"
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 13,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "resolved_by_directus_user",
        "table": "case_invites",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invites",
      "field": "accepted_directus_user",
      "type": "uuid",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "accepted_directus_user",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{email}}"
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 14,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "accepted_directus_user",
        "table": "case_invites",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "case_invites",
      "field": "date_created",
      "type": "timestamp",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "date_created",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 15,
        "special": [
          "date-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_created",
        "table": "case_invites",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "case_invites",
      "field": "date_updated",
      "type": "timestamp",
      "meta": {
        "collection": "case_invites",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "date_updated",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 16,
        "special": [
          "date-updated"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_updated",
        "table": "case_invites",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "directus_users",
      "field": "notify_registration_approval",
      "type": "boolean",
      "meta": {
        "collection": "directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "notify_registration_approval",
        "group": null,
        "hidden": false,
        "interface": "boolean",
        "note": null,
        "options": null,
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 1,
        "special": [
          "cast-boolean"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "notify_registration_approval",
        "table": "directus_users",
        "data_type": "boolean",
        "default_value": true,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "id",
      "type": "integer",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "pending_registration",
        "data_type": "integer",
        "default_value": "nextval('pending_registration_id_seq'::regclass)",
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": true,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "sort",
      "type": "integer",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "sort",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "sort",
        "table": "pending_registration",
        "data_type": "integer",
        "default_value": null,
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "date_created",
      "type": "timestamp",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": "datetime",
        "display_options": {
          "relative": true
        },
        "field": "date_created",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": [
          "date-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_created",
        "table": "pending_registration",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "date_updated",
      "type": "timestamp",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": "datetime",
        "display_options": {
          "relative": true
        },
        "field": "date_updated",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": [
          "date-updated"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_updated",
        "table": "pending_registration",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "email",
      "type": "string",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "email",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 5,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "email",
        "table": "pending_registration",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "first_name",
      "type": "string",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "first_name",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 6,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "first_name",
        "table": "pending_registration",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "last_name",
      "type": "string",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "last_name",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 7,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "last_name",
        "table": "pending_registration",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "affiliation",
      "type": "string",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "affiliation",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 8,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "affiliation",
        "table": "pending_registration",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "intended_use",
      "type": "string",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "intended_use",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 9,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "intended_use",
        "table": "pending_registration",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "status",
      "type": "string",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "status",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Pending",
              "value": "pending"
            },
            {
              "text": "Approved",
              "value": "approved"
            },
            {
              "text": "Rejected",
              "value": "rejected"
            },
            {
              "text": "Completed",
              "value": "completed"
            }
          ]
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 10,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "status",
        "table": "pending_registration",
        "data_type": "character varying",
        "default_value": "Pending",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "completion_token_hash",
      "type": "string",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "completion_token_hash",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 11,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "completion_token_hash",
        "table": "pending_registration",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "completion_token_expires_at",
      "type": "dateTime",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "completion_token_expires_at",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 12,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "completion_token_expires_at",
        "table": "pending_registration",
        "data_type": "timestamp without time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "is_org_admin",
      "type": "boolean",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "is_org_admin",
        "group": null,
        "hidden": false,
        "interface": "boolean",
        "note": null,
        "options": null,
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 13,
        "special": [
          "cast-boolean"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "is_org_admin",
        "table": "pending_registration",
        "data_type": "boolean",
        "default_value": false,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "pending_registration",
      "field": "user_updated",
      "type": "uuid",
      "meta": {
        "collection": "pending_registration",
        "conditions": null,
        "display": "user",
        "display_options": null,
        "field": "user_updated",
        "group": null,
        "hidden": true,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{first_name}} {{last_name}}"
        },
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 14,
        "special": [
          "user-updated"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "user_updated",
        "table": "pending_registration",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "process_order",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "process_order",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "process_order",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "process_order",
      "field": "status",
      "type": "string",
      "meta": {
        "collection": "process_order",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "status",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Pending",
              "value": "pending"
            },
            {
              "text": "In Progress",
              "value": "in_progress"
            },
            {
              "text": "Completed",
              "value": "completed"
            },
            {
              "text": "Approved",
              "value": "approved"
            },
            {
              "text": "Archived",
              "value": "archived"
            }
          ]
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "status",
        "table": "process_order",
        "data_type": "character varying",
        "default_value": "pending",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "process_order",
      "field": "case",
      "type": "uuid",
      "meta": {
        "collection": "process_order",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "case",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "case",
        "table": "process_order",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "case",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "process_order",
      "field": "process_template",
      "type": "uuid",
      "meta": {
        "collection": "process_order",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "process_template",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "process_template",
        "table": "process_order",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "process_template",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "process_order",
      "field": "ordered_by",
      "type": "uuid",
      "meta": {
        "collection": "process_order",
        "conditions": null,
        "display": "user",
        "display_options": null,
        "field": "ordered_by",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "ordered_by",
        "table": "process_order",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "process_step",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "process_step",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "process_step",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "process_step",
      "field": "name",
      "type": "string",
      "meta": {
        "collection": "process_step",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "name",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "name",
        "table": "process_step",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "process_step",
      "field": "sort",
      "type": "integer",
      "meta": {
        "collection": "process_step",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "sort",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "sort",
        "table": "process_step",
        "data_type": "integer",
        "default_value": null,
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "process_step",
      "field": "process_template",
      "type": "uuid",
      "meta": {
        "collection": "process_step",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "process_template",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "process_template",
        "table": "process_step",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "process_template",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "process_step",
      "field": "team",
      "type": "uuid",
      "meta": {
        "collection": "process_step",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "team",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "team",
        "table": "process_step",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "team",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "process_template",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "process_template",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "process_template",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "process_template",
      "field": "name",
      "type": "string",
      "meta": {
        "collection": "process_template",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "name",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "name",
        "table": "process_template",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "process_template",
      "field": "description",
      "type": "text",
      "meta": {
        "collection": "process_template",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "description",
        "group": null,
        "hidden": false,
        "interface": "input-multiline",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "description",
        "table": "process_template",
        "data_type": "text",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "site_announcement",
      "field": "id",
      "type": "integer",
      "meta": {
        "collection": "site_announcement",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "numeric",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "site_announcement",
        "data_type": "integer",
        "default_value": "nextval('site_announcement_id_seq'::regclass)",
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": true,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "site_announcement",
      "field": "enabled",
      "type": "boolean",
      "meta": {
        "collection": "site_announcement",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "enabled",
        "group": null,
        "hidden": false,
        "interface": "boolean",
        "note": "Show the banner to logged-in users.",
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": [
          "cast-boolean"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "enabled",
        "table": "site_announcement",
        "data_type": "boolean",
        "default_value": false,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "site_announcement",
      "field": "severity",
      "type": "string",
      "meta": {
        "collection": "site_announcement",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "severity",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": "Controls the banner colour.",
        "options": {
          "choices": [
            {
              "text": "Info",
              "value": "info"
            },
            {
              "text": "Warning",
              "value": "warning"
            },
            {
              "text": "Error",
              "value": "error"
            }
          ]
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "severity",
        "table": "site_announcement",
        "data_type": "character varying",
        "default_value": "info",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "site_announcement",
      "field": "message",
      "type": "text",
      "meta": {
        "collection": "site_announcement",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "message",
        "group": null,
        "hidden": false,
        "interface": "input-multiline",
        "note": "The text shown in the banner. Plain text — no HTML.",
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "message",
        "table": "site_announcement",
        "data_type": "text",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "site_announcement",
      "field": "expires_at",
      "type": "timestamp",
      "meta": {
        "collection": "site_announcement",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "expires_at",
        "group": null,
        "hidden": false,
        "interface": "datetime",
        "note": "Optional. Banner auto-hides after this time even if enabled is still checked.",
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "expires_at",
        "table": "site_announcement",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "site_announcement",
      "field": "date_updated",
      "type": "timestamp",
      "meta": {
        "collection": "site_announcement",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "date_updated",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 6,
        "special": [
          "date-updated"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_updated",
        "table": "site_announcement",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "task",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "task",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task",
      "field": "status",
      "type": "string",
      "meta": {
        "collection": "task",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "status",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown",
        "note": null,
        "options": {
          "choices": [
            {
              "text": "Pending",
              "value": "pending"
            },
            {
              "text": "In Progress",
              "value": "in_progress"
            },
            {
              "text": "Done",
              "value": "done"
            }
          ]
        },
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "status",
        "table": "task",
        "data_type": "character varying",
        "default_value": "pending",
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task",
      "field": "result_notes",
      "type": "text",
      "meta": {
        "collection": "task",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "result_notes",
        "group": null,
        "hidden": false,
        "interface": "input-multiline",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "result_notes",
        "table": "task",
        "data_type": "text",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task",
      "field": "process_order",
      "type": "uuid",
      "meta": {
        "collection": "task",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "process_order",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "process_order",
        "table": "task",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "process_order",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "task",
      "field": "process_step",
      "type": "uuid",
      "meta": {
        "collection": "task",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "process_step",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "process_step",
        "table": "task",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "process_step",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "task",
      "field": "assigned_to",
      "type": "uuid",
      "meta": {
        "collection": "task",
        "conditions": null,
        "display": "user",
        "display_options": null,
        "field": "assigned_to",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 6,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "assigned_to",
        "table": "task",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "task_group_members",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "task_group_members",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "task_group_members",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_group_members",
      "field": "task_group",
      "type": "uuid",
      "meta": {
        "collection": "task_group_members",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "task_group",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{name}}"
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 2,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "task_group",
        "table": "task_group_members",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "task_groups",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "task_group_members",
      "field": "directus_user",
      "type": "uuid",
      "meta": {
        "collection": "task_group_members",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "directus_user",
        "group": null,
        "hidden": false,
        "interface": "select-dropdown-m2o",
        "note": null,
        "options": {
          "template": "{{email}}"
        },
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 3,
        "special": [
          "m2o"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "directus_user",
        "table": "task_group_members",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "task_group_members",
      "field": "can_manage_group",
      "type": "boolean",
      "meta": {
        "collection": "task_group_members",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "can_manage_group",
        "group": null,
        "hidden": false,
        "interface": "boolean",
        "note": "Member can add/remove members and edit group settings.",
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": [
          "cast-boolean"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "can_manage_group",
        "table": "task_group_members",
        "data_type": "boolean",
        "default_value": false,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_group_members",
      "field": "date_created",
      "type": "timestamp",
      "meta": {
        "collection": "task_group_members",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "date_created",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": [
          "date-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_created",
        "table": "task_group_members",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_groups",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "task_groups",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "task_groups",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_groups",
      "field": "name",
      "type": "string",
      "meta": {
        "collection": "task_groups",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "name",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": true,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "name",
        "table": "task_groups",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_groups",
      "field": "description",
      "type": "text",
      "meta": {
        "collection": "task_groups",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "description",
        "group": null,
        "hidden": false,
        "interface": "input-multiline",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "description",
        "table": "task_groups",
        "data_type": "text",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_groups",
      "field": "can_approve_registrations",
      "type": "boolean",
      "meta": {
        "collection": "task_groups",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "can_approve_registrations",
        "group": null,
        "hidden": false,
        "interface": "boolean",
        "note": "Members of this group can approve or reject registration requests.",
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": [
          "cast-boolean"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "can_approve_registrations",
        "table": "task_groups",
        "data_type": "boolean",
        "default_value": false,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_groups",
      "field": "date_created",
      "type": "timestamp",
      "meta": {
        "collection": "task_groups",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "date_created",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 5,
        "special": [
          "date-created"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_created",
        "table": "task_groups",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "task_groups",
      "field": "date_updated",
      "type": "timestamp",
      "meta": {
        "collection": "task_groups",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "date_updated",
        "group": null,
        "hidden": true,
        "interface": "datetime",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 6,
        "special": [
          "date-updated"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "half"
      },
      "schema": {
        "name": "date_updated",
        "table": "task_groups",
        "data_type": "timestamp with time zone",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "team",
      "field": "id",
      "type": "uuid",
      "meta": {
        "collection": "team",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": true,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": [
          "uuid"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "team",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "team",
      "field": "name",
      "type": "string",
      "meta": {
        "collection": "team",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "name",
        "group": null,
        "hidden": false,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "name",
        "table": "team",
        "data_type": "character varying",
        "default_value": null,
        "max_length": 255,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "team",
      "field": "description",
      "type": "text",
      "meta": {
        "collection": "team",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "description",
        "group": null,
        "hidden": false,
        "interface": "input-multiline",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "description",
        "table": "team",
        "data_type": "text",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "team",
      "field": "members",
      "type": "alias",
      "meta": {
        "collection": "team",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "members",
        "group": null,
        "hidden": false,
        "interface": "list-m2m",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 4,
        "special": [
          "m2m"
        ],
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      }
    },
    {
      "collection": "team_directus_users",
      "field": "id",
      "type": "integer",
      "meta": {
        "collection": "team_directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "id",
        "group": null,
        "hidden": true,
        "interface": "input",
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 1,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "id",
        "table": "team_directus_users",
        "data_type": "integer",
        "default_value": "nextval('team_directus_users_id_seq'::regclass)",
        "max_length": null,
        "numeric_precision": 32,
        "numeric_scale": 0,
        "is_nullable": false,
        "is_unique": true,
        "is_indexed": false,
        "is_primary_key": true,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": true,
        "foreign_key_table": null,
        "foreign_key_column": null
      }
    },
    {
      "collection": "team_directus_users",
      "field": "team_id",
      "type": "uuid",
      "meta": {
        "collection": "team_directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "team_id",
        "group": null,
        "hidden": true,
        "interface": null,
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 2,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "team_id",
        "table": "team_directus_users",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "team",
        "foreign_key_column": "id"
      }
    },
    {
      "collection": "team_directus_users",
      "field": "directus_users_id",
      "type": "uuid",
      "meta": {
        "collection": "team_directus_users",
        "conditions": null,
        "display": null,
        "display_options": null,
        "field": "directus_users_id",
        "group": null,
        "hidden": true,
        "interface": null,
        "note": null,
        "options": null,
        "readonly": false,
        "required": false,
        "searchable": true,
        "sort": 3,
        "special": null,
        "translations": null,
        "validation": null,
        "validation_message": null,
        "width": "full"
      },
      "schema": {
        "name": "directus_users_id",
        "table": "team_directus_users",
        "data_type": "uuid",
        "default_value": null,
        "max_length": null,
        "numeric_precision": null,
        "numeric_scale": null,
        "is_nullable": true,
        "is_unique": false,
        "is_indexed": false,
        "is_primary_key": false,
        "is_generated": false,
        "generation_expression": null,
        "has_auto_increment": false,
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id"
      }
    }
  ],
  "systemFields": [
    {
      "collection": "directus_activity",
      "field": "timestamp",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_clients",
      "field": "date_created",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_codes",
      "field": "expires_at",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_codes",
      "field": "used_at",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_consents",
      "field": "client",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_tokens",
      "field": "code_hash",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_tokens",
      "field": "expires_at",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_tokens",
      "field": "previous_session",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_oauth_tokens",
      "field": "session",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_revisions",
      "field": "activity",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_revisions",
      "field": "parent",
      "schema": {
        "is_indexed": true
      }
    },
    {
      "collection": "directus_sessions",
      "field": "oauth_client",
      "schema": {
        "is_indexed": true
      }
    }
  ],
  "relations": [
    {
      "collection": "attachment",
      "field": "case",
      "related_collection": "case",
      "meta": {
        "junction_field": null,
        "many_collection": "attachment",
        "many_field": "case",
        "one_allowed_collections": null,
        "one_collection": "case",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": "attachments",
        "sort_field": null
      }
    },
    {
      "collection": "attachment",
      "field": "file",
      "related_collection": "directus_files",
      "meta": {
        "junction_field": null,
        "many_collection": "attachment",
        "many_field": "file",
        "one_allowed_collections": null,
        "one_collection": "directus_files",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "attachment",
        "column": "file",
        "foreign_key_table": "directus_files",
        "foreign_key_column": "id",
        "constraint_name": "attachment_file_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "attachment",
      "field": "parent",
      "related_collection": "attachment",
      "meta": {
        "junction_field": null,
        "many_collection": "attachment",
        "many_field": "parent",
        "one_allowed_collections": null,
        "one_collection": "attachment",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "attachment",
        "column": "parent",
        "foreign_key_table": "attachment",
        "foreign_key_column": "id",
        "constraint_name": "attachment_parent_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "attachment",
      "field": "user_created",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "attachment",
        "many_field": "user_created",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "attachment",
        "column": "user_created",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "attachment_user_created_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case",
      "field": "user_created",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case",
        "many_field": "user_created",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case",
        "column": "user_created",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_user_created_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_directus_users",
      "field": "directus_users_id",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": "case_id",
        "many_collection": "case_directus_users",
        "many_field": "directus_users_id",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_directus_users",
        "column": "directus_users_id",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_directus_users_directus_users_id_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_directus_users",
      "field": "case_id",
      "related_collection": "case",
      "meta": {
        "junction_field": "directus_users_id",
        "many_collection": "case_directus_users",
        "many_field": "case_id",
        "one_allowed_collections": null,
        "one_collection": "case",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": "collaborators",
        "sort_field": null
      },
      "schema": {
        "table": "case_directus_users",
        "column": "case_id",
        "foreign_key_table": "case",
        "foreign_key_column": "id",
        "constraint_name": "case_directus_users_case_id_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invite",
      "field": "user_created",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invite",
        "many_field": "user_created",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invite",
        "column": "user_created",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invite_user_created_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "case_invite",
      "field": "user_updated",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invite",
        "many_field": "user_updated",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invite",
        "column": "user_updated",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invite_user_updated_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "case_invite",
      "field": "case",
      "related_collection": "case",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invite",
        "many_field": "case",
        "one_allowed_collections": null,
        "one_collection": "case",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invite",
        "column": "case",
        "foreign_key_table": "case",
        "foreign_key_column": "id",
        "constraint_name": "case_invite_case_foreign",
        "on_update": "NO ACTION",
        "on_delete": "CASCADE"
      }
    },
    {
      "collection": "case_invite",
      "field": "invitee_user",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invite",
        "many_field": "invitee_user",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invite",
        "column": "invitee_user",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invite_invitee_user_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invite",
      "field": "inviter",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invite",
        "many_field": "inviter",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invite",
        "column": "inviter",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invite_inviter_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invite",
      "field": "accepted_user",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invite",
        "many_field": "accepted_user",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invite",
        "column": "accepted_user",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invite_accepted_user_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invite",
      "field": "resolved_by",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invite",
        "many_field": "resolved_by",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invite",
        "column": "resolved_by",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invite_resolved_by_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invites",
      "field": "case",
      "related_collection": "case",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invites",
        "many_field": "case",
        "one_allowed_collections": null,
        "one_collection": "case",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invites",
        "column": "case",
        "foreign_key_table": "case",
        "foreign_key_column": "id",
        "constraint_name": "case_invites_case_foreign",
        "on_update": "NO ACTION",
        "on_delete": "CASCADE"
      }
    },
    {
      "collection": "case_invites",
      "field": "invitee_directus_user",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invites",
        "many_field": "invitee_directus_user",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invites",
        "column": "invitee_directus_user",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invites_invitee_directus_user_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invites",
      "field": "inviter_directus_user",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invites",
        "many_field": "inviter_directus_user",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invites",
        "column": "inviter_directus_user",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invites_inviter_directus_user_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invites",
      "field": "resolved_by_directus_user",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invites",
        "many_field": "resolved_by_directus_user",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invites",
        "column": "resolved_by_directus_user",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invites_resolved_by_directus_user_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "case_invites",
      "field": "accepted_directus_user",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "case_invites",
        "many_field": "accepted_directus_user",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "case_invites",
        "column": "accepted_directus_user",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "case_invites_accepted_directus_user_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "pending_registration",
      "field": "user_updated",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "pending_registration",
        "many_field": "user_updated",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "pending_registration",
        "column": "user_updated",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "pending_registration_user_updated_foreign",
        "on_update": "NO ACTION",
        "on_delete": "SET NULL"
      }
    },
    {
      "collection": "process_order",
      "field": "case",
      "related_collection": "case",
      "meta": {
        "junction_field": null,
        "many_collection": "process_order",
        "many_field": "case",
        "one_allowed_collections": null,
        "one_collection": "case",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "process_order",
        "column": "case",
        "foreign_key_table": "case",
        "foreign_key_column": "id",
        "constraint_name": "process_order_case_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "process_order",
      "field": "process_template",
      "related_collection": "process_template",
      "meta": {
        "junction_field": null,
        "many_collection": "process_order",
        "many_field": "process_template",
        "one_allowed_collections": null,
        "one_collection": "process_template",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "process_order",
        "column": "process_template",
        "foreign_key_table": "process_template",
        "foreign_key_column": "id",
        "constraint_name": "process_order_process_template_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "process_order",
      "field": "ordered_by",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "process_order",
        "many_field": "ordered_by",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "process_order",
        "column": "ordered_by",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "process_order_ordered_by_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "process_step",
      "field": "process_template",
      "related_collection": "process_template",
      "meta": {
        "junction_field": null,
        "many_collection": "process_step",
        "many_field": "process_template",
        "one_allowed_collections": null,
        "one_collection": "process_template",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "process_step",
        "column": "process_template",
        "foreign_key_table": "process_template",
        "foreign_key_column": "id",
        "constraint_name": "process_step_process_template_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "process_step",
      "field": "team",
      "related_collection": "team",
      "meta": {
        "junction_field": null,
        "many_collection": "process_step",
        "many_field": "team",
        "one_allowed_collections": null,
        "one_collection": "team",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "process_step",
        "column": "team",
        "foreign_key_table": "team",
        "foreign_key_column": "id",
        "constraint_name": "process_step_team_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "task",
      "field": "process_order",
      "related_collection": "process_order",
      "meta": {
        "junction_field": null,
        "many_collection": "task",
        "many_field": "process_order",
        "one_allowed_collections": null,
        "one_collection": "process_order",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "task",
        "column": "process_order",
        "foreign_key_table": "process_order",
        "foreign_key_column": "id",
        "constraint_name": "task_process_order_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "task",
      "field": "process_step",
      "related_collection": "process_step",
      "meta": {
        "junction_field": null,
        "many_collection": "task",
        "many_field": "process_step",
        "one_allowed_collections": null,
        "one_collection": "process_step",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "task",
        "column": "process_step",
        "foreign_key_table": "process_step",
        "foreign_key_column": "id",
        "constraint_name": "task_process_step_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "task",
      "field": "assigned_to",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "task",
        "many_field": "assigned_to",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "task",
        "column": "assigned_to",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "task_assigned_to_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "task_group_members",
      "field": "task_group",
      "related_collection": "task_groups",
      "meta": {
        "junction_field": null,
        "many_collection": "task_group_members",
        "many_field": "task_group",
        "one_allowed_collections": null,
        "one_collection": "task_groups",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "task_group_members",
        "column": "task_group",
        "foreign_key_table": "task_groups",
        "foreign_key_column": "id",
        "constraint_name": "task_group_members_task_group_foreign",
        "on_update": "NO ACTION",
        "on_delete": "CASCADE"
      }
    },
    {
      "collection": "task_group_members",
      "field": "directus_user",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "task_group_members",
        "many_field": "directus_user",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "task_group_members",
        "column": "directus_user",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "task_group_members_directus_user_foreign",
        "on_update": "NO ACTION",
        "on_delete": "CASCADE"
      }
    },
    {
      "collection": "team_directus_users",
      "field": "team_id",
      "related_collection": "team",
      "meta": {
        "junction_field": null,
        "many_collection": "team_directus_users",
        "many_field": "team_id",
        "one_allowed_collections": null,
        "one_collection": "team",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": "members",
        "sort_field": null
      },
      "schema": {
        "table": "team_directus_users",
        "column": "team_id",
        "foreign_key_table": "team",
        "foreign_key_column": "id",
        "constraint_name": "team_directus_users_team_id_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    },
    {
      "collection": "team_directus_users",
      "field": "directus_users_id",
      "related_collection": "directus_users",
      "meta": {
        "junction_field": null,
        "many_collection": "team_directus_users",
        "many_field": "directus_users_id",
        "one_allowed_collections": null,
        "one_collection": "directus_users",
        "one_collection_field": null,
        "one_deselect_action": "nullify",
        "one_field": null,
        "sort_field": null
      },
      "schema": {
        "table": "team_directus_users",
        "column": "directus_users_id",
        "foreign_key_table": "directus_users",
        "foreign_key_column": "id",
        "constraint_name": "team_directus_users_directus_users_id_foreign",
        "on_update": "NO ACTION",
        "on_delete": "NO ACTION"
      }
    }
  ]
};

const ROLES = [
  {
    "id": "1beea714-840e-4aba-b3af-8990d14250b6",
    "name": "Administrator",
    "icon": "verified",
    "description": "$t:admin_description",
    "parent": null,
    "children": [],
    "policies": [
      "a3bb4ae2-cbd1-4de2-9225-0ece4300c978"
    ],
    "users": [
      "761711ea-2fce-41bc-975c-ac0351b8899c",
      "ca1d02c8-6989-4e41-9132-14bfbfd4c8e1"
    ]
  },
  {
    "id": "657f5419-a0e2-43f9-9281-719748261410",
    "name": "Slicer Web Service User",
    "icon": "supervised_user_circle",
    "description": null,
    "parent": null,
    "children": [],
    "policies": [
      "2212d932-5c16-4518-bb41-7c7d43d40483"
    ],
    "users": [
      "46432a04-07d6-4cc2-8618-d86e6de13413"
    ]
  },
  {
    "id": "6beab6c0-9022-4c53-abbe-ccffc5281528",
    "name": "Employee",
    "icon": "account_box",
    "description": "A non-it, clinician or hospital employee access role",
    "parent": null,
    "children": [],
    "policies": [
      "38130f9f-7a51-49dc-b924-fb7f8e9d4cb6"
    ],
    "users": [
      "0cbcc9e8-1411-4564-b79d-4b3793f268e4",
      "476dae2a-1ce5-454b-8bdf-3a084c35a04d",
      "4ad745c7-649c-4049-a4b2-64e4cad2ab98",
      "8589cd69-9f8f-4317-84c9-0baa11a70fb9",
      "c6b59bdf-e030-460e-a52f-76ef7dfa608c"
    ]
  },
  {
    "id": "e17973da-db6d-4c87-8295-3e698afd9d0f",
    "name": "OrgAdmin",
    "icon": "supervised_user_circle",
    "description": "The org level administrator. Can approve accounts, elevate permissions etc. within an org",
    "parent": null,
    "children": [],
    "policies": [
      "9261eae4-5ff1-4d57-99e9-5e1bcfb99055",
      "1e1f9848-85f7-405f-b8a5-b3e1d0ab9572"
    ],
    "users": [
      "4b2c6acf-6a0d-4eda-85de-24eafb958ac3"
    ]
  },
  {
    "id": "e75d9e9f-77aa-4510-ad45-f06a1292e956",
    "name": "Clinician",
    "icon": "supervised_user_circle",
    "description": null,
    "parent": null,
    "children": [],
    "policies": [
      "e37c3112-eed8-4045-8999-5b1163767519"
    ],
    "users": [
      "24ee1da1-6246-44b0-973f-45d21a0f5501",
      "4c3b1cab-8999-45d6-89d9-844e596c10f1",
      "4fa0228e-322a-42cc-875a-b04838957b58",
      "7e9bd808-0b8a-4499-aa6c-1e5acfb3cc1c",
      "a3cc4031-2483-4f2a-acf1-e71594ec0fa2",
      "dc2949a6-55ee-4007-9d05-7299311955cf",
      "f6c04318-c2e6-4039-99c6-93e2898b9bda"
    ]
  }
];

const POLICIES = [
  {
    "id": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d",
    "name": "Employee",
    "icon": "badge",
    "description": null,
    "ip_access": null,
    "enforce_tfa": false,
    "admin_access": false,
    "app_access": false,
    "permissions": [
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16,
      17
    ],
    "users": [
      "38130f9f-7a51-49dc-b924-fb7f8e9d4cb6"
    ],
    "roles": [
      "38130f9f-7a51-49dc-b924-fb7f8e9d4cb6"
    ]
  },
  {
    "id": "2da7992f-d48d-457f-876f-87b5dbdf1e0d",
    "name": "Slicer Web Service Policy",
    "icon": "badge",
    "description": "A policy for service accounts",
    "ip_access": null,
    "enforce_tfa": false,
    "admin_access": false,
    "app_access": false,
    "permissions": [
      1,
      2,
      3,
      37,
      39,
      40,
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50,
      52,
      54,
      55,
      56,
      57,
      58,
      59,
      60,
      61,
      62,
      64,
      65
    ],
    "users": [
      "d6b93d1e-8097-4c76-b97b-5ba82c55866e",
      "2212d932-5c16-4518-bb41-7c7d43d40483"
    ],
    "roles": [
      "d6b93d1e-8097-4c76-b97b-5ba82c55866e",
      "2212d932-5c16-4518-bb41-7c7d43d40483"
    ]
  },
  {
    "id": "42bd9a10-f3dd-4651-badd-2b36877b6535",
    "name": "Administrator",
    "icon": "verified",
    "description": "$t:admin_description",
    "ip_access": null,
    "enforce_tfa": false,
    "admin_access": true,
    "app_access": true,
    "permissions": [],
    "users": [
      "a3bb4ae2-cbd1-4de2-9225-0ece4300c978"
    ],
    "roles": [
      "a3bb4ae2-cbd1-4de2-9225-0ece4300c978"
    ]
  },
  {
    "id": "9a9505bb-26a4-432c-af9d-1633237c850f",
    "name": "clinician",
    "icon": "badge",
    "description": null,
    "ip_access": null,
    "enforce_tfa": false,
    "admin_access": false,
    "app_access": false,
    "permissions": [
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      35,
      36,
      38,
      53
    ],
    "users": [
      "e37c3112-eed8-4045-8999-5b1163767519",
      "9261eae4-5ff1-4d57-99e9-5e1bcfb99055",
      "21eda2cf-fed7-4963-a572-78e8d8ed33a4"
    ],
    "roles": [
      "e37c3112-eed8-4045-8999-5b1163767519",
      "9261eae4-5ff1-4d57-99e9-5e1bcfb99055",
      "21eda2cf-fed7-4963-a572-78e8d8ed33a4"
    ]
  },
  {
    "id": "abf8a154-5b1c-4a46-ac9c-7300570f4f17",
    "name": "$t:public_label",
    "icon": "public",
    "description": "$t:public_description",
    "ip_access": null,
    "enforce_tfa": false,
    "admin_access": false,
    "app_access": false,
    "permissions": [],
    "users": [
      "85cfbdbf-4236-442b-97b5-20fe6b9c0212"
    ],
    "roles": [
      "85cfbdbf-4236-442b-97b5-20fe6b9c0212"
    ]
  },
  {
    "id": "e2d02e46-5bf3-494e-b8cc-952aa7825208",
    "name": "org_admin",
    "icon": "badge",
    "description": null,
    "ip_access": null,
    "enforce_tfa": false,
    "admin_access": false,
    "app_access": false,
    "permissions": [
      51
    ],
    "users": [
      "1e1f9848-85f7-405f-b8a5-b3e1d0ab9572"
    ],
    "roles": [
      "1e1f9848-85f7-405f-b8a5-b3e1d0ab9572"
    ]
  },
  {
    "id": "ebe6d295-c499-42d9-9f70-b89e739a7a19",
    "name": "Can Approve Registrations",
    "icon": "badge",
    "description": null,
    "ip_access": null,
    "enforce_tfa": false,
    "admin_access": false,
    "app_access": false,
    "permissions": [
      63
    ],
    "users": [],
    "roles": []
  }
];

const PERMISSIONS = [
  {
    "id": 1,
    "collection": "directus_users",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 2,
    "collection": "directus_users",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 3,
    "collection": "directus_users",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 4,
    "collection": "case",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 5,
    "collection": "case",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 6,
    "collection": "case",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 7,
    "collection": "case",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 8,
    "collection": "attachment",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 9,
    "collection": "attachment",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 10,
    "collection": "attachment",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 11,
    "collection": "attachment",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 12,
    "collection": "directus_files",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 13,
    "collection": "directus_files",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 14,
    "collection": "directus_files",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 15,
    "collection": "directus_comments",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 16,
    "collection": "directus_comments",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 17,
    "collection": "directus_users",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d"
  },
  {
    "id": 19,
    "collection": "case",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "title",
      "description",
      "status",
      "attachments",
      "collaborators"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 20,
    "collection": "case",
    "action": "update",
    "permissions": {
      "case": {
        "_or": [
          {
            "user_created": {
              "_eq": "$CURRENT_USER"
            }
          },
          {
            "collaborators": {
              "directus_users_id": {
                "_eq": "$CURRENT_USER"
              }
            }
          }
        ]
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "title",
      "description",
      "status",
      "attachments",
      "collaborators"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 21,
    "collection": "case",
    "action": "delete",
    "permissions": {
      "user_created": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": null,
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 22,
    "collection": "case_directus_users",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 23,
    "collection": "directus_users",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "first_name",
      "last_name",
      "email",
      "avatar",
      "role",
      "id",
      "status"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 24,
    "collection": "case",
    "action": "read",
    "permissions": {
      "_or": [
        {
          "user_created": {
            "_eq": "$CURRENT_USER"
          }
        },
        {
          "collaborators": {
            "directus_users_id": {
              "_eq": "$CURRENT_USER"
            }
          }
        }
      ]
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 25,
    "collection": "attachment",
    "action": "read",
    "permissions": {
      "case": {
        "_or": [
          {
            "user_created": {
              "_eq": "$CURRENT_USER"
            }
          },
          {
            "collaborators": {
              "directus_users_id": {
                "_eq": "$CURRENT_USER"
              }
            }
          }
        ]
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 26,
    "collection": "attachment",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 27,
    "collection": "attachment",
    "action": "update",
    "permissions": {
      "case": {
        "_or": [
          {
            "user_created": {
              "_eq": "$CURRENT_USER"
            }
          },
          {
            "collaborators": {
              "directus_users_id": {
                "_eq": "$CURRENT_USER"
              }
            }
          }
        ]
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "file",
      "name",
      "parent"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 28,
    "collection": "directus_files",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 29,
    "collection": "directus_files",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 30,
    "collection": "directus_files",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 31,
    "collection": "directus_files",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 32,
    "collection": "case_directus_users",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 33,
    "collection": "case_directus_users",
    "action": "delete",
    "permissions": {
      "_or": [
        {
          "case_id": {
            "user_created": {
              "_eq": "$CURRENT_USER"
            }
          }
        },
        {
          "case_id": {
            "collaborators": {
              "_some": {
                "_and": [
                  {
                    "directus_users_id": {
                      "_eq": "$CURRENT_USER"
                    }
                  },
                  {
                    "role": {
                      "_eq": "admin"
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 35,
    "collection": "directus_comments",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 36,
    "collection": "directus_comments",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 37,
    "collection": "directus_activity",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 38,
    "collection": "case_directus_users",
    "action": "update",
    "permissions": {
      "_or": [
        {
          "case_id": {
            "user_created": {
              "_eq": "$CURRENT_USER"
            }
          }
        },
        {
          "case_id": {
            "collaborators": {
              "_some": {
                "_and": [
                  {
                    "directus_users_id": {
                      "_eq": "$CURRENT_USER"
                    }
                  },
                  {
                    "role": {
                      "_eq": "admin"
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    },
    "validation": null,
    "presets": null,
    "fields": null,
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 39,
    "collection": "case_directus_users",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 40,
    "collection": "case_directus_users",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 41,
    "collection": "case_directus_users",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 42,
    "collection": "case",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "id",
      "collaborators",
      "user_created",
      "title"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 43,
    "collection": "case_directus_users",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 44,
    "collection": "case_invite",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 45,
    "collection": "case_invite",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 46,
    "collection": "case_invite",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 47,
    "collection": "case_invite",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 48,
    "collection": "pending_registration",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 49,
    "collection": "pending_registration",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 50,
    "collection": "pending_registration",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 51,
    "collection": "directus_roles",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "name",
      "id"
    ],
    "policy": "e2d02e46-5bf3-494e-b8cc-952aa7825208"
  },
  {
    "id": 52,
    "collection": "pending_registration",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 53,
    "collection": "attachment",
    "action": "delete",
    "permissions": {
      "user_created": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": null,
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f"
  },
  {
    "id": 54,
    "collection": "attachment",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 55,
    "collection": "task_group_members",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 56,
    "collection": "task_group_members",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 57,
    "collection": "task_group_members",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 58,
    "collection": "task_group_members",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 59,
    "collection": "task_groups",
    "action": "create",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 60,
    "collection": "task_groups",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 61,
    "collection": "task_groups",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 62,
    "collection": "task_groups",
    "action": "delete",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 63,
    "collection": "pending_registration",
    "action": "update",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "ebe6d295-c499-42d9-9f70-b89e739a7a19"
  },
  {
    "id": 64,
    "collection": "site_announcement",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "id": 65,
    "collection": "directus_revisions",
    "action": "read",
    "permissions": null,
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_collections",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_fields",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_relations",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_translations",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {
      "user": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_activity",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {
      "user_created": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_comments",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": {
      "comment": {
        "_nnull": true
      }
    },
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_comments",
    "action": "create"
  },
  {
    "policy": null,
    "permissions": {
      "user_created": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "comment"
    ],
    "system": true,
    "collection": "directus_comments",
    "action": "update"
  },
  {
    "policy": null,
    "permissions": {
      "user_created": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_comments",
    "action": "delete"
  },
  {
    "policy": null,
    "permissions": {
      "_or": [
        {
          "user": {
            "_eq": "$CURRENT_USER"
          }
        },
        {
          "_and": [
            {
              "user": {
                "_null": true
              }
            },
            {
              "role": {
                "_eq": "$CURRENT_ROLE"
              }
            }
          ]
        },
        {
          "_and": [
            {
              "user": {
                "_null": true
              }
            },
            {
              "role": {
                "_null": true
              }
            }
          ]
        }
      ]
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_presets",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": {
      "user": {
        "_eq": "$CURRENT_USER"
      }
    },
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_presets",
    "action": "create"
  },
  {
    "policy": null,
    "permissions": {
      "user": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": {
      "user": {
        "_eq": "$CURRENT_USER"
      }
    },
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_presets",
    "action": "update"
  },
  {
    "policy": null,
    "permissions": {
      "user": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_presets",
    "action": "delete"
  },
  {
    "policy": null,
    "permissions": {
      "id": {
        "_in": "$CURRENT_ROLES"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_roles",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_settings",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {},
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_translations",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {
      "recipient": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_notifications",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {
      "recipient": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "status"
    ],
    "system": true,
    "collection": "directus_notifications",
    "action": "update"
  },
  {
    "policy": null,
    "permissions": {
      "user_created": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "*"
    ],
    "system": true,
    "collection": "directus_shares",
    "action": "read"
  },
  {
    "policy": null,
    "permissions": {
      "id": {
        "_eq": "$CURRENT_USER"
      }
    },
    "validation": null,
    "presets": null,
    "fields": [
      "id",
      "first_name",
      "last_name",
      "last_page",
      "email",
      "password",
      "location",
      "title",
      "description",
      "tags",
      "provider",
      "preferences_divider",
      "avatar",
      "language",
      "appearance",
      "theme_light",
      "theme_dark",
      "tfa_secret",
      "status",
      "role"
    ],
    "system": true,
    "collection": "directus_users",
    "action": "read"
  }
];

const ACCESS = [
  {
    "id": "e37c3112-eed8-4045-8999-5b1163767519",
    "role": "e75d9e9f-77aa-4510-ad45-f06a1292e956",
    "user": null,
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f",
    "sort": 1
  },
  {
    "id": "85cfbdbf-4236-442b-97b5-20fe6b9c0212",
    "role": null,
    "user": null,
    "policy": "abf8a154-5b1c-4a46-ac9c-7300570f4f17",
    "sort": 1
  },
  {
    "id": "9261eae4-5ff1-4d57-99e9-5e1bcfb99055",
    "role": "e17973da-db6d-4c87-8295-3e698afd9d0f",
    "user": null,
    "policy": "9a9505bb-26a4-432c-af9d-1633237c850f",
    "sort": 1
  },
  {
    "id": "1e1f9848-85f7-405f-b8a5-b3e1d0ab9572",
    "role": "e17973da-db6d-4c87-8295-3e698afd9d0f",
    "user": null,
    "policy": "e2d02e46-5bf3-494e-b8cc-952aa7825208",
    "sort": 2
  },
  {
    "id": "2212d932-5c16-4518-bb41-7c7d43d40483",
    "role": "657f5419-a0e2-43f9-9281-719748261410",
    "user": null,
    "policy": "2da7992f-d48d-457f-876f-87b5dbdf1e0d",
    "sort": null
  },
  {
    "id": "38130f9f-7a51-49dc-b924-fb7f8e9d4cb6",
    "role": "6beab6c0-9022-4c53-abbe-ccffc5281528",
    "user": null,
    "policy": "0e3b0a1f-c62f-436f-970f-277fc7f8d82d",
    "sort": null
  },
  {
    "id": "a3bb4ae2-cbd1-4de2-9225-0ece4300c978",
    "role": "1beea714-840e-4aba-b3af-8990d14250b6",
    "user": null,
    "policy": "42bd9a10-f3dd-4651-badd-2b36877b6535",
    "sort": null
  }
];

// --- CLI (identical shape to setup.mjs, minus reading an external reference file) ---

function parseArgs(argv) {
    const auth = parseAuthFlags(argv);
    const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
    const opts = {};
    for (const arg of argv) {
        if (arg.startsWith('--target-url=')) opts.targetUrl = arg.slice('--target-url='.length).trim();
    }
    return {
        ...auth,
        login: !auth.pasteToken && !auth.allowServiceToken,
        allowChanges: flags.has('allow-changes'),
        noSeed: flags.has('no-seed'),
        targetUrl: opts.targetUrl || null
    };
}

function printHelp() {
    console.log(`One-time Directus setup — hard-coded model, generated 2026-10-15T18:31:07.126Z.

Requires:
  --target-url=<url>  The fresh/empty instance to set up (deliberately separate from
                       DIRECTUS_URL so you can't apply to your own .env instance by accident)

Auth (pick one; nothing admin is stored in .env):
  default / --login     Interactive Directus Administrator email + password (+ OTP)
  --paste-token         Paste a one-run access/static token (not saved)
  --allow-service-token Lab only: reuse DIRECTUS_TOKEN if it is admin

Flags:
  --dry-run        Print what would change, apply nothing
  --allow-changes  Also apply schema edits/deletions the diff reports (default: only
                   ever add new collections/fields/relations)
  --no-seed        Skip seeding the "Registration Reviewers" group / admin sync
  --help

Examples:
  node scripts/directus-schema/bootstrap.mjs --target-url=https://my-fresh-instance --dry-run
  node scripts/directus-schema/bootstrap.mjs --target-url=https://my-fresh-instance
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    if (!args.targetUrl) {
        console.error('Missing --target-url=<url> (the fresh instance to set up)');
        process.exit(1);
    }

    const url = args.targetUrl;
    let refreshToken = null;
    try {
        const auth = await resolveAuth(url, args);
        refreshToken = auth.refreshToken;

        console.log(`Target: ${url}`);
        console.log(`Auth:   ${auth.source}`);
        console.log(`Mode:   ${args.dryRun ? 'dry-run' : 'apply'}`);
        console.log('');

        const client = createDirectusAdminClient({ url, token: auth.token });

        try {
            await client.get('/collections');
        } catch (err) {
            console.error(
                `Cannot list collections on target (${err.status || '?'}): ${err.message}\n`
                + 'You must sign in as a Directus Administrator on the TARGET instance.'
            );
            process.exit(1);
        }

        console.log('▸ 1/3 schema (collections / fields / relations)');
        const schemaResult = await applySchemaSnapshot(client, SCHEMA_SNAPSHOT, {
            dryRun: args.dryRun,
            allowChanges: args.allowChanges
        });
        if (!schemaResult.hasDiff) {
            console.log('  - target schema already matches — nothing to do');
        } else if (!schemaResult.additiveOnly) {
            console.log('  - found changes that would edit or delete something already on the target:');
            for (const line of schemaResult.nonAdditive) {
                console.log(`      ${line}`);
            }
        }
        console.log(`  ${schemaResult.message}`);
        console.log('');

        console.log('▸ 2/3 access control (roles / policies / permissions)');
        const accessReport = await applyAccessControl(
            client,
            { roles: ROLES, policies: POLICIES, permissions: PERMISSIONS, access: ACCESS },
            { dryRun: args.dryRun }
        );
        for (const [section, lines] of Object.entries(accessReport)) {
            if (lines.length === 0) continue;
            console.log(`  ${section}:`);
            for (const line of lines) console.log(`    - ${line}`);
        }
        console.log('');

        console.log('▸ 3/3 seed');
        if (args.noSeed) {
            console.log('  - skipped (--no-seed)');
            console.log('');
        } else {
            await seedInviteApprovers(client, { dryRun: args.dryRun });
        }

        console.log(args.dryRun ? 'Dry-run only — no changes applied.' : 'Done. Target instance is set up.');
    } finally {
        if (refreshToken) {
            await logoutDirectus(url, refreshToken);
        }
    }
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
