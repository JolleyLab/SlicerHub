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

Only `DIRECTUS_URL` belongs in `.env`. Admin credentials are prompted (or
pasted) per run and not written to disk, across all of the scripts below:

- default / `--login` — interactive Directus Administrator email + password (+ OTP)
- `--paste-token` — paste a one-run access/static token, not saved
- `--allow-service-token` — lab only, reuses `DIRECTUS_TOKEN` if it's admin

After an interactive login, each script best-effort logs out (invalidates the
refresh token). Prefer that over long-lived static admin tokens in env files.

`DIRECTUS_SCHEMA_TOKEN` in the environment is **ignored** if set (leftover
from an earlier draft). Remove it from `.env` if you added it.

## First-time setup: bootstrapping a fresh Directus instance

`bootstrap.mjs` is the one command someone else runs to stand up a new
Directus instance matching this project's model — their own dev environment,
or (eventually) a prod rollout:

```bash
# Preview
node scripts/directus-schema/bootstrap.mjs --target-url=https://your-fresh-instance --dry-run

# Apply
node scripts/directus-schema/bootstrap.mjs --target-url=https://your-fresh-instance
```

It's a single, self-contained, **committed** script — the schema (collections
/ fields / relations) and the access control (roles / policies / permissions)
are hard-coded directly in its source, taken from a real instance at one
point in time. Running it needs nothing except your own target instance's
admin login; no separate data file, no access to the original source
instance. It also seeds the "Registration Reviewers" group and syncs current
admin users into it, as part of the same run.

**Never destructive:** the schema half only applies if every change is a pure
addition (nothing edited or deleted on the target); pass `--allow-changes` to
also apply edits/deletions the diff reports. The access-control half is always
additive-only — matched by name or content, existing ones are always skipped,
never edited. Pass `--no-seed` to skip the seed step.

**Prod:** same command, same safety guarantees — but dry-run it first, and
try it against a scratch/staging instance before ever pointing `--target-url`
at real prod.

**Known limitation:** most of this app's permission model needs Directus's
custom field-level permission rules, which this project's source instance has
via a grant-tier plan — a standard plan / vanilla self-hosted target will
reject most permission creates (handled gracefully, not a crash, but the
resulting target won't actually behave correctly). See the prominent callout
in [`scripts/directus-schema/README.md`](../scripts/directus-schema/README.md)
before telling anyone a target "passed" — this is already a known factor in
the ongoing discussion about moving off Directus, not something to quietly
route around.

### Updating bootstrap.mjs later

`bootstrap.mjs` is generated, not hand-written, and is a snapshot, not a live
sync — it won't track schema changes on its own. When the model changes and
`bootstrap.mjs` needs to catch up, regenerate it in two steps. Both run
locally against a real instance and its own admin login; neither commits
anything by itself.

```bash
# 1. Pull a fresh extraction from a known-good instance (local only — gitignored,
#    never committed; this is the "real copy," kept off the repo on purpose)
node scripts/directus-schema/export-schema.mjs \
  --format=module \
  --out=scripts/directus-schema/reference-schema.mjs

# 2. Turn it into the committed script (pure local file transform, no network
#    access, no Directus credentials needed for this step)
node scripts/directus-schema/generate-bootstrap.mjs
```

Review the diff to `bootstrap.mjs` before committing it — it hard-codes
whatever the extraction contained.

`setup.mjs` is the same logic as `bootstrap.mjs` but reads the data from an
external file (`--reference=`) instead of having it baked in — useful for
testing against the raw extraction before regenerating the committed script,
or for one-off applies you don't want turned into a committed artifact at all.

## Day-to-day collection changes: ensure-schema.mjs

For iterating on one of this app's own collections during development —
reviewed, hand-written field definitions, not a generated snapshot:

```bash
# Preview — prompts for Directus admin email / password (+ OTP if needed)
node scripts/directus-schema/ensure-schema.mjs --dry-run

# Apply
node scripts/directus-schema/ensure-schema.mjs

# One-run pasted token (create a temporary static token in Directus, paste,
# revoke after — or paste a short-lived access token). Nothing is saved.
node scripts/directus-schema/ensure-schema.mjs --paste-token
```

Definitions live under `scripts/directus-schema/definitions/`. Today:

- `case_invites` — unified pending invite queue (existing user + signup),
  intended to replace SQLite `case_invites` + `case_signup_invites` when the
  BFF is cut over. **Creating the collection does not migrate the app yet.**

```bash
node scripts/directus-schema/ensure-schema.mjs --only=case_invites --dry-run
```

Once a collection created this way is stable, fold it into the next
`reference-schema.mjs` regeneration so `setup.mjs` picks it up too.

### After apply

1. Confirm **Settings → Data Model → `case_invites`** exists.
2. Leave clinician policies **off** until the BFF reads/writes this collection
   (admin-only is fine while invites still use SQLite).
3. When cutting over: add call-as-user policies so case admins can read/update
   invites for cases they administer (same filter patterns as
   `case_directus_users` — see `docs/auth-providers.md`).
4. Redeem / token hashing / user provisioning stay on the BFF even after the
   queue moves to Directus.

### Adding another collection later

1. Add `scripts/directus-schema/definitions/<name>.mjs`.
2. Register it in `ensure-schema.mjs` `DEFINITIONS`.
3. Run `--dry-run`, then apply on each site with interactive login or `--paste-token`.

## Replicating a whole instance's schema (export-schema.mjs / apply-schema.mjs)

`setup.mjs` (above) is the usual entry point. `export-schema.mjs` /
`apply-schema.mjs` are the lower-level tools it's built on — use them directly
when you want more control: exporting from an instance other than the one
backing `reference-schema.mjs`, applying to a target without going through the
committed reference, or a one-off clone that was never meant to be committed.

**Schema only, never data:** no case/user/file rows are touched. User-linked policy
attachments (one person's individual access) are never exported either — a user id from
the source instance means nothing on the target.

```bash
# 1. Export from the source instance (defaults to DIRECTUS_URL from .env)
node scripts/directus-schema/export-schema.mjs
# -> writes scripts/directus-schema/exports/<host>-<timestamp>.json (gitignored)

# 2. Preview what applying it to another instance would do
node scripts/directus-schema/apply-schema.mjs \
  --in=scripts/directus-schema/exports/<file>.json \
  --target-url=https://the-other-instance \
  --dry-run

# 3. Apply it
node scripts/directus-schema/apply-schema.mjs \
  --in=scripts/directus-schema/exports/<file>.json \
  --target-url=https://the-other-instance
```

### `--format=json` vs `--format=module`

- `--format=json` (default) writes a data file under `scripts/directus-schema/exports/`,
  which is git-ignored — meant to be shared out-of-band (email, Slack, a shared drive),
  never committed.
- `--format=module` writes a plain `.mjs` source file (`export default {...}`) instead —
  it's code, not a data export, so it's fine to commit (review it first; it fully
  describes your data model and role/policy structure). The source URL is redacted by
  default; pass `--include-source-url` to keep it. This is what `reference-schema.mjs`
  is, and `apply-schema.mjs --in=` accepts either format interchangeably.

Same auth model as `ensure-schema.mjs`. `--target-url` (on `apply-schema.mjs`) and
`--target-url` (on `setup.mjs`) are always required and deliberately separate from
`DIRECTUS_URL`, so you can't apply to your own `.env` instance by accident.

If an apply reports schema changes it refused to make, read the list it prints — each
line names the collection/field and what kind of change it would be (new / edit / delete).
Resolve by hand (or pass `--allow-changes` if you've reviewed it and it's genuinely what
you want) rather than reflexively re-running with the flag.
