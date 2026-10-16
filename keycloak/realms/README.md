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
`CLIENT_CONFIG`, `ROLES`, and `ROLES_MAPPER` constants), then re-run the script.

## This directory

This directory is mounted into the Keycloak container as `/opt/keycloak/data/import`.
Keycloak will auto-import any `.json` files placed here on first start. This is available
as a manual escape hatch if needed, but the script approach is preferred.
