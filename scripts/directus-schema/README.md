# Directus setup scripts

This folder sets up a Directus instance (collections, fields, roles, policies,
permissions) to match what this app needs — either for a brand-new developer
getting started, or for standing up a new environment.

If you just want to **set up a fresh Directus instance**, you only need one
file: `bootstrap.mjs`. Everything else in this folder is tooling for
maintaining that one script over time. You can stop reading after the next
section if that's all you need.

## I just want to set this up

You need a Directus instance (new/empty is fine) and an admin login for it.

```bash
# 1. Preview first — this changes nothing, it just tells you what it would do
node scripts/directus-schema/bootstrap.mjs --target-url=https://your-directus-instance --dry-run

# 2. If that looks right, actually run it
node scripts/directus-schema/bootstrap.mjs --target-url=https://your-directus-instance
```

It will ask you to sign in as a Directus **Administrator** on that instance
(email + password, or an OTP if you have two-factor on). Nothing you type is
saved anywhere — it's only used for this one run.

That's it. It sets up the collections, roles, policies, and permissions this
app expects, and is **safe to run more than once** — anything that already
exists on the target is left alone, never edited or deleted.

**A few things worth knowing:**
- It will never delete or modify anything that's already there. If applying
  would require changing something existing, it stops and tells you, instead
  of doing it — pass `--allow-changes` only if you've looked at what it's
  reporting and are sure.
- `--no-seed` skips the one piece of starter data it creates (a group needed
  for the user-registration-approval feature).
- `--help` for the full list of options.

## Want to try it without risking a real server first?

Yes — you can run the whole thing for real against a throwaway Directus
instance on your own machine with Docker, then delete it when you're done.
Nothing here touches your actual server.

```bash
# 1. Spin up a disposable Postgres database (use Postgres, not SQLite — see note below)
docker network create directus-test-net
docker run -d --name directus-test-db --network directus-test-net \
  -e POSTGRES_USER=directus -e POSTGRES_PASSWORD=directus -e POSTGRES_DB=directus \
  postgres:15

# 2. Spin up a disposable Directus pointed at it
docker run -d --name directus-test --network directus-test-net -p 8055:8055 \
  -e KEY=test-key -e SECRET=test-secret \
  -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=TestPassword123! \
  -e DB_CLIENT=pg -e DB_HOST=directus-test-db -e DB_PORT=5432 \
  -e DB_DATABASE=directus -e DB_USER=directus -e DB_PASSWORD=directus \
  directus/directus:12.0.2

# Give it ~10-20 seconds to finish starting, then open http://localhost:8055
# to confirm it's up (sign in with the admin email/password above).

# 3. Try the setup script against it, for real — safe, this instance is disposable
node scripts/directus-schema/bootstrap.mjs --target-url=http://localhost:8055 --dry-run
node scripts/directus-schema/bootstrap.mjs --target-url=http://localhost:8055

# 4. When you're done, throw it all away — nothing persists
docker rm -f directus-test directus-test-db
docker network rm directus-test-net
```

**Why Postgres and not the simpler SQLite default:** Directus itself refuses
to compare schemas across different database types ("vendor mismatch").
Match whatever your real target actually uses — Postgres is the most common.

### ⚠️ Known limitation: this depends on a Directus plan feature we don't all have

Most of this app's permission model relies on **custom field-level permission
rules** — restricting *which fields* a permission grants, not just all-or-
nothing access. This project's own instance has that enabled through an
Directus Cloud innovation/grant-tier plan. A standard Directus plan (and a
vanilla self-hosted instance, like the Docker recipe above) **does not** have
it, and will reject most of those permissions with an error like:

```
custom_permission_rules_enabled is a restricted resource.
```

**This is expected, and the script handles it without crashing** — it counts
these separately, keeps going, and reports a summary instead of failing the
whole run. But don't read that as "it's fine, ignore it": most of the real
permission model for this app will be missing on a target without this
feature, which means the app will likely behave incorrectly there (wrong
access, wrong field visibility) even though the setup script itself
"succeeded." **Tell whoever owns the target instance about this explicitly**
rather than treating the warning as noise to suppress.

This is a known, already-identified limitation of relying on Directus here —
it's part of why a move to a different CMS is being considered. If you're
reading this because you hit it: you're not missing something, and it isn't
something this script can work around on its own.

## Updating the setup after something changes

`bootstrap.mjs` is **generated**, not hand-written — it's a snapshot of a
real, working Directus instance, hard-coded into one file at the time it was
generated. It does not update itself. If the model needs to change (a new
collection, a changed permission, a new role), regenerate it:

```bash
# 1. Pull a fresh copy from a known-good instance (stays local — never committed)
node scripts/directus-schema/export-schema.mjs \
  --format=module \
  --out=scripts/directus-schema/reference-schema.mjs

# 2. Turn it into the updated bootstrap.mjs (no network access, just a local file rewrite)
node scripts/directus-schema/generate-bootstrap.mjs

# 3. Review the diff to bootstrap.mjs, then commit it
```

## What else is in this folder

| File | What it's for |
|------|----------------|
| `bootstrap.mjs` | **The one-time setup script.** Self-contained, committed, hard-coded model. Run this. |
| `generate-bootstrap.mjs` | Regenerates `bootstrap.mjs` from a fresh extraction. Local file transform only. |
| `export-schema.mjs` | Pulls a full extraction (schema + roles/policies/permissions) from a live instance. Output is local-only, never committed (see `.gitignore`). |
| `apply-schema.mjs` | Lower-level: applies any extraction file to a target. Used internally; `bootstrap.mjs` is almost always what you want instead. |
| `setup.mjs` | Same as `bootstrap.mjs`, but reads an external extraction file instead of having the data baked in. Useful for testing a fresh extraction before regenerating `bootstrap.mjs`. |
| `ensure-schema.mjs` | Day-to-day: adds/updates this app's own collections one at a time during development, from hand-reviewed definitions in `definitions/`. |
| `lib/` | Shared code (auth, HTTP client, the actual apply logic). Not meant to be run directly. |

For the full technical details (security model, why things are designed this
way, the exact safety guarantees), see
[`docs/directus-schema-setup.md`](../../docs/directus-schema-setup.md) in the
repo root.

## Security, in short

- Nothing here ever stores an admin token on disk. You either sign in
  interactively each time, or paste a one-run token that's never saved.
- Never give the people who use this app's day-to-day features ("case admin",
  "clinician", etc.) the Directus **Administrator** role — that's a different,
  much higher level of access, only for whoever is running these scripts.
- These scripts are command-line only. There is no way to trigger any of this
  from the running app itself.
