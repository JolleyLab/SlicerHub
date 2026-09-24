# SlicerWeb viewer, resumable uploads and attachment downloads

## SlicerWeb (in-browser viewer)

"Open with… → SlicerWeb" on a case attachment runs 3D Slicer compiled to WebAssembly in the browser
([lassoan/SlicerWeb](https://github.com/lassoan/SlicerWeb)). No server session, GPU seat or heartbeat is used.

- **Build output is not in this repo.** `slicerweb/VERSION` pins a commit of the prebuilt site
  ([lassoan/slicerweb-app](https://github.com/lassoan/slicerweb-app), which keeps a single commit, so the pin can
  disappear when upstream republishes). `scripts/fetch-slicerweb.sh` / `.ps1` download that commit into
  `data/slicerweb/` (git-ignored, about 640 MB). To upgrade, put a new SHA in `slicerweb/VERSION` and re-run the script.
- **Serving.** nginx serves `data/slicerweb/` at `/slicerweb/` from the same origin as the app, which is what lets
  the cases page reach the frame's `slicerWeb` bridge. The `.mjs` MIME type is declared in `nginx/default.conf`
  (the stock `mime.types` lacks it, and browsers refuse ES modules served as octet-stream).
- **Loading a file.** The page fetches the attachment from `GET /api/directus/cases/:caseId/attachments/:id/content`,
  waits for the bridge, then calls `writeFiles` + `loadFiles`.
- **First start** downloads the runtime and is slow; SlicerWeb's service worker caches it afterwards.
  A bad response cached by that worker (e.g. a wrong MIME type) survives a normal reload: clear site data.

## Attachment bytes: two routes with different rules

| Route | Who | Purpose |
|---|---|---|
| `GET …/attachments/:id/content` | any case member | bytes for in-browser viewers; inline, `no-store` |
| `GET …/attachments/:id/download` | case admins and collaborators only | save to the user's device |

Both stream from the on-disk asset cache (`ensureDirectusAssetCached`); concurrent requests for the same uncached
file share one download. Read-only members can view a file in a viewer but cannot use the download route.
This is not DRM: a file loaded into SlicerWeb is in the browser's memory by definition.

## Uploads

Files are uploaded to Directus with the resumable **TUS** protocol, in 8 MB chunks, so large files show real
progress, survive dropped connections and stay under proxy body limits (Cloudflare, nginx).

1. **Bytes.** `dev/services/tusUpload.js` (small in-house client; the reference client needs a bundler) talks to
   `/api/directus/files/tus`, which `backend/src/services/tusProxy.js` streams to Directus `/files/tus` with the
   caller's own token added server-side. Nothing is buffered whole; nginx does not spool the body.
2. **Linking.** Directus does not say which file record an upload became, and forgets the upload when it completes.
   So the **server** issues each upload a token (`POST /api/directus/uploads/token`,
   `backend/src/services/uploadTokens.js`) and returns the metadata to send with the upload; that metadata tags
   the file with a marker in its `description`. The client treats both as opaque, so the marker format lives in one
   file, on the server. `POST …/attachments/from-upload` verifies the token, finds the file by its marker
   (`backend/src/services/attachUploadedFile.js`), creates the attachment as the user, then clears the marker.
   The token is a signed JWT bound to the user who started the upload, valid for 24 hours, and signed with a key
   derived for this purpose so it can never pass as a session or share-link token.
3. **Background.** `dev/services/uploadManager.js` owns uploads outside any page (one at a time, cancel/retry,
   rate and time remaining); `<upload-tray>` shows them on every page and asks for a name while the file uploads.
   A page refresh loses in-flight uploads (the tab-close prompt warns about it).

**Directus requirements:** TUS enabled on the server, and the users' role able to create, read and update
`directus_files` including the `description` field (the marker is written, searched and cleared as the user).
An upload whose link step never happens keeps its marker in `description` until someone deletes the file.

**Known limits:** a failed link step leaves an unattached file in Directus (delete it in the File Library);
`from-upload` does not itself check the caller's role on the case (the UI hides Add file for read-only members).

## Accessibility (WCAG 2.0 AA, desktop)

The upload tray and its details dialog, the case attachment area, the "Open with" menu and the viewer overlay
were checked with axe-core (WCAG 2.0 A/AA rules, light and dark themes), hand-measured contrast, real keyboard
navigation and 200% zoom. Decisions worth keeping when this code changes:

- **No timers on messages.** Finished uploads stay in the tray until dismissed (`Clear finished` removes them);
  an item that disappears by itself is a time limit for slow readers (2.2.1).
- **Screen readers** hear finished / failed / needs-details uploads through one polite live region in the tray;
  progress ticks are deliberately silent. Each row's buttons name their file ("Cancel upload of scan.nrrd").
- **Keyboard.** Drag-and-drop always has the Add file button as its keyboard equivalent. The "Open with" menu
  moves focus into itself, supports arrows/Home/End/Escape, and Tab leaves it. The viewer overlay is a modal
  dialog: focus moves into it, the page behind is `inert`, and focus returns to the opener when it closes.
- **Colours** come from theme tokens (`--color-text-primary`, `--color-focus`, `--color-status-error-fg`);
  the theme's primary colour is too dark to use as text in dark mode.
- Not covered: mobile layouts, real screen-reader testing, and the imported SlicerWeb application itself.

## My Projects and the password bridge

- My Projects is hidden behind `MY_PROJECTS_VISIBLE` in `dev/components/app-views.js` (code kept for now).
- The SQLite→Directus password bridge (`AUTH_PASSWORD_BRIDGE`) has been removed; sign-in checks Directus only.

## Tests

Unit tests for the backend and the frontend live in the top-level `tests/unit/` (not next to the code):
`cd tests && npm test` (built-in `node --test`, Node 22+ for the glob). `tests/full-slicer/` is a separate
load-test harness.
