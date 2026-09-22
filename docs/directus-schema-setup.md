# Directus schema setup (site bootstrap)

Programmatic data-model changes for new Directus projects — **not** something
product / case admins do from the app.

## Who may change schema

| Actor | Schema rights? |
|-------|----------------|
| You (dev / site bootstrap) | Yes — CLI with **on-demand** Directus Administrator login |
| BFF `DIRECTUS_TOKEN` (service) | No by default — Cases / provision only |
| Case admin / clinician in the SPA | Never |
| Directus Data Model UI | Possible for your admin user; prefer checked-in definitions + CLI |

**Do not** give hospital users the Directus **Administrator** role. Case
“admin” is a *case* collaborator role, not Directus schema admin.

There is **no** HTTP route on the product BFF that applies schema. Logging in
through the **product** app is also the wrong door — product sessions are not
Directus Administrator sessions.

## Auth (no admin token in `.env`)

Only `DIRECTUS_URL` belongs in `.env` for this script. Admin credentials are
prompted (or pasted) per run and not written to disk.

```bash
# Preview — prompts for Directus admin email / password (+ OTP if needed)
node scripts/directus-schema/ensure-schema.mjs --dry-run

# Apply
node scripts/directus-schema/ensure-schema.mjs

# One-run pasted token (create a temporary static token in Directus, paste,
# revoke after — or paste a short-lived access token). Nothing is saved.
node scripts/directus-schema/ensure-schema.mjs --paste-token
```

After an interactive login, the script best-effort logs out (invalidates the
refresh token). Prefer that over long-lived static admin tokens in env files.

`DIRECTUS_SCHEMA_TOKEN` in the environment is **ignored** if set (leftover
from an earlier draft). Remove it from `.env` if you added it.

## Ensure script

Definitions live under `scripts/directus-schema/definitions/`. Today:

- `case_invites` — unified pending invite queue (existing user + signup),
  intended to replace SQLite `case_invites` + `case_signup_invites` when the
  BFF is cut over. **Creating the collection does not migrate the app yet.**

```bash
node scripts/directus-schema/ensure-schema.mjs --only=case_invites --dry-run
```

## After apply

1. Confirm **Settings → Data Model → `case_invites`** exists.
2. Leave clinician policies **off** until the BFF reads/writes this collection
   (admin-only is fine while invites still use SQLite).
3. When cutting over: add call-as-user policies so case admins can read/update
   invites for cases they administer (same filter patterns as
   `case_directus_users` — see `docs/auth-providers.md`).
4. Redeem / token hashing / user provisioning stay on the BFF even after the
   queue moves to Directus.

## Adding another collection later

1. Add `scripts/directus-schema/definitions/<name>.mjs`.
2. Register it in `ensure-schema.mjs` `DEFINITIONS`.
3. Run `--dry-run`, then apply on each site with interactive login or `--paste-token`.
