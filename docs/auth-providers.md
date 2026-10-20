# Authentication architecture

This is the **product** login design — not a throwaway PoC path. Build further
work against these contracts. Compromise only where a final platform decision
is still open (called out below).

## Direction (updated 2026-10): Keycloak as auth provider

**Confirmed:** **Keycloak** is the chosen auth provider, running as a self-hosted Docker service (same stack, same bootstrap). Directus is being retired from auth — it will no longer be used for login, identity, or Cases ACLs once the migration is complete.

**Active path:** Keycloak BFF pattern — browser submits credentials to the Node.js backend, which verifies server-to-server with Keycloak. Browser never contacts Keycloak directly. Product session stays this app’s httpOnly cookie.

**Do not add new identity features in this repo** (password stores, MFA, reset, federation, user-directory replacement). Use Keycloak or a future OIDC provider. Glue allowed: provision users via Keycloak Admin API, session mapping, `providers/*` plug-ins backed by maintained libraries (e.g. `openid-client` for OIDC).

**Stop investing in:** SQLite as a production password IdP; Directus password+OTP as the long-term SSO story. Local provider is a fallback, not the north star. Keycloak is.

**Org SSO:** later, via OIDC in the BFF (Entra/Okta). Keycloak can broker external OIDC providers if needed.

## Contracts (stable)

1. **Browser never holds IdP credentials or tokens.** SPA → app BFF only
   (`/api/auth/*`, cookies).
2. **Product session is owned by this app:** JWT in an **httpOnly** cookie
   (not readable by JavaScript) **and** served over **HTTPS** in production
   (`Secure` cookie flag). Those are two different protections (see below).
3. **Identity providers are plugins** under `backend/src/auth/providers/`.
   Routes and the login form talk to `loginWithProvider` / `getPublicAuthConfig`,
   not to Directus or a future Entra client.
4. **Local user rows remain product session identity** (roles, projects, viewer prefs).
   **North star:** every user is a Keycloak account, linked via `auth_identity_links`
   (`provider=keycloak`). Cases are managed by Payload CMS and use the SQLite user id
   as an owner bridge until full Keycloak/Payload user migration is complete.
5. **IdP tokens are not part of the default session.** After mapping identity,
   provider access/refresh material is discarded unless explicitly enabled.

### httpOnly vs HTTPS (cookie session)

| Control | What it protects | Required? |
|---------|------------------|-------------|
| **httpOnly** | Token not exposed to `document.cookie` / most XSS | Yes for product session cookie |
| **HTTPS + `Secure` flag** | Token not sent in cleartext on the network | Yes in production (TLS at edge is fine) |
| **SameSite=strict** | Cross-site CSRF with cookies | Yes for our app |

They are complementary: **httpOnly ≠ instead of HTTPS**. Production should have both.

## Defaults (production-minded)

| Setting | Default | Why |
|---------|---------|-----|
| `AUTH_PROVIDER` | `local` | Safe deploy default; switch to `directus` when IdP is ready |
| `AUTH_STORE_PROVIDER_TOKENS` | off | No IdP secret surface until a feature needs user-scoped IdP calls |
| `AUTH_LINK_POLICY` | `strict` | No silent account takeover by matching email alone |
| `AUTH_DEV_RELAXED` | off | Non-prod only: softer rate limits, longer idle default, longer device trust |
| Registration | off when not local / when `REGISTRATION_ENABLED=false` | IdP owns account lifecycle when external |
| Login rate limits | IP + identity failure budgets (15m) | Brute-force cost; shared store when multi-instance |

### Security controls (current)

| Control | Behavior |
|---------|----------|
| Link policy `strict` | Existing unlinked product email → `ACCOUNT_LINK_REQUIRED` (no auto-link). New IdP users get shadow product users (`role=user` only). |
| Link policy `email` | Controlled migration: auto-link when IdP email matches an existing user (prefer verified/status). |
| MFA / TOTP | Login returns `error.code=OTP_REQUIRED`; SPA second step posts `otp`. |
| Remember this device | After MFA, optional httpOnly cookie + encrypted Directus refresh; later password logins that hit OTP use refresh instead of re-prompt (password still validated first). Default trust 30 days (90 with `AUTH_DEV_RELAXED`). |
| AUTH_DEV_RELAXED | **Not** a full MFA kill-switch (Directus still requires first OTP). Softens testing friction only. **Fatal if set in production.** |
| Login audit | `auth_audit_events` — success/failure/register/logout; identity **hashed**; IP + UA; retention `AUTH_AUDIT_RETENTION_DAYS` (90). |
| Timing pad | Local login always runs a bcrypt compare (dummy hash if identity missing/disabled). |
| Origin check | Cookie auth mutations require `Origin`/`Referer` in `CORS_ORIGINS` when present. |
| Role elevation | Directus admin ≠ product admin. Shadows always `role=user`. |

### When tokens *are* stored

Only if a product feature must call an IdP **as the end user** from the BFF.
Currently only used for the legacy Directus Cases path:

```bash
AUTH_STORE_PROVIDER_TOKENS=true
AUTH_TOKEN_KEY=<dedicated-secret>           # encrypt blobs at rest
AUTH_TOKEN_KEY_PREVIOUS=<old-key>           # optional decrypt during rotation
```

Production refuses to start with store-on and no `AUTH_TOKEN_KEY`. Encryption
stays behind `tokenCrypto.encryptTokenPayload` / `decryptTokenPayload` so a
later KMS envelope can replace the body without touching routes.

New features (Payload Cases) do not require stored provider tokens — Payload uses
the SQLite user id as a bridge and its own Postgres-backed auth.

## Providers

| `AUTH_PROVIDER` | Credential check | Map to local user | Status |
|-----------------|------------------|-------------------|--------|
| `keycloak` | Keycloak token introspection (BFF) | Link / shadow user by Keycloak sub | **Active — use this** |
| `local` | SQLite password | Existing user | Fallback only |
| `directus` | Directus `POST /auth/login` + `/users/me` | Link / shadow user by email + external id | **Retired — do not use for new deployments** |

Service `DIRECTUS_TOKEN` is for legacy Directus operations only. New provisioning uses the Keycloak Admin API. New data goes into Payload CMS.

Schema / data-model bootstrap is a **separate** CLI concern: interactive Directus
Administrator login (or a one-run pasted token) — not a long-lived admin token in
`.env`, and not a product HTTP route. Case admins must not get Directus
Administrator. See `docs/directus-schema-setup.md`.

## Module map

```
backend/src/auth/
  index.js           # façade: login, logout, public config
  session.js         # product JWT + cookie only
  identityStore.js   # links (+ optional encrypted token rows)
  tokenCrypto.js     # key boundary for at-rest IdP tokens
  loginRateLimit.js  # attempt / failure budgets
  originCheck.js     # CORS-origin gate for cookie mutations
  auditLog.js        # hashed-identity auth events
  changePassword.js  # provisioned-user password change (Keycloak Admin API)
  providers/
    local.js         # fallback
    directus.js      # legacy — being retired
  # Legacy Directus Cases call-as-user (retained while Directus is still live):
  directusLinkCookie.js / directusUserSession.js
  requireDirectusLink.js
```

Public: `GET /api/auth/config` and `GET /api/features` → `auth` (`methods: ["password"]`, provider flags). Passkeys / remember-device were removed from the tree (SSO/OIDC later).

## Open decisions (compromise later — keep seams)

| Decision | Current compromise | Seam |
|----------|-------------------|------|
| ~~Final IdP~~ | **Resolved:** Keycloak (`AUTH_PROVIDER=keycloak`). Directus password provider is retired. | `providers/*` |
| Cloud secrets (Key Vault / KMS) | Env-mounted keys; dual-key decrypt | `tokenCrypto` |
| Multi-instance rate limits / sessions | In-process maps + SQLite sessions | `loginRateLimit`, `sessions` table |
| Admin UI to link accounts under `strict` | Manual DB link row or brief `AUTH_LINK_POLICY=email` window | `auth_identity_links` |
| Shared audit export / SIEM | SQLite table with prune | `auditLog.recordAuthEvent` |
| Full user migration to Keycloak/Payload | SQLite user id used as owner bridge in Payload | `owner_id`, `uploaded_by` fields on Payload collections |

## Enabling Keycloak login

```bash
AUTH_PROVIDER=keycloak
KEYCLOAK_URL=http://keycloak:8080          # internal (backend → keycloak over trame-net)
KEYCLOAK_REALM=slicer-web
KEYCLOAK_CLIENT_ID=slicer-web-backend
KEYCLOAK_CLIENT_SECRET=                    # set by setup-keycloak.mjs, stored in Infisical
# AUTH_LINK_POLICY=strict                  # default — no silent email takeover
```

## Enabling Directus login (legacy — being retired)

```bash
AUTH_PROVIDER=directus
DIRECTUS_URL=https://your-directus-host
# AUTH_LINK_POLICY=strict   # default
# Keep AUTH_STORE_PROVIDER_TOKENS unset/false unless you need user-scoped IdP calls
```

## Operational checklist (production)

- Strong `JWT_SECRET`; `COOKIE_SECURE` / TLS termination
- Tight `CORS_ORIGINS` (also used for auth Origin checks)
- `AUTH_PROVIDER=keycloak` in production; Keycloak URL is internal-only (not public)
- Registration off unless you intentionally run local accounts
- `AUTH_STORE_PROVIDER_TOKENS` only needed for legacy Directus Cases path — leave unset for new deployments
- When migrating existing local users: briefly set `AUTH_LINK_POLICY=email`, or insert `auth_identity_links` admin-side

## Roadmap shape (not blocked on infra choices)

1. **Passkeys + multi-method login** (see plan below) — clinician daily UX under product control  
2. **OIDC provider** behind same façade when a hospital/Entra tenancy is available  
3. Admin “link identity” API under product admin auth  
4. **User provision (Pattern A done first):** `POST /api/admin/users/provision` + force password change  
5. Shared Redis (or similar) for rate limits when backend scales out  
6. Optional KMS envelope inside `tokenCrypto` if long-lived user IdP tokens return  
7. Directus session revoke on logout **if** tokens are stored  

### User provisioning (current)

Keycloak owns the account lifecycle. Users are provisioned via the Keycloak Admin API
(see `scripts/setup-keycloak.mjs` and `POST /api/admin/users/provision`).

- `POST /api/auth/change-password` calls the Keycloak Admin REST API to set a new password.
  Admin password is prompted at call time and never persisted.
- Cases are managed by Payload CMS (`/api/cases`). Ownership is tracked via the SQLite user
  id (`owner_id`) as a bridge until full Keycloak/Payload user migration is complete.
- Directus provisioning scripts (`migrate-local-users-to-directus.mjs`, etc.) are
  superseded — use Keycloak Admin API for new deployments.

### Cases: Payload CMS (current)

Cases and attachments live in Payload CMS (PostgreSQL). No Directus account or `dx_link`
cookie is required for the Payload Cases path. Auth is the standard product JWT cookie.

- Frontend branches on `sessionMeta.source === ‘payload:case’` to use Payload vs Directus endpoints.
- `ENABLE_DIRECTUS_CASES=true` still activates the legacy Directus Cases path for sites
  that have not yet migrated.

---

## Implement plan: OIDC first (passkeys deferred)

Passkey / WebAuthn code was removed from this repo. Prefer hospital SSO (OIDC) before re-adding passkeys. The notes below remain as a future sketch only.

**Goals:** no security compromise; smooth clinical UX; SSO vendor can change without product rewrite.

**Non-goals for this plan:** inventing crypto, custom SAML stacks, SMS OTP as primary MFA, prod MFA kill-switch.

### Product login UX (end state)

Clinician sees, in priority order when enabled for the site:

1. **Passkey** — Face ID / Windows Hello / security key (primary on capable devices)  
2. **Organization sign-in** — OIDC button when that tenant is configured  
3. **Email / password + TOTP** — universal fallback (Directus or local)

All three end in the **same product session** (`session.js` JWT + httpOnly cookie + `sessions` / `jti`).

Identity links:

| Method | `auth_identity_links.provider` | `external_id` |
|--------|--------------------------------|---------------|
| Directus password | `directus` | Directus user id |
| Passkey | `webauthn` | credential id (base64url) *or* user handle bound to user |
| OIDC | `oidc:<issuer-key>` e.g. `oidc:entra` | IdP `sub` claim |

One local `users` row can hold multiple links (passkey + Directus + Entra).

### Industry libraries (prefer these; do not hand-roll)

| Concern | Library / standard | Why |
|---------|-------------------|-----|
| Passkeys / WebAuthn server | **`@simplewebauthn/server`** | Maintained WebAuthn L2 helpers (challenge, verify registration/auth) |
| Passkeys browser | **`@simplewebauthn/browser`** | Matches server options shape; less footgun than raw `navigator.credentials` |
| OIDC client (BFF) | **`openid-client`** (v5/v6) | Discovery, PKCE, state/nonce, token validation — IETF OIDC |
| JWT / JWS at edges if needed | **`jose`** | Modern alternative when verifying IdP tokens outside openid-client |
| Product session JWT today | Keep **`jsonwebtoken`** until a deliberate migrate | Stable; optional later move to `jose` in `session.js` only |
| Password hash (local) | Keep **`bcrypt`** | Already in use |
| CSRF on cookie mutations | Keep Origin allowlist; OAuth **state** + PKCE for OIDC | Don’t roll custom SAML |

Avoid: home-grown WebAuthn CBOR, “JWT as OAuth state only”, storing IdP access tokens in `localStorage`, Passport strategies that push tokens to the browser.

### Architecture (seams you already have)

```
backend/src/auth/
  index.js                 # loginWithProvider, multi-method orchestration
  session.js               # product cookie/JWT only
  identityStore.js         # auth_identity_links
  trustedDevices.js        # post-MFA device trust (password path)
  providers/
    local.js               # today
    directus.js            # today
    webauthn.js            # NEW — challenge + verify only
    oidc.js                # NEW — discovery + code exchange + claims → user
  webauthn/
    challenges.js          # short-lived challenge store (Redis later; memory/SQL now)
    credentialsStore.js    # public keys, counter, transports
  oidc/
    clientRegistry.js      # per-tenant issuer configs from env / later DB
```

**Rule:** providers never set the product cookie. Only `session.issueAppSession` does.

`getPublicAuthConfig()` expands to:

```json
{
  "provider": "local|directus",
  "methods": ["password", "webauthn", "oidc"],
  "oidc": [{ "id": "entra", "label": "Continue with organization" }],
  "webauthn": { "enabled": true, "rpId": "app.example.com" },
  "rememberDeviceEnabled": true,
  "registrationEnabled": false
}
```

SPA chooses UI from `methods`, not hardcoded provider strings.

### Security bar (must pass review before enable)

**Passkeys**

- HTTPS only (except `localhost`)  
- `rpID` + origin from config; pinned to deployment host  
- User verification **required** (`required` or `preferred` with policy for clinical)  
- Challenge: single-use, ≤5 min TTL, bound to session or anonymous id  
- Store: credential public key, `credentialID`, **sign counter**, transports, aaguid if present  
- Clone detection: reject if counter regresses  
- **Enrollment only after** an already-authenticated strong session (password+TOTP or OIDC) — no open “register any passkey as admin”  
- Recovery: require second factor path (second passkey or password+TOTP) — no “email magic link alone” as recovery for clinical  
- Rate-limit attestation/assertion endpoints like login  

**OIDC**

- Authorization code + **PKCE** (S256); no implicit flow  
- Validate `iss`, `aud`, `exp`, `nonce`, signature via discovery JWKS  
- Map only trusted claims (`sub` required; email only if `email_verified`)  
- Strict link policy (same as Directus): no silent email takeover  
- Store refresh tokens only if product needs IdP API as user; default **discard** like Directus  
- Per-tenant client secret/cert in secrets manager later; env for first tenant  
- Logout: local session always; optional IdP RP-initiated logout when configured  

**Shared**

- Audit every enrollment / assertion / OIDC login  
- No elevation: new users `role=user`  
- Production refuses missing `WEBAUTHN_RP_ID` / OIDC config when those methods are enabled  

### Data model (migrations)

```text
auth_webauthn_credentials
  id, user_id, credential_id UNIQUE, public_key, counter, transports_json,
  device_type, backed_up, created_at, last_used_at

auth_webauthn_challenges
  challenge_id, challenge, user_id NULL, type register|auth, expires_at, created_at

auth_oidc_states          -- short-lived PKCE state (or Redis)
  state, code_verifier, nonce, redirect_path, expires_at
```

Reuse `auth_identity_links` for (provider, external_id) → user_id.

### Phase A — Foundation (1–2 days of focused work)

1. Extend `getPublicAuthConfig` + SPA feature flags for `methods[]`.  
2. Challenge store API (SQL is fine; abstract for Redis).  
3. Document env:

```bash
WEBAUTHN_RP_ID=localhost          # production: app hostname only
WEBAUTHN_RP_NAME="Slicer Web"
WEBAUTHN_ORIGIN=http://localhost:8000
AUTH_METHODS=password,webauthn    # comma list; oidc added when ready
```

4. Audit events: `webauthn_register`, `webauthn_login`, `oidc_login`.

**Exit:** no UX yet; tables + config + flags only.

### Phase B — Passkeys (clinician UX; you control it)

**Deps (backend):** `@simplewebauthn/server`  
**Deps (frontend):** `@simplewebauthn/browser`

**API**

| Route | Role |
|-------|------|
| `POST /api/auth/webauthn/register/options` | AuthN required — options for create |
| `POST /api/auth/webauthn/register/verify` | AuthN required — store credential + link |
| `POST /api/auth/webauthn/login/options` | Public — options for get (optional identity hint) |
| `POST /api/auth/webauthn/login/verify` | Public — verify → `issueAppSession` |

**UX**

- Settings / first-login prompt: “Add passkey for faster sign-in”  
- Login page: “Sign in with passkey” primary when `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`  
- Fallback always visible: email + password (+ TOTP)

**Exit criteria**

- Enroll after password+TOTP; login with passkey alone issues product session  
- Counter + challenge TTL enforced  
- Works on Chrome/Edge + Windows Hello or Safari + iCloud Keychain (smoke)  

### Phase C — OIDC (when a real tenant exists)

**Deps:** `openid-client`

**API**

| Route | Role |
|-------|------|
| `GET /api/auth/oidc/:tenantId/start` | Redirect to IdP (PKCE) |
| `GET /api/auth/oidc/:tenantId/callback` | Code exchange → map user → session → redirect SPA |

**Config (per tenant, env-first)**

```bash
OIDC_TENANTS=entra
OIDC_ENTRA_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_ENTRA_CLIENT_ID=
OIDC_ENTRA_CLIENT_SECRET=
OIDC_ENTRA_REDIRECT_URI=https://app.example.com/api/auth/oidc/entra/callback
OIDC_ENTRA_SCOPES=openid profile email
OIDC_ENTRA_LABEL=Continue with organization
```

Later: tenant rows in DB for multi-hospital; same `providers/oidc.js` + `clientRegistry`.

**Exit criteria**

- Happy path code+PKCE login; bad state/nonce rejected  
- Same user can link OIDC `sub` after admin/email policy  
- Changing issuer = new env/tenant id, **not** product identity rewrite  

### Phase D — Hardening / scale

- Redis for challenges, OIDC state, login rate limits  
- Optional: migrate product JWT to `jose`  
- KMS for any stored refresh material  
- Admin UI: list passkeys, revoke device, link/unlink IdP  
- Penetration test / WebAuthn checklist (OWASP ASVS session + auth chapters)  

### Explicit non-compromises

| Temptation | Decision |
|------------|----------|
| Passkeys without prior strong bind | **No** open enrollment |
| Password-only “for clinics” | **No** as sole production path when MFA/passkey available |
| One global hospital SSO hardcode | **No** — multi-tenant OIDC registry |
| Browser stores Entra tokens | **No** — BFF only |
| AUTH_DEV_RELAXED in production | **Already fatal** |

### Suggested build order (this project)

1. **Phase B (passkeys)** next — UX win you own; no waiting on hospital contracts.  
2. Keep Keycloak + local as fallback; Directus provider is retired.  
3. **Phase C (OIDC)** when first Entra/Okta app registration exists.  
4. Phase D as soon as multi-instance or multi-hospital is real.

### Test plan (security-relevant)

- Register options without session → 401  
- Reuse challenge → reject  
- Wrong origin / rpId → reject  
- Counter decrease → reject + audit  
- OIDC callback with swapped state → reject  
- Unverified email claim cannot take existing local account under `strict`  
- Passkey login issues cookie with Secure/SameSite in prod; session appears in `sessions`  

---

*This plan prefers **@simplewebauthn/** + **openid-client** so crypto and protocol edge cases stay in maintained libraries; product code owns session cookies, identity links, audit, and UI only.*
