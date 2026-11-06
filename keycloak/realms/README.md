# Keycloak realm configuration

Realm setup is managed by `scripts/setup-keycloak.mjs`, not by a committed JSON export.
The script is the source of truth for realm configuration — roles, clients, mappers, and
security settings are all defined there and applied via the Keycloak Admin REST API.

This means:
- Configuration changes appear as readable code diffs, not JSON blob diffs
- No secrets are ever committed (the script regenerates the client secret and writes it to .env)
- Any developer can reproduce the full setup with one command

## First-time setup

```sh
docker compose --profile keycloak up -d
node scripts/setup-keycloak.mjs
```

The script is idempotent — safe to re-run after pulling changes that update realm config.

## Making configuration changes

Edit the realm definition at the top of `scripts/setup-keycloak.mjs` (the `REALM_CONFIG`,
`CLIENT_CONFIG`, `ROLES`, and `ROLES_MAPPER` constants), then apply it:

```sh
node scripts/setup-keycloak.mjs --settings-only
```

`--settings-only` updates the realm, roles, client and mapper without rotating the client
secret or prompting for the admin account. A full run (no flag) also regenerates
`KEYCLOAK_CLIENT_SECRET` in `.env`, which needs a backend restart.

## Where Keycloak is reachable

- **Browsers:** `<PUBLIC_APP_URL>/sso/` through nginx (sign-in pages only). nginx strips the
  `/sso` prefix; `KC_HOSTNAME` tells Keycloak its public base so the links it generates
  include it.
- **Admin console:** only `KEYCLOAK_ADMIN_URL` (default `http://localhost:8082`, bound to
  localhost). nginx returns 404 for `/sso/admin/` and `/sso/realms/master/`.
- **Backend:** `http://keycloak:8080` on the Docker network (`KC_HOSTNAME_BACKCHANNEL_DYNAMIC`).
- **Production:** set `KEYCLOAK_START_COMMAND=start` and a real `PUBLIC_APP_URL` in `.env`.

## Sign-in page theme

Keycloak's pages use the `slicerhub` login theme (`keycloak/themes/slicerhub/login`), which is
mounted into the container and selected by `setup-keycloak.mjs` (`loginTheme`).

- It extends Keycloak's built-in `keycloak.v2` theme with CSS, one script and message overrides.
- With `start-dev`, edits show on reload. Production mode caches themes, so restart Keycloak after editing.
- Colours mirror `dev/components/theme.js`. Keep both in step, and re-check contrast (WCAG 2.1 AA) when changing them.

## Emails, registration and password reset

- **Email theme `slicerhub`** (`keycloak/themes/slicerhub/email`) rewords Keycloak's verify-email, password-reset and account-setup emails in SlicerHub's voice.
- **Realm SMTP** comes from the app's `SMTP_*` settings. Outside production with none set, `setup-keycloak.mjs` points Keycloak at the local Mailpit container, so these emails show up at http://localhost:8025 and never leave the machine. In production, configure SMTP or Keycloak can't send them.
- **Sign-up fields:** the page asks for `affiliation` and `intendedUse` (optional, user-profile attributes). They're copied into the review item and removed from the account once approved.
- **Email verification** is on. `setup-keycloak.mjs` lists any enabled account whose email isn't verified; Keycloak asks them to verify at their next sign-in.
- **Sign-in is Keycloak's page only.** The `slicer-web-backend` client has the password grant (Direct Access Grants) off, so the app never handles passwords. Changing a password from Settings opens Keycloak's update-password page (`kc_action=UPDATE_PASSWORD`).
- **Case invites to a new email** create an account with `VERIFY_EMAIL` + `UPDATE_PASSWORD` pending; Keycloak emails the setup link. If the invite expires (`CASE_INVITE_TTL_DAYS`) or is rejected before setup, the backend deletes that account.

## Approval gate (`app-user`)

Using SlicerHub requires the `app-user` realm role (or `app-org-admin` / `app-admin`).

- **Already approved:** accounts created through SlicerHub's own flows (case invites, approved registration requests, the bootstrap admin) get `app-user` automatically.
- **Waiting for review:** an account without an app role, for example one created by hand in the admin console (later, a first hospital-SSO sign-in), sees "Access pending approval". It appears in the registration review queue. Approving grants `app-user`; rejecting deletes the account.
- **One-off rollout grant:** the first time a backend starts against a realm, it grants `app-user` to every existing account. It then sets the realm attribute `slicerhub.appUserGrantedAt`, so this never repeats. Until that is confirmed, the gate stays open.
- **To approve a hand-made account directly:** give it `app-user` in the admin console. It takes effect within 5 minutes.
- **Default roles:** `setup-keycloak.mjs` keeps the app roles out of the realm's default roles. Otherwise every new account would be approved automatically.

See `docs/redirect-login-and-sessions-design.md` for the rollout these settings belong to.

## This directory

This directory is mounted into the Keycloak container as `/opt/keycloak/data/import`.
Keycloak will auto-import any `.json` files placed here on first start. This is available
as a manual escape hatch if needed, but the script approach is preferred.
