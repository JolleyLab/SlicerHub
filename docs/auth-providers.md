# Authentication architecture

This is the **product** login design — not a throwaway PoC path. Build further
work against these contracts. Compromise only where a final platform decision
is still open (called out below).

## Freeze (2026-08): no new custom identity

**Direction:** org SSO later via **OIDC in the BFF** (Entra/Okta, or Keycloak only if a self-hosted broker is required). **Directus stays** as content/collab identity (Cases ACLs, comments, call-as-user). Product session stays this app’s httpOnly cookie.

**Do not add new identity features in this repo** (password stores, MFA, reset, federation, user-directory replacement). Use Directus or the future OIDC provider. Glue allowed: provision/link Directus users, session mapping, encrypted server-side IdP tokens for Cases-as-user, `providers/*` plug-ins backed by maintained libraries (e.g. `openid-client` for OIDC).

**Stop investing in:** SQLite as a production password IdP; expanding Directus password+OTP as the long-term SSO story. Local provider is a fallback, not the north star.

See also workspace rule `.cursor/rules/identity-no-custom-idp.mdc`.

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
   **North star:** every collab user is also a **Directus user** (non-admin mostly),
   linked via `auth_identity_links` (`provider=directus`). Cases require that link
   when enabled (`requireDirectusLink` / `AUTH_REQUIRE_DIRECTUS_LINK`).
5. **IdP tokens are not part of the default session.** After mapping identity,
   Directus access/refresh material is discarded unless explicitly enabled.

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

Only if a product feature must call Directus (or another IdP) **as the end user**
from the BFF:

```bash
AUTH_STORE_PROVIDER_TOKENS=true
AUTH_TOKEN_KEY=<dedicated-secret>           # encrypt blobs at rest
AUTH_TOKEN_KEY_PREVIOUS=<old-key>           # optional decrypt during rotation
```

Production refuses to start with store-on and no `AUTH_TOKEN_KEY`. Encryption
stays behind `tokenCrypto.encryptTokenPayload` / `decryptTokenPayload` so a
later KMS envelope can replace the body without touching routes.

## Providers

| `AUTH_PROVIDER` | Credential check | Map to local user |
|-----------------|------------------|-------------------|
| `local` | SQLite password | Existing user |
| `directus` | Directus `POST /auth/login` + `/users/me` | Link / shadow user by email + external id |

Service `DIRECTUS_TOKEN` is for **system** Cases / jobs only — never for interactive login.

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
  changePassword.js  # provisioned-user password change
  directusLinkCookie.js / directusUserSession.js  # Cases call-as-user
  requireDirectusLink.js
  providers/
    local.js
    directus.js
```

Public: `GET /api/auth/config` and `GET /api/features` → `auth` (`methods: ["password"]`, provider flags). Passkeys / remember-device were removed from the tree (SSO/OIDC later).

## Open decisions (compromise later — keep seams)

| Decision | Current compromise | Seam |
|----------|-------------------|------|
| Final IdP (Directus password vs Entra OIDC) | Directus password provider | `providers/*` |
| Cloud secrets (Key Vault / KMS) | Env-mounted keys; dual-key decrypt | `tokenCrypto` |
| Multi-instance rate limits / sessions | In-process maps + SQLite sessions | `loginRateLimit`, `sessions` table |
| Admin UI to link accounts under `strict` | Manual DB link row or brief `AUTH_LINK_POLICY=email` window | `auth_identity_links` |
| Shared audit export / SIEM | SQLite table with prune | `auditLog.recordAuthEvent` |

## Enabling Directus login

```bash
AUTH_PROVIDER=directus
DIRECTUS_URL=https://your-directus-host
# AUTH_LINK_POLICY=strict   # default
# Keep AUTH_STORE_PROVIDER_TOKENS unset/false unless you need user-scoped IdP calls
```

## Operational checklist (production)

- Strong `JWT_SECRET`; `COOKIE_SECURE` / TLS termination
- Tight `CORS_ORIGINS` (also used for auth Origin checks)
- Directus: no public self-register, MFA where available, HTTPS
- Registration off unless you intentionally run local accounts
- Prefer not enabling `AUTH_STORE_PROVIDER_TOKENS` until Cases (or similar) requires it
- When migrating existing local users to Directus: briefly set `AUTH_LINK_POLICY=email`, or insert `auth_identity_links` admin-side

## Roadmap shape (not blocked on infra choices)

1. **Passkeys + multi-method login** (see plan below) — clinician daily UX under product control  
2. **OIDC provider** behind same façade when a hospital/Entra tenancy is available  
3. Admin “link identity” API under product admin auth  
4. **User provision (Pattern A done first):** `POST /api/admin/users/provision` + force password change  
5. Shared Redis (or similar) for rate limits when backend scales out  
6. Optional KMS envelope inside `tokenCrypto` if long-lived user IdP tokens return  
7. Directus session revoke on logout **if** tokens are stored  

### Admin user provision (first testable slice)

Clinicians are never created by self-register in Directus-mode sites. Product admins call:

- `POST /api/admin/users/provision` — creates Directus user (service token) + local shadow + `auth_identity_links`, sets `must_change_password`
- Env: `DIRECTUS_DEFAULT_ROLE_ID`, `USER_PROVISION_MODE=temp_password` (Pattern A)
- `POST /api/auth/change-password` + SPA force-change UI when `mustChangePassword` is true
- Backfill existing locals: `node scripts/migrate-local-users-to-directus.mjs` (service token)
- The one-release SQLite→Directus password bridge (`AUTH_PASSWORD_BRIDGE`) has been removed. Local password
  hashes are no longer used for sign-in; users sign in with their Directus password.

Pattern B (`invite_email`) is intentionally deferred; local handoff lives in gitignored `docs/user-provisioning-patterns.md`.

### Cases: call as user (not service token)

When `ENABLE_DIRECTUS_CASES=true`, Cases list/comments/attachments use the signed-in user's
Directus access token (encrypted on the app session via `AUTH_STORE_PROVIDER_TOKENS`, auto-on
with Cases). **No service-token fallback** for those routes.

- First connect Cases with `AUTH_PROVIDER=directus` (email + password). That sets an
  encrypted httpOnly `dx_link` cookie (Directus refresh) and stores tokens on the current
  session jti. No extra SQLite table — the cookie is the durable bridge.
- Later passkey logins re-attach by refreshing from `dx_link` onto the new session jti.
  If attach fails while Cases is on, **passkey login fails closed** (no app session),
  Directus tokens/`dx_link` for that user are cleared, and the UI asks for password
  login then auto-offers passkey enrollment.
  Single logout clears the product session only; **logout-all** also clears `dx_link`
  (then password login is required again).
- Directus policies on the clinician role control what each user can see.
- Service `DIRECTUS_TOKEN` remains for provision + password admin operations only.

#### Case invites (existing Directus users)

- Case **admin** or **collaborator** can invite by email (`POST /api/directus/cases/:id/invites`).
- If the email already has a Directus user: **admin** adds immediately + in-app notify; **collaborator**
  creates a pending invite until a case admin approves/rejects.
- If the email has **no** Directus user yet: BFF creates a `case_signup_invites` row (no Directus user
  until redeem). **Admin** gets a single-use expiring link (`/?invite=<token>`, default TTL 7 days via
  `CASE_INVITE_TTL_DAYS`); **collaborator** creates `pending_approval` until an admin approves (then
  the link is minted). People UI shows **Copy link** — SMTP is not required for this slice.
- Redeem: `GET /api/invites/signup/:token` (preview) + `POST /api/invites/signup/:token/accept`
  (creates Directus + local user, applies membership, issues product session + Directus call-as-user
  tokens). Link is single-use; expired/used tokens are rejected.
- **Email:** Off by default (`SMTP_ENABLED=false`). Minting/approving a signup invite still
  returns a redeem link for **Copy link** in People. When ready, set `SMTP_ENABLED=true` plus
  `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` (and auth if required). Soft-fail: email errors never
  block the invite.
  - Local: compose includes **Mailpit** (`mailpit:1025`, UI [http://localhost:8025](http://localhost:8025)).
    Keep `SMTP_ENABLED=false` for copy-link only; set `SMTP_ENABLED=true` to exercise Mailpit.
  - Production: real SMTP + `SMTP_ENABLED=true`, or leave false for copy-link only.
- Notifications: `GET /api/notifications` (product user).
- Membership writes go through Directus as nested `case.collaborators` (and may fall back to
  `/items/case_directus_users`). **Important:** Directus still enforces permissions on the
  junction collection for those writes — enabling Update on `case` alone is not enough.
- **Required Directus ACL (role / people updates):**
  1. Find the **role of the user that owns `DIRECTUS_TOKEN`** (Settings → Users → that user → Role).
     Easiest: give that role **Administrator**, or explicitly:
     Access Control → that role’s policy → collection **`case_directus_users`** → enable
     **Read + Create + Update** (All items) and allow field **`role`**.
     This also lets the BFF **backfill case owners** onto the junction as `admin` (needed after
     migration when `user_created` was never copied into `case_directus_users`).
  2. Clinician policy on **`case_directus_users`** Update — item filter must allow **owners**
     even before they appear on the junction:
     ```json
     {
       "_or": [
         { "case_id": { "user_created": { "_eq": "$CURRENT_USER" } } },
         {
           "case_id": {
             "collaborators": {
               "_some": {
                 "_and": [
                   { "directus_users_id": { "_eq": "$CURRENT_USER" } },
                   { "role": { "_eq": "admin" } }
                 ]
               }
             }
           }
         }
       ]
     }
     ```
     If the filter is only the second branch, Created By users missing from collaborators
     cannot change roles until backfill succeeds.
  3. Save → if you changed the service user role, create a **new static token** and update
     `DIRECTUS_TOKEN` in the BFF env, then recreate the backend. Clinicians must sign out/in.
  4. Reload Cases once (triggers owner backfill) or open People / save roles on each case.
- **Roles:** Membership (who is on the case) lives in Directus `case_directus_users`.
  Case roles (`admin` / `collaborator` / `read_only`) are written to Directus when that
  field works; if Directus returns `INTERNAL_SERVER_ERROR` on `role`, the BFF stores the
  role in SQLite `case_collaborator_roles` (product runtime) and still shows/enforces it
  in the app. Fix the Directus dropdown later if you want roles mirrored in Studio.

#### Clinician Comments ACL (required for case discussion)

In Directus Studio → **Settings → Access Control** → clinician role / policies:

1. **Comments** (`directus_comments`) — **Read** and **Create**
2. Allow fields at least: `id`, `collection`, `item`, `comment`, `user_created`
   (dates `date_created` / `date_updated` optional but useful)
3. Prefer **no item filter** that hides other users’ comments on shared cases
   (or filter so comments on `collection = case` items the user can read are visible)
4. After changing policies, have the clinician **sign out and back in** so the JWT
   picks up the new accountability

#### Case list dates (Created / Modified)

Studio’s Created time under **Revisions** is stored in Directus **Activity**
(`directus_activity`), not as a column on `case`. The app already lists cases
call-as-user; it then loads create/update timestamps from `/activity` for those
case ids.

Today both the clinician token and the service `DIRECTUS_TOKEN` are denied
Activity Read — that is why cards have no date even though Studio shows one.

**Fix (Directus-native — pick one):**

1. **Preferred for clinicians staying locked down:** In Access Control, open the
   **role used by `DIRECTUS_TOKEN`** (service / automation user) → enable
   **System Collections** → **Activity** → **Read** (fields at least
   `id`, `action`, `collection`, `item`, `timestamp`). The BFF already falls
   back to the service token for Activity **only** for case ids the clinician
   already loaded — it does not list cases as the service user.

2. **Or** grant the clinician role the same Activity Read (also under System
   Collections — it will not appear in the normal collection list).

3. **Longer-term field on the item:** Data Model → `case` → enable **Date
   Created** / **Date Updated**. New items then carry dates on the case itself;
   existing rows may stay empty until touched unless you backfill.

No product SQLite cache is used for these dates.

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
2. Keep Directus/local + TOTP + remember-device as fallback.  
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
