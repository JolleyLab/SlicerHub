# Secrets Management

**Status:** Active  
**Last updated:** October 2026

---

## Overview

Application secrets (passwords, API keys, signing keys) are managed by **Infisical**, an open-source self-hosted secrets manager. Secrets are never stored in plaintext `.env` files — they live in Infisical and are injected as environment variables at runtime by `scripts/start.mjs`.

This architecture is designed to swap out Infisical for a cloud-native secrets manager (Azure Key Vault, AWS Secrets Manager) when the application moves to the cloud. Application code changes nothing — it reads `process.env.*` throughout.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  .env  (non-sensitive config + Infisical bootstrap)    │
│  ● Service URLs, timeouts, feature flags               │
│  ● INFISICAL_ENCRYPTION_KEY / AUTH_SECRET (bootstrap)  │
│  ● INFISICAL_CLIENT_ID / CLIENT_SECRET (machine auth)  │
└───────────────┬────────────────────────────────────────┘
                │
        scripts/start.mjs
                │ authenticates with machine identity
                ▼
        Infisical (http://localhost:8888)
                │ returns secrets as JSON
                ▼
        Injected as process.env vars
                │
        docker compose (reads ${VAR} from env)
                │
        ┌───────┴────────┐
        │  backend       │  ← KEYCLOAK_ADMIN_PASSWORD, JWT_SECRET, etc.
        │  payload-admin │  ← PAYLOAD_SECRET
        │  keycloak      │  ← KEYCLOAK_DB_PASSWORD
        └────────────────┘
```

### What lives where

| Category | Location | Examples |
|---|---|---|
| Application secrets | Infisical | `JWT_SECRET`, `KEYCLOAK_ADMIN_PASSWORD`, `PAYLOAD_SECRET`, `CLOUDFLARED_TUNNEL_TOKEN` |
| Infisical bootstrap | `.env` only | `INFISICAL_ENCRYPTION_KEY`, `INFISICAL_AUTH_SECRET`, `INFISICAL_DB_PASSWORD` |
| Machine identity | `.env` only | `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID` |
| Non-sensitive config | `.env` | URLs, timeouts, feature flags, `COMPOSE_PROFILES` |
| User passwords | Nowhere (never stored) | Prompted at `bootstrap.mjs` runtime, used once, discarded |

---

## Initial Setup

Run once after copying `.env.example → .env`:

```bash
# 1. Generate and add the Infisical bootstrap vars to .env
#    INFISICAL_ENCRYPTION_KEY=$(openssl rand -hex 16)
#    INFISICAL_AUTH_SECRET=$(openssl rand -base64 32)

# 2. Run bootstrap (starts all services including Infisical, then runs setup-infisical.mjs)
node scripts/bootstrap.mjs
```

`setup-infisical.mjs` will:
1. Wait for Infisical to be ready at `http://localhost:8888`
2. Walk you through creating your admin account and machine identity (~2 min in the UI)
3. Offer to migrate all secrets currently in `.env` into Infisical

After migration, delete or blank the migrated secret values from `.env`. The file should contain only the non-sensitive config listed above.

---

## Daily Use

Use `scripts/start.mjs` as a drop-in for `docker compose`:

```bash
# Start all services with secrets injected
node scripts/start.mjs up -d

# With profiles
node scripts/start.mjs up -d --profile keycloak

# Logs, down, etc.
node scripts/start.mjs logs -f backend
node scripts/start.mjs down
```

`start.mjs` fetches a short-lived access token from Infisical on each invocation (tokens expire in ~2 hours by default). No token is stored to disk.

---

## Adding a New Secret

1. Add the secret to Infisical via the UI (`http://localhost:8888`) or using the API:
   ```bash
   # Via setup-infisical.mjs migration (edit SECRETS_TO_MIGRATE list and re-run)
   # Or directly in the Infisical UI under the slicerweb project → dev environment
   ```
2. Reference it in `docker-compose.yml`:
   ```yaml
   environment:
     - NEW_SECRET=${NEW_SECRET}
   ```
3. Read it in application code as `process.env.NEW_SECRET` — no change needed.

---

## Infisical Environments

Infisical supports multiple environments (`dev`, `staging`, `prod`). Currently only `dev` is used.

When deploying to production on the physical server:
- Use the same Infisical instance but a separate `prod` environment
- Or run a separate Infisical instance isolated from dev

---

## Migration Path to Azure / AWS

When the application moves to the cloud:

### Azure (preferred)

1. Create an Azure Key Vault and add all secrets from Infisical
2. Assign a Managed Identity to each Container App
3. Reference secrets in the Container App definition:
   ```yaml
   secrets:
     - name: jwt-secret
       keyVaultUrl: https://your-vault.vault.azure.net/secrets/JWT_SECRET
       identity: <managed-identity-id>
   env:
     - name: JWT_SECRET
       secretRef: jwt-secret
   ```
4. Retire `scripts/start.mjs` — Azure injects secrets natively

No application code changes. `process.env.JWT_SECRET` is set the same way.

### AWS

Replace `start.mjs` with ECS task definition secret references:
```json
{
  "name": "JWT_SECRET",
  "valueFrom": "arn:aws:secretsmanager:us-east-1:123:secret:jwt-secret"
}
```

IAM task role grants the ECS task access to Secrets Manager. No application code changes.

---

## Security Notes

- **`.env` blast radius is minimal** — if `.env` is exposed, the attacker gets the Infisical machine identity (scoped read access to the project) and the Infisical bootstrap keys. Application secrets are not in `.env`.
- **Machine identity is scoped** — the `slicerweb-bootstrap` identity has Developer role on the `slicerweb` project only. It cannot modify Infisical configuration or access other projects.
- **Infisical data is encrypted at rest** using `INFISICAL_ENCRYPTION_KEY`. Without this key, the database is unreadable.
- **Rotate the machine identity secret** if the `.env` file is compromised: Infisical → Access Control → Machine Identities → revoke the client secret and create a new one, then update `INFISICAL_CLIENT_SECRET` in `.env`.
- **Production server**: Infisical is bound to `127.0.0.1:8888` (localhost only via Docker). It is not exposed through Cloudflare or nginx.
