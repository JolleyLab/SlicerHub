# Keycloak Case Groups — Setup and Architecture

Case-level access control uses **Keycloak Groups** as the source of truth.

## Group naming

Groups are created lazily (on first `POST /api/cases/:id/invites`):

```
case:{caseId}:admin
case:{caseId}:collaborator
case:{caseId}:read_only
```

The backend (Express/Payload) manages group membership via the Keycloak Admin API using the `KEYCLOAK_ADMIN_USER` + `KEYCLOAK_ADMIN_PASSWORD` service credentials from `.env`.

## Role hierarchy

| Role | Read files | Upload files | Invite others | Edit/delete case |
|---|---|---|---|---|
| `admin` | ✓ | ✓ | ✓ | ✓ |
| `collaborator` | ✓ | ✓ | ✓ | ✗ |
| `read_only` | ✓ | ✗ | ✗ | ✗ |

The case **owner** (tracked in the Payload `owner_id` field) always has `admin` regardless of groups.

## Runtime access check

On every case endpoint the backend:
1. Checks `req.user.role === 'admin'` (site admin → pass).
2. Checks `owner_id === req.user.id` (owner → admin).
3. Queries Keycloak Admin API: `GET /admin/realms/{realm}/users/{keycloakSub}/groups` filtered for `case:{id}:*`.

The admin token is cached in memory until 30 s before expiry to avoid repeated auth calls.

## Case listing (`GET /api/cases`)

One Keycloak call fetches all groups for the user (`/users/{sub}/groups`) → parsed into a `caseId → role` map → returned as `myRole` on each case row. Collaborators also appear in the list (not just case owners).

## Invite flow

`POST /api/cases/:id/invites { email, role }`:
1. Looks up the Keycloak user by email (`GET /admin/realms/{realm}/users?email=&exact=true`).
2. If found → adds them to `case:{id}:{role}` group immediately.
3. If not found → 404 "No account with that email address."

There is no pending-invite queue for Payload cases; access is immediate. The full signup-invite flow (invite someone who has no account yet) can be wired in later using the existing email infrastructure.

## People dialog (frontend)

`openPeopleDialog` branches on `this.isPayloadCase`:
- **lookupFn** → `GET /api/cases/lookup-user?email=` (Keycloak search)
- **inviteFn** → `POST /api/cases/:id/invites` + list reload
- **Save** → `PUT /api/cases/:id/collaborators` (bulk reconcile)

## Required `.env` variables

```
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=slicer-web
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=<keycloak admin password>
AUTH_PROVIDER=keycloak
```

`KEYCLOAK_ADMIN_PASSWORD` is the password for the Keycloak admin account (or a service account with `manage-users` and `manage-groups` realm permissions). This is only used at runtime by the backend; it is never stored in the database or logs.

## Production recommendation

For production, create a dedicated Keycloak service account with only the permissions needed:
- Realm roles: `manage-users`, `manage-groups`, `view-users`

Then use those credentials as `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD`.

## Files changed

| File | Purpose |
|---|---|
| `backend/src/services/keycloakAdmin.js` | Admin API helpers (token cache, group CRUD, user lookup) |
| `backend/src/utils/caseAccess.js` | Async role-check helpers (`getCaseRole`, `assertCaseAccess`) |
| `backend/src/routes/caseCollaborators.js` | REST endpoints for collaborator management |
| `backend/src/routes/cases.js` | Updated to use `assertCaseAccess`; `myRole` in listing |
| `dev/services/cases.js` | Frontend service functions for collaborator API |
| `dev/directus-cases-page.js` | People dialog branching for Payload cases |
