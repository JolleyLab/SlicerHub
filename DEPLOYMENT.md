# Installing SlicerHub

This guide covers:

- [What you need](#what-you-need)
- [Fresh install: local development](#fresh-install-local-development)
- [Fresh install: server](#fresh-install-server)
- [Setting up email](#setting-up-email)
- [Updating an existing install](#updating-an-existing-install)
- [Migrating from the Directus version](#migrating-from-the-directus-version)
- [Troubleshooting](#troubleshooting)

The whole stack runs with Docker Compose:

- **nginx** serves the app on port 8000.
- **Keycloak** handles sign-in, sign-up and password reset. Its pages are served at `/sso/`.
- **Payload CMS on Postgres** stores cases, files, groups and invites.
- **backend** is the Node API.
- **Trame / Full Slicer** containers are the viewers.

One script, `scripts/bootstrap.mjs`, sets all of this up and is safe to run again.

## What you need

- **Docker** with Compose v2 (`docker compose version`).
- **Node.js 20 or later** on the host (`node -v`). It runs only the setup scripts; the app itself runs in containers.
- **Git.**
- **For the viewers, an NVIDIA GPU** with drivers and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/). On Windows, also see [Windows (Docker Desktop with WSL2)](#windows-docker-desktop-with-wsl2). See [THIRD_PARTY_RUNTIME.md](THIRD_PARTY_RUNTIME.md) for the runtime license terms.
- **Disk space:** about 30 GB for images, plus room for uploaded case files.

## Fresh install: local development

```bash
git clone https://github.com/JolleyLab/SlicerHub.git slicer-web
cd slicer-web
docker compose --profile slicer-gui build slicer-gui-base slicer-gui   # Full Slicer images (slow, once)
node scripts/bootstrap.mjs
```

Bootstrap does the following:

- creates `.env` with the local defaults;
- generates every secret;
- starts the stack and sets up Keycloak and Payload;
- asks for an **admin email and password**. These become the first SlicerHub site admin, which signs in to the app, and the login for the Payload admin dashboard. The Keycloak admin console has its own login (below).

When it finishes:

| What | Where |
|---|---|
| App | http://localhost:8000 |
| Keycloak admin console | http://localhost:8082/admin (user `admin`, password `KEYCLOAK_ADMIN_PASSWORD` in `.env`) |
| Payload admin | http://localhost:3001/admin |
| Email sent by the app and Keycloak | http://localhost:8025 (Mailpit; nothing leaves your machine) |

After that, `docker compose up -d` and `docker compose down` are all you need.

### Windows (Docker Desktop with WSL2)

Containers on Docker Desktop can see the GPU but have no NVIDIA EGL driver, so the Trame and Full Slicer viewers fall back to CPU rendering and are very slow. To render on the GPU instead, add this to `.env`:

```bash
CONTAINER_GL_MODE=d3d12
```

Then recreate the services that start viewer sessions:

```bash
docker compose up -d --force-recreate backend trame-service
```

Sessions started after that mount the host's `/usr/lib/wsl` libraries and use Mesa's D3D12 driver, which renders through DirectX on the host GPU. The setting selects the adapter whose name contains `NVIDIA`. Leave `CONTAINER_GL_MODE` unset on Linux hosts.

## Fresh install: server

These steps assume a Linux server, with TLS ending at a proxy in front of it, such as a Cloudflare tunnel.

**1. Get the code and create `.env`:**

```bash
git clone https://github.com/JolleyLab/SlicerHub.git slicer-web
cd slicer-web
cp .env.example .env
chmod 600 .env
```

**2. Edit `.env`.** At minimum, set these:

```bash
COMPOSE_PROFILES=keycloak,payload,cloudflare   # drop cloudflare if you don't use a tunnel
AUTH_PROVIDER=keycloak
NODE_ENV=production
PUBLIC_APP_URL=https://your-site.example        # the address people type; sign-in and email links use it
CORS_ORIGINS=https://your-site.example
KEYCLOAK_START_COMMAND=start                    # Keycloak in production mode
COOKIE_SECURE=true                              # TLS ends at the proxy
CLOUDFLARED_TUNNEL_TOKEN=...                    # if using the tunnel; point it at http://nginx:80

# Email: see "Setting up email" below
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=SlicerHub <noreply@your-site.example>
SMTP_ENABLED=true
```

Also fill in the other values in the "Required for production" block of `.env.example`.

Leave the database passwords, `KEYCLOAK_ADMIN_PASSWORD`, `PAYLOAD_SECRET` and `AUTH_TOKEN_KEY` empty: bootstrap generates them. See [docs/secrets-management.md](docs/secrets-management.md) for how to change or rotate them later.

**3. Build and set up:**

```bash
docker compose build
docker compose --profile slicer-gui build slicer-gui-base slicer-gui
node scripts/bootstrap.mjs
```

Keycloak's first start in production mode takes a minute or two.

**4. Check:**

- `https://your-site.example` shows the SlicerHub sign-in page, and you can sign in as the admin.
- "Forgot your password?" sends an email whose link goes to your site, not to `localhost`.
- You can create a case, upload a file, and open it in Slicer Web and in Full Slicer.

The Keycloak admin console isn't reachable through the public site. To use it, open an SSH tunnel to the server:

```bash
ssh -L 8082:localhost:8082 <server>
```

Then browse to http://localhost:8082/admin.

## Setting up email

A server needs a working email (SMTP) service. Without one, real emails are not sent. Nobody can verify their email, reset a password or finish an invite. For testing locally, nothing is needed: email goes to Mailpit at http://localhost:8025. 

Email is sent by:

- **Keycloak:** email verification, "Forgot your password?", account setup links for invited people, and the migration's `--send-setup-emails`.
- **The backend:** emails to admins and reviewers, for example when someone requests access.

Both use the same `SMTP_*` settings in `.env`. Locally, nothing is needed: email goes to Mailpit at http://localhost:8025.

**1. Choose a provider.** Any service that offers SMTP works, for example:

- your institution's mail relay;
- a transactional email service such as Resend, Amazon SES, Mailgun or SendGrid.

The provider sees the address and content of every email sent, so pick one your institution is happy with.

**2. Verify your sending domain** with the provider. This usually means adding the SPF and DKIM DNS records it gives you, for example in Cloudflare DNS. Without them, most email ends up in spam or is rejected. `SMTP_FROM` must use an address on that domain.

**3. Create an SMTP login** (username and password, or an API key used as the password).

**4. Fill in `.env`:**

```bash
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false        # false for port 587 (STARTTLS); true for port 465 (TLS from the start)
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=SlicerHub <noreply@your-site.example>
SMTP_ENABLED=true
```

For example, Resend uses `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`, and an API key as `SMTP_PASS`.

**5. Apply it.** Bootstrap does this for you on a fresh install. If you set up or change email later, copy the settings into Keycloak and restart the backend:

```bash
node scripts/setup-keycloak.mjs --settings-only
docker compose up -d --force-recreate backend
```

**6. Test it:**

- use "Forgot your password?" on the sign-in page with your own account;
- or, in the Keycloak admin console, go to **Realm settings → Email** for the `slicer-web` realm and select **Test connection**.

If nothing arrives, check `docker compose logs keycloak` and `docker compose logs backend` for SMTP errors, and check your spam folder.

## Updating an existing install

```bash
git pull
docker compose build                              # only if Dockerfiles or dependencies changed
node scripts/setup-keycloak.mjs --settings-only   # apply realm changes; keeps the client secret
node scripts/setup-payload.mjs                    # create or update Payload tables
docker compose up -d
docker compose up -d --force-recreate backend     # the backend runs the mounted source; restart it to pick up changes
docker exec nginx nginx -s reload                 # pick up nginx config changes
```

> **Always run `setup-payload.mjs` after an update.** The backend runs with `NODE_ENV=production`, and in that mode Payload never creates or changes its tables. This script is what applies schema changes. It does nothing if the tables are already up to date.

If the Full Slicer image changed (`slicer-gui-gpu/`), also rebuild it:

```bash
docker compose --profile slicer-gui build slicer-gui
```

Running sessions keep the old image until they're stopped.

Running `node scripts/bootstrap.mjs` again also works. It covers all of the above, but asks for the admin details again.

## Migrating from the Directus version

Use this to move an existing install from before the switch to Keycloak (one with `AUTH_PROVIDER=directus`) to Keycloak and Payload.

It updates the site in place: the same folder, the same `.env`, and new databases for Keycloak and Payload. The migration only **reads** from Directus, so rolling back is a matter of switching back to the commit you were on.

**What moves across:**

- users;
- their preferences;
- cases;
- collaborators;
- pending case invites;
- case files.

**What doesn't:**

- **Passwords.** Directus doesn't expose them, so each person sets a new one through Keycloak. Their cases are waiting when they sign in.
- **Comments.**
- **Registration requests still waiting for review.** Decide them before migrating.

Invites that can't be read are skipped with a warning; the migration carries on with the rest.

Directus must still be running and reachable from the server, for example in its own compose project.

**1. Back up and stop the current site.** The data is kept.

```bash
cd <app-dir>
cp .env .env.pre-keycloak && chmod 600 .env.pre-keycloak
git tag pre-keycloak                                                 # marks the old version, for rollback
docker compose down
docker ps -a --filter name=slicer-gui- -q | xargs -r docker rm -f   # leftover Full Slicer sessions
```

**2. Get the new code:**

```bash
git pull
```

**3. Edit `.env`.** Change or add these lines and leave the rest as it is. Keep `DIRECTUS_URL` and `DIRECTUS_TOKEN` (or `DIRECTUS_ADMIN_TOKEN`); the migration reads them.

```bash
COMPOSE_PROFILES=keycloak,payload,cloudflare   # plus anything already in your current value
AUTH_PROVIDER=keycloak                         # was: directus
PUBLIC_APP_URL=https://your-site.example
KEYCLOAK_START_COMMAND=start
SMTP_ENABLED=true                              # if SMTP_* is already set up; otherwise see "Setting up email"
```

**4. Build and set up.** This is the same as a fresh install:

```bash
docker compose build
docker compose --profile slicer-gui build slicer-gui-base slicer-gui
node scripts/bootstrap.mjs
```

For the admin account, use the **same email as your Directus account**. The migration then links the two, and your cases stay yours.

Check that you can sign in before going on.

**5. Run the migration.** Do a trial run first and check the counts it reports:

```bash
docker cp scripts/migrate-from-directus.mjs backend:/app/migrate-from-directus.mjs
docker exec -it backend node /app/migrate-from-directus.mjs --dry-run
docker exec -it backend node /app/migrate-from-directus.mjs
```

The migration is safe to run again: anything already migrated is skipped.

If the backend can't reach Directus (for example, `DIRECTUS_URL` uses a container name from the other compose project), connect it to Directus's network and run the migration again:

```bash
docker network ls                                  # find the Directus network
docker network connect <directus-network> backend
```

**6. Check:**

- sign in and look at a few users' cases, collaborators and files;
- open a migrated file in Slicer Web and in Full Slicer;
- confirm that "Forgot your password?" emails link to your site.

**7. Let everyone in.** Email each migrated user a link to set their password. The link is valid for `CASE_INVITE_TTL_DAYS`, 7 days by default. Then remove the script from the container:

```bash
docker exec -it backend node /app/migrate-from-directus.mjs --send-setup-emails
docker exec backend rm /app/migrate-from-directus.mjs
```

Anyone who misses the email can use "Forgot your password?" on the sign-in page.

### Rolling back

```bash
docker compose down
git checkout pre-keycloak && cp .env.pre-keycloak .env
docker compose up -d
```

The old site comes back exactly as it was.

### After the migration has settled

Once you're confident in the new version:

- remove the `DIRECTUS_*` lines from `.env`;
- delete `.env.pre-keycloak` and the `pre-keycloak` tag (`git tag -d pre-keycloak`);
- shut down Directus;
- delete `data/slicer-gui/directus-cache`.

## Troubleshooting

- **The backend exits at startup and says Payload wants to drop a table or column.** A feature was removed and its schema is still in the database. Add the drop to `RETIRED_SCHEMA` in `scripts/setup-payload.mjs`, then run that script again.
- **"Relation … does not exist", or a failed query on a Payload table.** The tables are behind the code. Run `node scripts/setup-payload.mjs`, then `docker compose up -d --force-recreate backend`.
- **Sign-in or email links point to `localhost`.** `PUBLIC_APP_URL` is wrong. Fix it, then run `node scripts/setup-keycloak.mjs --settings-only` and restart the backend.
- **No emails arrive.** Check that `SMTP_*` and `SMTP_ENABLED=true` are set, then run `node scripts/setup-keycloak.mjs --settings-only`, which copies SMTP into Keycloak. Locally, look in Mailpit at http://localhost:8025.
- **A viewer won't start.** Run `docker compose logs backend`, and check that `nvidia-smi` works inside Docker (`docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`).
- **Viewers are very slow on Windows.** They are rendering on the CPU. Set `CONTAINER_GL_MODE=d3d12` as described in [Windows (Docker Desktop with WSL2)](#windows-docker-desktop-with-wsl2).
- **Logs:** `docker compose logs -f backend` and `docker compose logs -f keycloak`.

## More detail

- Secrets: [docs/secrets-management.md](docs/secrets-management.md)
- Sign-in and sessions: [docs/redirect-login-and-sessions-design.md](docs/redirect-login-and-sessions-design.md)
- Full Slicer add-ons: [docs/slicer-gui-addons.md](docs/slicer-gui-addons.md)
- Vast.ai GPU sessions: [docs/gpu-providers.md](docs/gpu-providers.md)
- Every setting: [.env.example](.env.example)
