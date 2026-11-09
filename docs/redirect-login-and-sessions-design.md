# Redirect login, sessions and procedure mode — design

Status: phases 1–7 done (cutover 2026-11-06); phase 8 deferred

## Summary

SlicerHub moves sign-in, password reset, self-registration and account setup to Keycloak, using Keycloak's own pages styled to look like SlicerHub. We do it now, while the Keycloak/Payload migration is still open. Keycloak is code that security teams review far more than ours, and it is the only route to hospital SSO.

The same change sets session rules to current security guidance:

- 30 minutes idle, where only real use counts;
- re-sign-in every 12 hours;
- a session that ends mid-work is restored in a popup without losing unsaved work;
- **procedure mode** keeps a theatre workstation signed in for long surgical cases (24 h hard cap).

Nobody needs a new account or password. Accounts already live in Keycloak, and existing app sessions keep working through the switch.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | What moves to Keycloak | As much as possible: sign-in, password reset, self-registration, email verification, invite account setup, lockout, MFA. SlicerHub keeps only what Keycloak can't do: the registration **approval** step and case invites. |
| 2 | MFA | Off for now. OTP and passkeys are configured but not required; turn on (at least for admins) before a real production setup. |
| 3 | Session timeouts | Industry standard, favouring security: 30 min idle counting only real user activity; 12 h absolute before re-entering a password (OWASP Session Management Cheat Sheet; NIST SP 800-63B AAL2 — 12 h / 30 min, the stricter of its published revisions). |
| 4 | Procedure mode maximum | 24 h hard cap in code for now; sites may configure lower; developers may revisit after real-world use. |
| 5 | Sign-out | OIDC best practice: RP-initiated logout with `id_token_hint`, plus OIDC **back-channel logout** so ending a Keycloak session (admin action, disabled account, hospital IdP sign-out) ends the SlicerHub session immediately. |
| 6 | Keycloak event records | On, kept 30 days: login events (for security investigations hospitals expect) and admin events without user representations. Our app audit log stops recording logins, since Keycloak has them. |

## Background: how it works today

1. The SPA's login form posts email + password to the backend (`POST /api/auth/login`).
2. The backend sends them to Keycloak's token endpoint (the OAuth "password grant") and reads the role from the token.
3. The backend issues its own session: a JWT in an `httpOnly`, `SameSite=Strict` cookie (7 days) plus a row in the SQLite `sessions` table.
4. Every API call checks the JWT, the session row, a 30-minute idle timeout, and (since the security fixes) re-checks the Keycloak role/account at most every 5 minutes.
5. Password reset, registration completion and invite redemption are our own token flows: the app emails links and sets passwords through Keycloak's admin API.

Problems with this:

- **The password grant is deprecated** (OAuth 2.0 Security BCP; removed in OAuth 2.1). It cannot do SSO, so hospital sign-in is impossible.
- **We own security-critical code:** password handling, login lockout, reset tokens and account setup.
- **The idle timeout barely works:** background polling counts as activity, so an open tab never goes idle. Meanwhile active users are signed out at day 7 regardless.
- **A session that ends mid-work fails silently:** a save can get a 401 and the user may not notice.
- Keycloak is not reachable from browsers today (bound to `127.0.0.1:8082`).

## Goals and non-goals

Goals

- Sign-in ready for hospital SSO (SAML 2.0 / OpenID Connect) through Keycloak.
- Login, registration and reset pages that feel like one product with SlicerHub, light and dark.
- Session rules that meet current guidance, without losing work when a session ends.
- Long-running sessions for surgical use, configurable per site within a 24 h cap.
- The app never sees passwords.
- Keep the privacy-minimization stance.

Non-goals (for this piece)

- Connecting a specific hospital's SSO (we make it possible, not configured).
- Turning MFA on (configured, not required).
- Changing case roles/permissions.
- Hardening for long network outages in theatre (cursory tolerance only).
- Trame / My Projects / My Files.

## What users see

| Moment | Today | After |
|---|---|---|
| Sign in | SlicerHub form | Keycloak page styled as SlicerHub, at `/sso/…` on the same domain |
| Request access | SlicerHub form; reviewer approves; completion link sets password | Keycloak registration page (same fields) → verify email → "Access pending approval" → reviewer approves in SlicerHub → user can work |
| Forgot password | SlicerHub email + page | Keycloak "Forgot password" email + page, styled as SlicerHub |
| Invited to a case (no account yet) | SlicerHub email with set-password link | Keycloak email to verify and set a password; the case is there on first sign-in |
| Idle 30 min | Rarely happens (polling keeps it alive) | Signed out after 30 min without real use; the "session ended" popup restores it |
| 12 h since password | Not enforced (7-day cap) | Popup asks for the password again; nothing is lost |
| Session ends while working | Silent 401s; a save can fail unnoticed | "Your session ended" dialog → sign in in a popup → the request (e.g. save) finishes |
| Long surgical case | Idle timeout applies | Procedure mode: stays signed in up to 24 h, banner shows when it ends |
| Sign out | App session ends | App session **and** Keycloak sign-in end |

"Keycloak is public-facing" means its sign-in, registration and reset pages can be reached by any browser that can reach SlicerHub, at the same address under `/sso/`. Its admin console stays blocked from outside. For us, Keycloak joins nginx and the backend as something we keep patched and monitored.

## Login flow

The backend runs the standard OpenID Connect **authorization code flow with PKCE**. Keycloak's tokens never reach the browser, and the product session stays our own cookie and session row.

```
Browser                    SlicerHub backend                      Keycloak (/sso)
   |  click "Sign in"             |                                      |
   |----------------------------->| GET /api/auth/login/start            |
   |                              |  state, nonce, PKCE verifier         |
   |                              |  -> short-lived signed httpOnly cookie
   |<-- 302 to /sso/.../sso ----|                                      |
   |------------------------------------------------------------------->| sign-in page (later: SSO / MFA)
   |<----------------------------------- 302 /api/auth/callback?code&state
   |----------------------------->| check state; exchange code +         |
   |                              | verifier + client secret ----------->|
   |                              |<------------- ID token --------------|
   |                              | verify signature (JWKS), issuer,     |
   |                              | audience, nonce; map sub/email/roles |
   |                              | issueAppSession()                    |
   |<-- 302 to return path -------|  (relative paths only)               |
```

- Library: `openid-client` (MIT) for discovery, PKCE and ID-token verification, rather than hand-rolling crypto.
- Keycloak access/refresh tokens are not kept. The ID token is stored **encrypted** (existing `tokenCrypto`) on the session row, only for `id_token_hint` at logout, and deleted with the session.
- **Logout:** delete the app session, then redirect to Keycloak's end-session endpoint with `id_token_hint` and a fixed `post_logout_redirect_uri`.
- **Back-channel logout:** Keycloak POSTs a signed `logout_token` to `/api/auth/backchannel-logout` (internal network) when a Keycloak session ends. The backend verifies it and deletes the matching app sessions (by Keycloak session id `sid`, or `sub`). The 5-minute role/account re-check stays as a backstop.
- **Approval gate:** using SlicerHub requires the realm role `app-user`. A signed-in account without it gets only `/api/auth/me` and the "Access pending approval" screen.

## Infrastructure

- **Keycloak behind nginx at `/sso/`** on the same domain: `KC_HTTP_RELATIVE_PATH=/sso`, `KC_HOSTNAME=https://<domain>/sso`, `KC_PROXY_HEADERS=xforwarded`. Same-origin means first-party cookies, no CORS, and the theme can read the app's theme cookie.
- **Admin console not public:** nginx returns 404 for `/sso/admin/` and the `master` realm from outside. Admins use the localhost port or an SSH tunnel as today.
- **Abuse limits:** nginx `limit_req` (built-in module) on Keycloak's registration and reset-credentials endpoints, since those send email. Login lockout is Keycloak's brute-force detection.
- **Production mode:** `kc.sh start` (not `start-dev`) with a real hostname, DB and an optimized build. `start-dev` stays for local development.
- **Realm client** `slicer-web-backend`:
  - standard flow on, **direct access grants off** (since the phase 7 cutover)
  - PKCE `S256` required
  - exact redirect URIs (`/api/auth/callback`, `/api/auth/popup-callback`)
  - exact post-logout URI
  - back-channel logout URL, with session required
- **Realm settings:**
  - SSO session idle 30 min and max 12 h (matching the app); brute-force detection on
  - email verification required; registration on, with the user-profile fields below
  - SMTP from the existing `SMTP_*` settings
  - events: login events on, admin events on without representations, both expiring after 30 days
  - OTP and WebAuthn (passkeys) policies configured but not required
- Realm configuration is kept as code (export + `scripts/setup-keycloak.mjs`), so environments match.

## Keycloak pages and emails (theme)

- A login theme `slicerhub` extending Keycloak's built-in `keycloak.v2` theme (Apache 2.0). It uses FreeMarker templates plus our CSS, logo, fonts and colour tokens.
- **Pages:**
  - sign in and register
  - verify email
  - forgot password and update password
  - OTP/passkey (for later)
  - errors, expired/invalid link and info messages
  - logout confirmation
- **Email theme:** verify email, password reset, and "execute actions" (invite account setup), worded and styled like SlicerHub's current emails.
- **Light/dark:** the app sets a small, non-identifying `sh_theme=light|dark` cookie on `/`. The theme's script reads it and falls back to `prefers-color-scheme`.
- **Registration fields** (Keycloak user profile): first name, last name, email, affiliation, intended use. Affiliation and intended use are removed from the account 30 days after a decision (the existing retention rule).
- Mounted into the Keycloak container at `/opt/keycloak/themes/slicerhub` and selected in the realm config.
- English only for now; Keycloak message bundles allow translation later.

## Flow changes and code removed

| Flow | After |
|---|---|
| Sign in / lockout | Keycloak |
| MFA | Keycloak (configured, off) |
| Forgot password | Keycloak reset email + page |
| Request access | Keycloak registration + email verification. SlicerHub creates the review item at first sign-in. Approve = grant `app-user` (and `app-org-admin` if chosen). Reject = delete the Keycloak account. |
| Invite (new email) | SlicerHub creates the Keycloak account, grants `app-user` and the case role, and asks Keycloak to send an "execute actions" email (verify email + set password, link back to the case). Keycloak's email is generic and can't name the case, so the case appears after first sign-in. |
| Invite (existing account) | Unchanged |
| Sign out | App + Keycloak; back-channel logout for sessions ended elsewhere |
| Reviewer notifications | Unchanged (SlicerHub emails reviewers about new requests) |

Removed at cutover (phase 7, done):

- **Login:** the `login-form` password path, `POST /api/auth/login`, the password-grant login in `auth/providers/keycloak.js`, and `auth/loginRateLimit.js`.
- **Password reset:** `routes/passwordReset.js`, the `password-reset-tokens` collection, and the reset/activation emails.
- **Registration:** the completion-token half of `routes/registrationRequests.js` and its forms.
- **Invites:** invite token redemption (`/api/cases/invites/preview|redeem`, `token_hash` on `case-invites`) and the signup-invite email. **Kept, unlike first planned:** `case-invites.expires_at` and the expiry watchdog. They still mark never-used invites expired, so the retention sweep removes them and their email after 30 days. The watchdog now also deletes the invitee's Keycloak account if it was never set up (`services/inviteExpiry.js`).
- **Cleanup:** the matching steps of the data-retention sweep.

Kept:

- the app session;
- the role/account re-check;
- the case invite **approval** flow;
- the registration review queue;
- the app audit log, for app-only events (procedure mode, sign-out, password change). It no longer records sign-ins.

## Sessions

### Normal sessions

| Rule | Value | Notes |
|---|---|---|
| Idle timeout | 30 min | Only real use counts. Background polls and heartbeats send `X-Background: 1` and don't extend the session. The page reports real activity (keys, pointer, viewer interaction including the same-origin viewer iframes) at most once every few minutes. All tabs share the session: a tab that goes idle asks the server, which counts use from every tab, so an idle background tab never ends a session that is in use elsewhere. |
| Absolute lifetime | 12 h | The app JWT and session row expire 12 h after password entry. The Keycloak SSO session max is the same, so the popup asks for the password again. |
| Server-side | Enforced on every request | The browser timer only warns. The server decides. |
| Ended elsewhere | Immediate | Back-channel logout, plus the 5-minute account re-check |

The 7-day token and "quiet renewal" go away: nobody stays signed in long enough to need them.

### Session ended mid-work

- A shared handler catches any 401 from `/api/*` (a `fetch` wrapper) and from TUS uploads.
- It shows "Your session ended — sign in to continue". The button opens the Keycloak sign-in in a **popup**; because the user clicks, popup blockers allow it. The popup's callback page tells the opener and closes.
- When the app ends a session (sign-out, idle, 12 h, procedure mode over), the server also ends its Keycloak sign-in (`endSession` → Keycloak admin API). The popup, or a refresh, therefore always asks for the password: someone walking up to a timed-out screen can't get back in by refreshing. A new sign-in replacing the browser's old session (password change, re-sign-in) keeps the Keycloak sign-in.
- The failed request is retried once. An unsaved scene stays in memory throughout.
- If a **different** account signs in, the page reloads rather than mixing two users' data.
- Failed saves are obvious regardless: the Save button returns to "unsaved" and the error stays until dismissed.

### Procedure mode

| Rule | Design |
|---|---|
| Who starts it | The signed-in user, from the user menu. Their account is used for the whole procedure. |
| Acknowledgment | Required every time: "This workstation will stay signed in as you until <time>. Anyone using it acts as you. End procedure mode when you're done." |
| Length | Default 8 h (site-configurable), or another number of hours up to the maximum, or "until I end it" |
| Hard limit | 24 h, a constant in code. Sites can configure lower. |
| While active | No idle timeout and no 12 h limit. The account re-check and back-channel logout still apply. Network drops don't end it, because the server doesn't rely on heartbeats. |
| Visible | Persistent banner: "Procedure mode — ends at 18:30 · End procedure mode" |
| Ended by the user | Back to normal session rules. They stay signed in if within 12 h of their last password entry, otherwise the popup asks for it. |
| Time runs out | Signed out of the app and Keycloak, so the workstation isn't left signed in |
| Audit | `procedure_mode_start` / `procedure_mode_end` events (user id + time only) |

Starting procedure mode asks Keycloak for a fresh sign-in (`max_age=0`, password in the popup). That proves the person starting it is the account holder, and the session's lifetime begins from that moment.

Configuration, so site rules live with the on-site team:

| Variable | Default | Meaning |
|---|---|---|
| `PROCEDURE_MODE_ENABLED` | `true` | Turn the feature off for a site |
| `PROCEDURE_MODE_DEFAULT_HOURS` | `8` | Pre-selected length |
| `PROCEDURE_MODE_MAX_HOURS` | `24` | Site maximum, clamped to the 24 h code cap |
| `SESSION_IDLE_MINUTES` | `30` | Normal idle timeout |
| `SESSION_MAX_HOURS` | `12` | Normal absolute lifetime |

Storage: two columns on the session row, `procedure_until` and `procedure_open_ended`. Keycloak's own SSO session for that user still ends at 12 h. This only matters if the app session ends and the popup is needed, in which case the password is asked for.

Known gap (accepted as cursory): Full Slicer seats have their own lease/warm-idle timers on the server (15/30 minutes), so a long network outage can still reap a seat. Slicer Web runs in the browser and is unaffected.

## Hospital SSO readiness

- Each hospital is added in Keycloak as an **identity provider** (SAML 2.0 or OpenID Connect). The login page shows "Sign in with <hospital>", or a site URL sends users straight there (`kc_idp_hint`). Their MFA and session policy are the hospital's.
- **Same approval gate as self-registration:** a first-time SSO user has no `app-user` role and sees "Access pending approval". Approval grants the role. A site can later auto-grant `app-user` to its hospital's users through an identity-provider mapper, if the site decides SSO alone is enough.
- **Account linking:** an SSO user whose verified email matches an existing account is linked to it (Keycloak first-broker-login flow), so existing case access carries over.
- **Back-channel logout** means a hospital sign-out that reaches Keycloak also ends SlicerHub sessions.
- A short guide for on-site teams on adding their hospital's identity provider.

## Security and privacy

- **Exposure:** Keycloak's sign-in, registration and reset endpoints become reachable from the internet. Mitigations:
  - admin console blocked from outside
  - brute-force detection
  - nginx rate limits on email-sending endpoints
  - production mode
  - patching on Keycloak releases
  - TLS at Cloudflare
- **Protocol:**
  - PKCE (`S256`), `state` and `nonce` are checked
  - exact redirect URIs
  - the post-login return path must be relative (no open redirects)
  - back-channel logout tokens are signature- and audience-checked
- The app session cookie is unchanged (`httpOnly`, `SameSite=Strict`). The login state cookie is short-lived, signed and `httpOnly`.
- **Procedure mode risk (accepted):** anyone at the workstation acts as the user. Mitigated by:
  - a fresh password at start
  - the per-activation acknowledgment
  - the banner
  - the 24 h cap
  - audit events
  - a site switch to disable it
- **Privacy:**
  - Keycloak login events include IP address and client. They are kept 30 days for security investigation, and this should be stated in the privacy notice.
  - Our app no longer records logins, so there is one store, not two.
  - Admin events omit user representations.
  - Registration free-text (affiliation, intended use) is removed 30 days after a decision.
  - The app stores only the encrypted ID token, deleted with the session.
  - The theme cookie identifies no one.
- PHI handling is unchanged.

## Rollout

1. **Keycloak infrastructure** — *done 2026-11-05 (no user-visible change):*
   - served at `/sso/` behind nginx: nginx strips the prefix, and `KC_HOSTNAME` is the public `/sso` URL, so the backend still uses `http://keycloak:8080`
   - production mode via `KEYCLOAK_START_COMMAND=start`
   - admin console and master realm blocked from outside (404), still on the localhost port
   - nginx rate limit on registration/reset endpoints
   - realm as code: events (30 days), SSO 30 min / 12 h, SMTP from `SMTP_*`
   - client: standard flow + PKCE `S256`, exact redirect and post-logout URIs, back-channel logout URL
   - registration, email verification and reset stay off until phases 3–5
   - `setup-keycloak.mjs --settings-only` applies settings without rotating the secret
   - Keycloak healthcheck fixed
2. **Backend redirect login, logout and back-channel logout**, behind a switch (`AUTH_LOGIN_MODE=redirect|password`) so both work during testing. *Done 2026-11-05; default stays `password`, so no user-visible change.*
   - Endpoints:
     - `GET /api/auth/login/start?returnTo=`
     - `GET /api/auth/callback`
     - `POST /api/auth/backchannel-logout`
     - `POST /api/auth/logout`, which now returns `logoutUrl` for redirect-login sessions
   - The session row stores the Keycloak `sid` and the encrypted ID token (migration `033`).
   - Token checks use `jose` 6.2.13 (MIT). Discovery is fetched internally, which gives public browser endpoints and internal back-channel endpoints.
   - The login form shows a Keycloak sign-in button when `AUTH_LOGIN_MODE=redirect`.
   - **Keycloak behaviour found in testing:**
     - The admin action "log out user" (all sessions) sends a back-channel call for only one of the user's sessions. It also stamps `notBefore` on the account.
     - So: the account check ends any app session issued at or before `notBefore`, and any back-channel call clears that user's cached account state.
     - Result: every session ends on its next request. Ending sessions one by one (admin, or a hospital sign-out) notifies each session directly.
   - Verified end to end against local Keycloak:
     - password login unchanged
     - redirect login, sign-out with Keycloak end-session URL
     - back-channel logout, for single sessions and "log out user"
     - open-redirect guard
   - **Note for phase 6:** the app doesn't contact Keycloak after sign-in, so the Keycloak session idles out 30 minutes after sign-in, not after last use. A "session ended" popup will usually ask for the password. That is the secure default; keeping the Keycloak session alive would need refresh tokens.
3. **Approval gate:** create the `app-user` role and grant it to all existing users (one-off migration). Gate the API on it. *Done 2026-11-06, no change for existing users:*
   - `authenticateToken` lets an unapproved account call only `/api/auth/me`, logout, and its theme preference. Everything else returns 403 `ACCESS_PENDING`.
   - The backend does the one-off grant itself on startup (`services/appUserGate.js`) and records it in a realm attribute. The gate stays open until that is confirmed, so deploy order can't lock anyone out. Locally: 4 accounts granted.
   - Case invites, approved registration completions and the bootstrap admin get `app-user`. `setup-keycloak.mjs` keeps app roles out of the realm's default roles.
   - A pending account's first `/api/auth/me` creates a review item (`registration-requests.keycloak_sub`) and notifies reviewers. Approving grants `app-user` (plus `app-org-admin` if chosen by an org admin) and emails a sign-in link. Rejecting deletes the Keycloak account.
   - The SPA shows "Access pending approval" with "Check again" and "Sign out".
   - Verified end to end: an account with no role is held at the pending screen, its API calls are blocked, and the review item is created; approved accounts are unaffected.
4. **Theme:** pages and emails. *Sign-in page done 2026-11-06 (emails move with phase 5):*
   - **Files:** `keycloak/themes/slicerhub/login`, mounted into Keycloak and selected by `setup-keycloak.mjs`. It extends Keycloak's `keycloak.v2` theme with CSS, one script and message overrides only. No templates are copied, so Keycloak upgrades keep working.
   - **Look:** mirrors the app's login card and colours. Realm display name "SlicerHub"; wording "Sign in" and "Email", matching the app.
   - **Light/dark:** follows the theme of the last account signed in on this device (`sh-account-theme` in localStorage, same origin), otherwise the system setting.
   - **WCAG 2.1 AA:** checked with axe-core in Edge. 0 violations for the sign-in page and the error state, in light, dark, and system-dark with no account. No sideways scroll at 320 px, and keyboard focus is visible.
     - Dark mode uses adjusted link, input-border and button-edge colours: the app's own dark values fail AA (2.2:1 / 1.6:1 / 1.6:1).
     - `<html lang="en">` via realm internationalization, English only.
   - **No web-font request** from the sign-in page: Inter is used only if installed.
   - **nginx:** a bare `/sso/` now redirects to the app instead of Keycloak's admin console address.
5. **Registration, reset and invites moved to Keycloak.** Requests still pending in the old flow are finished before cutover, or recreated as pending accounts. *Done 2026-11-06. In redirect mode the Keycloak flows take over; password mode (today's default) keeps the app's own flows until cutover.*
   - **Realm:**
     - Registration on, with email as the username; email verification and Keycloak's password reset on.
     - Two optional sign-up fields, `affiliation` and `intendedUse`.
     - Email theme `slicerhub`.
     - The client's base URL gives a "Back to SlicerHub" link.
     - SMTP: from `SMTP_*`; outside production with none set, Keycloak uses the local Mailpit (`localhost:8025`).
     - `setup-keycloak.mjs` warns about enabled accounts with an unverified email, since verification now also applies to the password form; none locally.
   - **Self-registration:** Keycloak sign-up page, then email verification, then sign-in, then "Access pending approval".
     - The review item copies the affiliation and intended use, and the person gets the "request received" email (now worded neutrally).
     - On approval those two fields are removed from the Keycloak account; the review record keeps them for 30 days.
   - **Password reset:** Keycloak's "Forgot your password?" page and email. The app's sign-in screen drops its own reset and register links in redirect mode.
   - **Case invites to a new email:**
     - The account is created enabled, with the `VERIFY_EMAIL` and `UPDATE_PASSWORD` required actions, so it can't sign in until setup is done. It gets `app-user` and the case role.
     - Keycloak sends "Set up your SlicerHub account"; no link is ever returned to the inviter.
     - The invite becomes accepted at the person's first sign-in.
     - Approving an invite for someone who has since set up an account adds them directly, with no forced password reset.
   - **Emails:** verify, reset and account setup reworded in SlicerHub's voice, with a plain layout and `lang="en"`. Keycloak's email can't name the case.
   - **Wording on Keycloak's pages:** "Request access", "Forgot your password?", "Back to sign in".
   - **Verified end to end with Mailpit:**
     - register, verify from the real email, and land on pending with the fields copied
     - reset by email, then sign in
     - account-setup email received; an invitee can't sign in before setup
   - **Accessibility:** WCAG 2.1 AA, 0 axe violations on the registration and reset pages, light and dark.
6. **Sessions:**
   - real-activity idle tracking
   - the 12 h absolute limit
   - popup re-sign-in
   - failed-save visibility
   - procedure mode

   *Done 2026-11-06 (applies in both login modes):*
   - **Idle:** the server no longer slides the idle window on every request. Only `POST /api/auth/activity` does, sent by the page at most once a minute while someone is actually using it.
     - It counts keys, pointer, wheel and touch, in the page and in same-origin viewer frames (Slicer Web, Full Slicer's noVNC, Trame), including frames inside component shadow DOM.
     - The old client timer only saw the main page, so it signed people out while they worked in a viewer.
     - At 30 minutes the page is hidden behind the sign-in dialog, with an opaque backdrop, and the server session is ended.
   - **12 h limit:** `SESSION_MAX_HOURS` (token lifetime and an `iat` check, which also ends pre-existing 7-day tokens). A re-issued session (profile update) keeps its original sign-in time.
   - **Re-sign-in without losing work:** a `fetch` wrapper (`dev/services/authFetch.js`) and the TUS uploader turn any 401 into the "Your session ended" dialog (`session-reauth-dialog`), then retry the request once. Signing in as a different account reloads the page.
     - Password mode: a password field.
     - Redirect mode: Keycloak in a popup (`/api/auth/login/start?popup=1`, answered by a small page that `postMessage`s the opener and closes).
   - **Failed saves:** the scene is marked unsaved again, the error is announced (`role="alert"`) with a "Try saving again" button, and there's a toast if the viewer was closed.
   - **Procedure mode:**
     - "Start procedure mode" in the user menu opens a dialog with a length (default 8 h) or "until I end it", the acknowledgment every time, and the password: the form in password mode, Keycloak with `prompt=login&max_age=0` in redirect mode.
     - Session row: `procedure_until`, `procedure_open_ended` (migration `034`).
     - A persistent banner shows the end time and an "End procedure mode" button.
     - When the time runs out the session is deleted and the page signs out, with a message on the login screen.
     - Settings: `PROCEDURE_MODE_ENABLED`, `PROCEDURE_MODE_DEFAULT_HOURS`, `PROCEDURE_MODE_MAX_HOURS` (24 h hard cap).
   - **Also fixed:**
     - `/api/auth/me` returned `email: null`, which broke password re-sign-in; it now comes from Keycloak.
     - `dev/index.html` was missing `lang` and was titled "My Application".
   - **Verified:**
     - unit tests: idle, 12 h, procedure on/expired, cap, acknowledgment
     - API end to end: procedure start/end, wrong password = 403, popup flows, forced password at Keycloak
     - real browser (5 of 5 runs): a 401 shows the dialog, the original request completes after signing in, and procedure mode works from the menu and banner
     - WCAG 2.1 AA, 0 axe violations on both dialogs and the banner
7. **Cutover:** redirect becomes the only mode, and the password grant is turned off in Keycloak. Remove the code listed above, plus the now-unused Payload collections and fields.

   *Done 2026-11-06. Users see only the new sign-in screen (and a popup for password change):*
   - **Password grant off:** `setup-keycloak.mjs` sets `directAccessGrantsEnabled: false` on every run, so `--settings-only` also turns it off on existing realms. `AUTH_LOGIN_MODE` is gone. The backend's admin calls still use `admin-cli` in the `master` realm, which is a different client.
   - **Sign-in screen:** a signed-out visit goes straight to Keycloak and comes back to the page asked for.
     - The SlicerHub card shows only when there's something to say first: a failed sign-in, Keycloak unreachable, or procedure mode that ran out.
     - "Procedure mode ended" is carried in `sessionStorage`, because Keycloak's sign-out always returns to `/`.
     - The shell waits for the first `/api/auth/me` before showing the card, and shows "Signing out..." while heading to Keycloak's sign-out.
   - **Sign-out always ends the Keycloak sign-in.** Without the ID token (the app session had already ended), the logout URL omits `id_token_hint`, so Keycloak asks "Sign out?". Otherwise the next sign-in on a shared workstation would be silent.
   - **What replaced the password-grant uses:**
     - *Procedure mode:* the Keycloak popup with `prompt=login&max_age=0`, as in phase 6. Two new checks: the ID token's `auth_time` must come from this sign-in (`login_not_fresh`), and the account must be the session's own (`login_wrong_account`). `/api/auth/login/start` requires a live session for it.
     - *Change password (Settings):* Keycloak's update-password step in a popup (`?action=password` → `kc_action=UPDATE_PASSWORD`).
       - Keycloak asks for the current password if the sign-in is over 5 minutes old, and applies the realm password policy.
       - Only `kc_action_status=success` counts. The session is re-issued, carrying procedure mode.
       - `auth/changePassword.js` and the in-app form are gone. Keycloak's required action also replaces the old "must change password" screen.
     - *Re-sign-in dialog:* the popup only (`dev/services/keycloakPopup.js`, shared with the two above).
     - *Test scripts:* `tests/lib/signIn.mjs` signs in through Keycloak's page with `fetch`, for `tests/functional` and `tests/full-slicer`. The full-slicer harness still calls the long-gone `/api/auth/register`.
   - **Invites:** always Keycloak account setup. When an invite expires or is rejected, an account that was never set up (`UPDATE_PASSWORD` pending, no password) is deleted, unless another signup invite still waits on it. The people dialog no longer offers a copy-link box, and it says so when the setup email couldn't be sent.
   - **Registration:** reviewers approve accounts only. A leftover old-flow request (no account) can only be rejected; signing up on Keycloak's page attaches it to the new account. The retention sweep deletes old-flow `approved` records after 30 days.
   - **Sign-ins in two tabs:** each sign-in in progress has its own cookie (`sh_oidc_tx_<part of state>`, at most 5, 10 minutes each). With one shared cookie, the verify-email link (which opens a new tab) failed with "Sign-in couldn't be verified" whenever another tab had started a sign-in meanwhile. The automatic redirect to Keycloak made that common. Verified with a real sign-up and the Mailpit link.
   - **Old emailed links** (`?register=`, `?reset=`, `?invite=`, `?kc-invite=`) are dropped from the address and land on sign-in.
   - **Payload schema:** removed the `password-reset-tokens` collection, `case-invites.token_hash` and `registration-requests.completion_token_*`.
     - Payload's dev push exits at startup when it would drop data and nobody can answer its prompt.
     - So `setup-payload.mjs` (run by `bootstrap.mjs` before the backend starts) drops them first (`RETIRED_SCHEMA`, idempotent).
   - **Moving the demo site off Directus:** one script, `scripts/migrate-from-directus.mjs`, run on a fresh stack after `bootstrap.mjs`.
     - Accounts are created enabled, with no password and `UPDATE_PASSWORD` pending. The script grants `app-user` itself, so the order of backend start-up doesn't matter.
     - Pending signup invites become Keycloak account setup.
     - `--send-setup-emails` has Keycloak email everyone a setup link. Without it, people use "Forgot your password?".
     - Passwords can't be copied, because Directus doesn't expose them.
     - Registration requests still waiting for review are not migrated.
     - The realm default is fixed to `slicer-web`; it was `slicer`.
   - **Also removed:** `/api/auth/refresh` (no caller; read the SQLite `User` table), the app's login audit events, `PASSWORD_MIN_LENGTH` and the `AUTH_LOGIN_*` lockout settings. Keycloak's password policy and brute-force detection apply instead.
   - **Verified:**
     - 396 unit tests, all passing.
     - API end to end (26 checks): the password grant is refused by Keycloak; old endpoints are 404. For procedure mode, a different account is refused and the right one works. Password change: success, cancel, old password refused, new one accepted, procedure mode kept. Sign-out URL with and without the ID token. The script sign-in helper.
     - Never-set-up account deletion against real Keycloak.
     - Real browser (headless Edge, 19 checks, 2 runs): straight to Keycloak and back to the page asked for; no sign-in flash when already signed in; re-sign-in popup retries the request; Settings password popup; sign-out reaches Keycloak's sign-in page; error card; old link parameters dropped; procedure-ended message; no script errors.
     - axe WCAG 2.1 AA: 0 violations on the sign-in card, light and dark.
   - **Known, not changed:** `dev/index.html` has no viewport meta tag, so phones get the 980 px desktop layout. That predates this work, and adding it would change the whole app on phones.
8. **SSO readiness:** the on-site guide. MFA requirement before production.

   *Deferred 2026-11-06. Nothing here blocks other work:*
   - **On-site guide:** write it with the first hospital that asks for SSO, against their real setup (SAML or OpenID Connect, which account fields they send, approval or automatic access). Adding a hospital is Keycloak configuration only; the app side (approval gate, account linking, back-channel logout) is already done.
   - **MFA:** not tied to SSO. Require OTP at least for admins before the demo site holds real people's accounts on the internet: a Keycloak setting, kept in `setup-keycloak.mjs`.

Existing users: no account migration, apart from granting `app-user`. App sessions remain valid through the deploy. The new 12 h limit applies from each user's next sign-in.

Testing:

- **Unit tests:**
  - the callback rejects bad `state`/`nonce`/PKCE and off-site return paths
  - back-channel logout verification
  - the idle timer ignores background requests
  - the 12 h limit
  - procedure mode start/end/expiry and the 24 h clamp
  - the approval gate
  - the 401 handler retries once
  - phase 7: fresh `auth_time` for procedure mode, same account for procedure mode and password change, `kc_action_status`
  - phase 7: invite expiry removes accounts never set up
- **Manual:**
  - sign in and out in light and dark themes, at phone width
  - register → verify → pending → approve
  - reset password
  - invite a new email → set password → case visible
  - popup re-sign-in during a save
  - procedure mode with a 1-minute test configuration
  - admin console blocked from outside
  - ending a Keycloak session from the admin console signs the app out
  - phase 7: change password from Settings
  - phase 7: demo-site migration with `migrate-from-directus.mjs`

## SQLite retirement (next)

The SQLite database (`backend/data/users.db`) is to be deleted soon after this migration. Nothing new should go into it. This is what still depends on it (2026-11-06):

| What | Where | What to do |
|---|---|---|
| **App sessions**, including `kc_sid`, `id_token_enc`, `procedure_until`, `procedure_open_ended` (added by this work, migrations 032–034) | `middleware/authMiddleware.js`, `auth/session.js` | Move to Postgres (a Payload collection, or a plain table the backend owns). Sessions are read on every request, so keep the lookup by `token_jti` indexed. |
| **Auth audit log** (event, user id, time; 30-day retention) | `auth/auditLog.js` | Since phase 7 it records only app events (procedure mode start/end, sign-out, password change); sign-ins are Keycloak's (decision 6). Move with sessions, or drop. |
| **Notifications** | `services/notifications.js`, `routes/notifications.js` | **Moved to Payload `user-notifications` (2026-11-06).** The SQLite table only took integer user ids (FK to `users`), so every notification for Keycloak accounts was silently dropped. Retention: read ones 30 days, all 90 days. The old `user_notifications` table is unused and goes with the database. |
| **Identity links / provider tokens** | `auth/identityStore.js` | **Link lookups removed (2026-11-06):** every route now uses the session's Keycloak sub; `getKeycloakSubForUser` is gone. Still left in `identityStore.js`: `clearProviderTokens*` (session-scoped tokens; moves with sessions) and the old Directus helpers used by `requireGroupCapability.js`. |
| **Local `users` table** | `models/User.js`; used in `routes/auth.js` (`/refresh`, `/profile`, the preferences fallback) and `routes/users.js` | Replace with Keycloak profile + Payload `user-preferences`, which already hold this data. |
| **My Files / My Projects** (files, projects, share links, project GPU) | `models/File.js`, `Project.js`, `ProjectGpu.js`, `ShareLink.js`, `routes/files.js`, `routes/projects.js`, `gpu/repairCredentials.js` | Remove with those deprecated features (or move them, if they're kept). |

Order that avoids breakage: the identity-link lookups are done; next, after Phase 7, move sessions and the audit log, then delete `User` and the My Files/My Projects code, then `db/database.js`.
