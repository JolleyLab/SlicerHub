# Cleanup follow-ups

Open items from the November 2026 cleanup pass and license check. Done items are not listed here; see git history.

## Licenses (checked 2026-11-08)

All direct npm dependencies of `backend`, `dev` and `payload-admin` are MIT, ISC, BSD or Apache-2.0. Items to know about:

| What | License | Notes |
|---|---|---|
| `sharp` prebuilt binaries (libvips), in `backend` and via Next.js in `payload-admin` | LGPL-3.0-or-later (dynamically linked) | Fine for an open-source project. In `backend` the package is unused, so removing it also removes the LGPL binaries (see below). |
| `libheif-js` (via `heic-convert`, HEIC avatar upload) | LGPL-3.0 | Used as a library, unmodified: fine. Keep its license notice if the backend is redistributed as an image. |
| `axe-core`, `lightningcss` (frontend dev tools only) | MPL-2.0 | File-level copyleft, not shipped. Fine. |
| Old frontend dev-tool packages with no `license` field (`hamljs`, `trim`, `only`, …) | MIT (README/LICENSE) | Pulled in by the unused starter-kit tooling below; they go away with it. |
| `nvidia/cuda:*-cudnn8-devel` (Full Slicer GPU base image) | NVIDIA CUDA/cuDNN EULA (proprietary, redistributable under its terms) | Fine to build from. Before publishing the images, check the EULA's redistribution terms; the smaller `-runtime` image is probably enough. |
| TurboVNC (in the GPU image) | GPL-2.0 | Runs as a separate program (not linked), so it doesn't affect the project's license. |
| Infisical and its Redis 7.4 (RSALv2/SSPLv1) | — | Removed in November 2026 (see secrets-management.md). |
| Keycloak, nginx, Postgres, Mailpit, cloudflared, noVNC, Payload, 3D Slicer | Apache-2.0 / BSD / PostgreSQL / MIT / MPL-2.0 / Slicer (BSD-style) | Fine. |

## Dependencies to remove

- **Frontend (`dev/package.json`):** 25 of the 28 entries are unused leftovers from the Lit starter kit. The `lint`, `docs`, `format`, `checksize` and Karma scripts point at files that don't exist (`my-element.js`, `karma.conf.cjs`, `.eleventy.cjs`). Only `lit-element`, `lit-html`, `sortablejs`, `es-dev-server` (`npm run serve`) and `license-checker` are used. Removing the rest cuts about 1,300 installed packages. Run `npm uninstall`, then recreate the frontend container's `node_modules` volume.
- **`es-dev-server` is deprecated.** Its successor is `@web/dev-server` (MIT, same team). Swap when convenient.
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
