# Secrets Management

**Status:** Active
**Last updated:** November 2026

## Where secrets live

All secrets live in the repo's `.env` file, next to the other settings. Git ignores it. Docker Compose reads it, and the app reads secrets only from environment variables, so the place they're stored can change later without code changes.

`node scripts/bootstrap.mjs` creates `.env` if needed and generates every secret a setup needs, so no install runs on a known default:

| Secret | Set by | Used by |
|---|---|---|
| `KEYCLOAK_DB_PASSWORD`, `PAYLOAD_DB_PASSWORD` | bootstrap | the two Postgres databases |
| `KEYCLOAK_ADMIN_PASSWORD` | bootstrap | Keycloak's master admin; the backend and setup scripts use it for the admin API |
| `PAYLOAD_SECRET` | bootstrap | Payload (backend and admin UI) |
| `AUTH_TOKEN_KEY` | bootstrap | encrypts the ID token stored with each session |
| `KEYCLOAK_CLIENT_SECRET` | `setup-keycloak.mjs` | the backend's sign-in client |
| `JWT_SECRET` | you, in production | outside production, if unset, the backend generates one and keeps it in its data volume |
| SMTP / Resend keys, `CLOUDFLARED_TUNNEL_TOKEN`, `GPU_CREDENTIALS_KEY`, `TRAME_SYNC_TOKEN`, `VNC_PASSWORD` | you, when you turn on that feature | see `.env.example` |

The list bootstrap generates is in `scripts/lib/secrets.mjs`. To add a secret, add it to `.env.example`. If every install needs it, also add it to that list.

Database passwords only take effect when a database volume is first created. If bootstrap finds an existing database volume with no password in `.env`, it writes the old built-in default the database was created with, and warns that it's a public default.

## Rules

- Never commit `.env`, paste it into chat or tickets, or share it on screen.
- On a server, only its owner should be able to read it: `chmod 600 .env` (bootstrap does this on Linux and macOS).
- Each server has its own `.env` with its own values. Don't copy a laptop's `.env` to a server.
- On a server others can reach, nothing should be on a public default. Bootstrap warns if a database or Keycloak admin password is. With `NODE_ENV=production`, the backend refuses to start without a strong `JWT_SECRET`, `GPU_CREDENTIALS_KEY` and `TRAME_SYNC_TOKEN`.
- Back up a server's `.env` the same way as its database backups, and keep it as protected as they are. Without it, the databases can't be opened and existing sessions can't be decrypted.

## Changing a secret

After any change, run `docker compose up -d` so the affected services are recreated with the new value.

- **`AUTH_TOKEN_KEY`:** move the old value to `AUTH_TOKEN_KEY_PREVIOUS` and set a new one. Existing sessions keep working. Remove the previous key after the session lifetime has passed.
- **Database passwords:** change the password in Postgres first, then in `.env`. For Payload, also update the password inside `PAYLOAD_DATABASE_URI`:
  ```bash
  docker exec -it payload-db psql -U payload -d payload -c "ALTER USER payload WITH PASSWORD 'new-value';"
  docker exec -it keycloak-db psql -U keycloak -d keycloak -c "ALTER USER keycloak WITH PASSWORD 'new-value';"
  ```
- **`KEYCLOAK_ADMIN_PASSWORD`:** Keycloak only reads it when creating the master admin. Change the password in the Keycloak admin console (master realm → Users → admin), then put the same value in `.env`.
- **`KEYCLOAK_CLIENT_SECRET`:** regenerate it in the Keycloak admin console (slicer-web realm → Clients → slicer-web → Credentials) and paste it into `.env`. Users stay signed in.
- **`PAYLOAD_SECRET`:** set a new value. Payload admin users have to sign in again.

## Why not a secrets manager (yet)

Until November 2026 the stack ran Infisical, a self-hosted secrets manager, and `scripts/start.mjs` loaded secrets from it. It was removed because, on a single machine, it added three containers, a manual setup step, and license questions (its image includes enterprise-licensed code; its Redis is no longer open source since 7.4). It gave little protection in return: its own login sat in the same `.env` on the same machine, so anyone who could read `.env` could read every secret either way.

Revisit when any of these become true:
- several people manage a deployment's secrets;
- several servers need the same secrets;
- an audit trail of who read or changed a secret is required.

At that point, use the cloud platform's own store (below). For self-hosted, an open-source option such as OpenBao (MPL-2.0) or Infisical with Valkey instead of Redis would also work.

## Moving to Azure or AWS

The app only reads environment variables, so the platform injects them instead of `.env`:

- **Azure:** put each secret in Azure Key Vault and give each Container App a managed identity. Reference the secrets in the app definition (`secretRef` → `keyVaultUrl`).
- **AWS:** put each secret in Secrets Manager and reference it in the ECS task definition (`valueFrom` with the secret's ARN). The task's IAM role grants read access.

No application code changes.
