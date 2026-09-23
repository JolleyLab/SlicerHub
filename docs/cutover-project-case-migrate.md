# CUTOVER: My Projects → Cases migrate

Per-project button for project **admins** (Directus-linked session).

## What it does

1. Creates a Case titled like the project (call-as-user).
2. Uploads each project file into Directus as a case attachment.
3. Stores non-owner collaborators in `project_case_pending_collaborators`.
4. Adds collaborators who already have a Directus link immediately; others are
   added on their next Directus login during the cutover window.

GPU / share links are **not** migrated.

## Enable

On when `ENABLE_DIRECTUS_CASES=true` (default). That also puts **My Projects**
back in the app nav (so users can open projects and migrate). Force off:

```bash
ENABLE_PROJECT_CASE_MIGRATE=false
```

Force on (with Cases):

```bash
ENABLE_PROJECT_CASE_MIGRATE=true
```

## Delete when the window ends

Search `CUTOVER (project-case-migrate)` and remove:

| Item |
|------|
| `backend/src/services/projectCaseMigrate.js` |
| migration `029_project_case_migrate_cutover` tables (optional DROP migration) |
| `config.directus.projectCaseMigrateEnabled` |
| routes on `/api/projects/:id/migrate-to-case` |
| `features.projectCaseMigrate` + SPA button / helpers |
| My Projects nav item wiring in `app-menu.js` / `page-layout-template.js` |
| `applyPendingProjectCaseCollaborators` in Directus login provider |
| this doc |

After removal, remaining pending rows are ignored; users must be invited manually on Cases.
