# Cleanup follow-ups

Open items from the November 2026 cleanup pass and license check. Done items are not listed here; see git history.

## Licenses (checked 2026-11-08)

All direct npm dependencies of `backend`, `dev` and `payload-admin` are MIT, ISC, BSD or Apache-2.0. Items to know about:

| What | License | Notes |
|---|---|---|
| `sharp` prebuilt binaries (libvips), in `backend` and via Next.js in `payload-admin` | LGPL-3.0-or-later (dynamically linked) | Fine for an open-source project. In `backend` the package is unused, so removing it also removes the LGPL binaries (see below). |
| `libheif-js` (via `heic-convert`, HEIC avatar upload) | LGPL-3.0 | Used as a library, unmodified: fine. Keep its license notice if the backend is redistributed as an image. |
| `nvidia/cuda:*-cudnn8-devel` (Full Slicer GPU base image) | NVIDIA CUDA/cuDNN EULA (proprietary, redistributable under its terms) | Fine to build from. Before publishing the images, check the EULA's redistribution terms; the smaller `-runtime` image is probably enough. |
| TurboVNC (in the GPU image) | GPL-2.0 | Runs as a separate program (not linked), so it doesn't affect the project's license. |
| Infisical and its Redis 7.4 (RSALv2/SSPLv1) | — | Removed in November 2026 (see secrets-management.md). |
| Keycloak, nginx, Postgres, Mailpit, cloudflared, noVNC, Payload, 3D Slicer | Apache-2.0 / BSD / PostgreSQL / MIT / MPL-2.0 / Slicer (BSD-style) | Fine. |

## Dependencies to remove

- **`es-dev-server` is deprecated.** Its successor is `@web/dev-server` (MIT, same team). Swap when convenient. It also pulls in `intersection-observer` (W3C-20150513, a permissive license), which `npm run licenses:check` in `dev/` rejects; add it to the allow-list or drop it with the swap.
- **Backend:** `sharp` and `pg` aren't imported (Payload's Postgres adapter brings its own `pg`). `bcrypt` and `sql.js` go with the SQLite retirement.

## Code

- **`AUTH_TOKEN_KEY`:** bootstrap now generates one, and the backend warns when it's unset. Consider also requiring it in production (startup error).
- **Unused frontend messages:** about 47 keys in `dev/i18n/locales/en.js` (sections home, settings, files, groups, projects, common, cases) have no literal `t('…')` caller. Some may be shown by key from server error codes, so check each before deleting.
- **`dev/index.html` has no viewport meta tag:** phones get the 980 px desktop layout.
- **`tests/full-slicer/*`** still calls the long-removed `/api/auth/register`.
- **`httpRequest`** is copied in `routes/containers.js`, `routes/files.js` and `sessions/providers/trame.js`. Two of those go with the My Files / My Projects removal (SQLite retirement); then move the third into a util if a second user appears.
- **Old docs:** `AUTH_SETUP_GUIDE.md` and the nested `slicer-web/` folder describe the old SQLite login.
- **`.env`:** `DIRECTUS_TOKEN` is still set locally and nothing reads it any more.

## Site announcement banner

Done (not a follow-up): edit it in Payload admin → Globals → Site announcement. It has an on/off switch, the message, a severity, and optional "show from" and "hide after" times for planned maintenance. Signed-in users see it within a minute and can dismiss it for their browser session.

Possible later additions, if wanted:
- show it on the sign-in page too (Keycloak theme), for people who aren't signed in;
- a read-only mode during maintenance.
