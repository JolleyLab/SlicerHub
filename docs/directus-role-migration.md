# One-time: migrating case roles into Directus (not committed)

> **Obsolete.** Directus is being replaced by Payload CMS. New cases go into Payload;
> the Directus role migration described here is no longer relevant for new deployments.
> Retained for reference only in case an existing Directus instance needs cleanup.

This is the walkthrough for the one-off change of `case_directus_users.role` from a multiple-select
dropdown (values like `1` and `["0"]`) to a single-value string dropdown, keeping every role. The finished
schema is described in [directus-schema.md](directus-schema.md). Delete this file once the migration is
done everywhere.

Background: the old field held `1` and `["0"]` (0 = admin, 1 = collaborator, 2 = read only), so writes of
`admin` and similar failed with a 500. The app worked around that by saving roles in SQLite. Roles are now
read and written in Directus directly.

This does not touch your Directus administrator access: that comes from the Directus role on your user
account (`directus_users.role`), not from this column.

## Steps

1. **Back up first** (cheap insurance, on whichever machine hosts Directus):
   `docker exec directus-test-db pg_dump -U <db user> <db name> > directus-backup.sql`.
   The export in the next step is also a backup of every role.
2. **Export the roles** from the repository root (changes nothing in Directus; nothing is committed).
   In Directus most rows still said `collaborator` (`1`): role changes made in the app were saved in SQLite
   because the Directus writes failed. Decide whether the SQLite roles matter. If they do, copy the live
   database out of each running copy of the app (each has its own):
   `docker compose cp backend:/app/data/users.db ./users-live.db`
   then run
   `node backend/scripts/rebuild-collaborator-roles.mjs export [--sqlite users-live.db] [--sqlite users-remote.db]`
   It reads `DIRECTUS_URL` and `DIRECTUS_TOKEN` from `.env`, maps 0/1/2 (and `["0"]`) to `admin` /
   `collaborator` / `read_only`, lets a SQLite role win over the Directus one, prints every row where they
   disagree, and writes `backend/collab-roles-backup.json`. It also marks each case owner (the case's
   creator, `user_created`) as `admin`, adding a junction row if the owner has none. That needs the
   service token to read `id` and `user_created` on the `case` collection. Check the counts: they should
   show the admins you expect.
3. **Change the field** in Directus: Settings, Data Model, `case_directus_users`, `role`. Try it in place
   first: change the type to String and the interface to a single-value Dropdown:

   | Setting | Value |
   |---|---|
   | Key | `role` (unchanged) |
   | Type | String, interface Dropdown (single value, not checkboxes or multiple) |
   | Choices | `admin` (Admin), `collaborator` (Collaborator), `read_only` (Read only). Nothing else. |
   | Default | `collaborator` |

   If Directus refuses to change the type, delete the field and create it again with the same settings;
   the backup from step 2 is what makes that safe. Leave Required off until step 4 has run.
4. **Restore the roles**: `node backend/scripts/rebuild-collaborator-roles.mjs restore` (dry run), then
   `restore --apply`. It checks each row's case and user against the backup before writing. Afterwards
   confirm in Directus that every row has a role and that each case owner is `admin`, then turn Required
   on, and add the validation rule (`role` is one of `admin`, `collaborator`, `read_only`): a dropdown's
   choices are not enforced by the API.
5. **Delete** `backend/scripts/rebuild-collaborator-roles.mjs`, `backend/collab-roles-backup.json`, the
   database copies and `directus-backup.sql`.

Check your Access Policies for rules or filters that use this field (for example "only admins can
update"). The name is unchanged, but its values are now strings instead of numbers.
