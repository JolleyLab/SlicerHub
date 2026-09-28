# Directus schema for collaborators and invites

What the app expects from Directus for case collaborators, roles and invites, how to create it in the
Directus UI, and how to copy the finished schema to another server. Directus is the source of truth: the
app keeps no copy of roles, membership or invites (invites are still in SQLite until `case_invite` exists;
see the SQLite migration notes).

## 1. Junction `case_directus_users`

Fields the app uses: `case_id`, `directus_users_id` and `role`.

`role`:

| Setting | Value |
|---|---|
| Type | String, interface Dropdown (single value, never multiple) |
| Choices | `admin` (Admin), `collaborator` (Collaborator), `read_only` (Read only) |
| Default | `collaborator` |
| Required | yes, not nullable |
| Validation | `role` is one of `admin`, `collaborator`, `read_only`. **Add this:** a dropdown's choices are only offered by the UI; the API accepts any value without it. |

The app treats a missing or unrecognised value as no access, and never as a role. A case creator is an
ordinary `admin` row, added when the case is created; nothing depends on who created a case.

Check your Access Policies for rules or filters that use `role` (for example "only admins can update"): its
values are the strings above.

**Recommended:** a unique constraint on `(case_id, directus_users_id)`, so a person can never be on a case
twice. Directus has no UI for composite unique indexes; add it in the database:
`CREATE UNIQUE INDEX case_member_unique ON case_directus_users (case_id, directus_users_id);`

**Always at least one admin per case.** The app refuses a save that would leave a case without an admin.
As a backstop that also covers edits made directly in Directus, apply
[directus/sql/case-keep-one-admin.sql](../directus/sql/case-keep-one-admin.sql) to the Directus database
(command at the top of the file). It is a Postgres trigger that blocks deleting or demoting the last admin
of a case, while still allowing a whole case to be deleted. Triggers are not part of a schema snapshot, so
run it on every server. Test it on a scratch case first: try demoting the only admin (should fail), swap
the admin (promote first, should work) and delete a case (should work).

## 2. New collection: `case_invite`

One collection for both kinds of invite. Create it with a UUID primary key. Turn on the "Created On"
system field (`date_created`) when creating it.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID, primary key | |
| `kind` | String, dropdown: `existing`, `signup` | `existing`: the invitee already has an account. `signup`: emailed a link to create one. |
| `status` | String, dropdown: `pending_approval`, `pending_signup`, `approved`, `rejected`, `accepted` | Default `pending_approval`. Required. `rejected` also covers a link an admin withdrew. There is no `expired` or `cancelled`: a link that has run out is deleted. |
| `case` | Many to One, related collection `case` | Required. On delete of the case, delete the invite (CASCADE). |
| `invitee_email` | String | Stored lower case. Required. |
| `invitee_user` | Many to One, `directus_users` | Set for `kind = existing`. Empty for signup until accepted. |
| `proposed_role` | String, dropdown: `admin`, `collaborator`, `read_only` | Default `collaborator`. Required. |
| `inviter` | Many to One, `directus_users` | Who sent it. |
| `token_hash` | String | Signup only. **Unique.** Hash of the emailed token, never the token itself. |
| `expires_at` | Date Time | Signup only. |
| `resolved_at` | Date Time | When it was approved, rejected or accepted. |
| `resolved_by` | Many to One, `directus_users` | Who approved or rejected it. |
| `accepted_user` | Many to One, `directus_users` | Set when a signup invite is redeemed. |
| `date_created` | Timestamp, special: Created On | |

Indexes (add in the database or through the field settings): `(case, status)` and `(invitee_email, status)`.
`token_hash` unique.

The app is the only writer. `token_hash` is only ever used to look an invite up and is never read back.
Add the same validation rules as on `role` for `kind`, `status` and `proposed_role`: the API accepts any
value for a dropdown otherwise. Nothing was migrated from SQLite; those invites were test data.

## 3. Permissions for the service token

Only the backend uses these, and the backend does its own authorization (admin or collaborator checks).
Give the policy attached to `DIRECTUS_TOKEN`:

- `case`: read `id` and `title` (the title is shown on invites and in emails).
- `case_directus_users`: read, create, update, delete, all fields.
- `case_invite`: read, create, update, delete, all fields.
- `directus_users`: read `id`, `email`, `first_name`, `last_name`.

Give **no** end-user role access to `case_invite`. People reach invites only through the app.

## 4. Retire the SQLite tables (after the app is switched over and verified)

`case_collaborator_roles` (migration 030) and the two invite tables (migration 031) are dropped by the app
on its next start, along with notifications that pointed at the old invites.

## Copying the schema to another Directus server

Directus can export its data model and apply it elsewhere, so the steps above only need doing once.

1. After step 3, export from this server:
   `docker exec <directus container> npx directus schema snapshot ./snapshot.yaml`
   then copy the file out and commit it, for example to `directus/schema/snapshot.yaml`.
2. On the other server, from a fresh Directus with the same major version and the same database type:
   `npx directus schema apply --yes ./snapshot.yaml`
   (add `--dry-run` first to see what would change).
3. Not included in the snapshot: **data**, users, and access policies and permissions (unless you also
   export those). Re-create the permissions in step 3 on the new server, or export them separately.
   A snapshot only carries collections, fields and relations.

There is also an HTTP form of the same thing: `GET /schema/snapshot`, then `POST /schema/diff` and
`POST /schema/apply` on the target, using an administrator token. Use whichever fits your deployment
scripts.

Keep the snapshot in the repository and re-export it whenever the schema changes, so it does not drift.
