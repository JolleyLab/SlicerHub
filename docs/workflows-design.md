# Workflows (design)

**Status:** first pass built (SlicerWeb, extensions only).
**Related:** [slicer-gui-addons.md](./slicer-gui-addons.md) (Full Slicer extensions), [keycloak-case-groups.md](./keycloak-case-groups.md) (case roles).

A **workflow** is a named, pre-defined viewer setup that people can create, share and launch.
Today every SlicerWeb launch hardcodes `extensions=SlicerHeart`. Workflows replace that hardcoded value.

## Scope

| | First pass | Later |
|---|---|---|
| Viewer | SlicerWeb; Full Slicer for workflows whose extensions are all in its add-ons manifest | Full Slicer loading only a workflow's own extensions, with seat reuse keyed on workflow (see the end of this doc) |
| Contents | Extensions, then a startup configuration ("Start in" module; see [Startup configuration](#startup-configuration)) | More startup keys (layout, placeholders such as the input file), favourite modules, sample data or template scene |
| Discovery | An "All workflows" tab on the Workflows page; the case's Workflows panel to request or add | Authors, ratings, sorting by use |

## Decisions

- **Anyone can create a workflow.** Its visibility is `private` (just me) or `public`.
- **Only a case admin can approve a workflow for their case.** They can approve their own workflows or any public one.
- **Launching in a case:** a member can open a file with any workflow approved for the case, or one of their own (private or public). A case admin can turn off members' own workflows for a case.
- **Members above `read_only` can request a public workflow for a case;** the case admin approves or declines. Letting admins choose which roles may request is part of a possible later move of case permissions into Case Settings; not needed now.
- **A viewer and a workflow are different things.** The viewer is where it runs (SlicerWeb or Full Slicer); a workflow is installed on top, if that viewer can run it. The person's own viewer choice is respected.
- **Each case can have one default workflow,** used unless someone picks something else for a file. There are no per-file-type defaults.
- **SlicerHeart is an ordinary workflow,** and so is Simplified Viewer: two pre-seeded public workflows, "SlicerHeart" and "SlicerHeart – Simplified" (SlicerHeart, starting in its SimplifiedViewer module). Neither is special in code, and admins approve each separately. Plain SlicerWeb opens with no extensions.
- **Existing cases** get both seeded workflows approved, with SlicerHeart as the default, so nothing changes for them. **New cases** start with no workflows; admins add what they want. People whose account viewer setting was Simplified Viewer become Full Slicer users and pick "SlicerHeart – Simplified" from the menu.
- **Approval takes a copy.** The case keeps a copy of the extension list as it was when approved. If the owner later edits, unpublishes or deletes the workflow, the case keeps working with the approved copy. The case page shows "Update available" when the source was edited after the approval; the admin re-approves to take the change.
- **Workflows are data, not code.** SlicerWeb only loads extensions listed in the deployed `extensions/index.json` and ignores unknown names. A workflow can therefore only name extensions we already ship, so it can't add new code to SlicerWeb.

## SlicerWeb launch parameters

SlicerWeb (the build in `data/slicerweb-*`) already reads these query parameters, so no SlicerWeb change is needed:

| Parameter | Used in pass |
|---|---|
| `extensions` | 1 |
| `layout` | later |
| `favoriteModules` | later |
| `sample` | later |

The extension catalog is the static file `/slicerweb/{channel}/extensions/index.json` (name, description, icon, category). The editor reads it directly; no backend route is needed.

**Limitation:** SlicerWeb saves extensions in the browser's `localStorage` under `slicerweb.extensions`, as a list of wheel URLs: both those installed by hand in its Extensions Manager and (found in testing, Nov 2026) those asked for with `?extensions=`. It loads that list on every later start. That storage belongs to the browser profile and site origin, not to a SlicerHub account or a session, and the stable and latest channels share it. Left alone, one SlicerHeart launch would make every later "No workflow" launch in that browser include SlicerHeart.

So **every case launch clears the list first** (`resetSlicerWebExtensions()` in `dev/utils/slicerWebStorage.js`, called from `_slicerWebUrl()`): a launch loads exactly its workflow's extensions. Extensions installed by hand work for that session only, and are gone on the next launch.

**Security note:** the Extensions Manager can install a wheel from **any URL**, and `slicerweb.extensionIndex` can point at a different extension index. Workflows can't do this, but users can, by hand. The wheel's code runs on the SlicerHub origin. Because SlicerHub authenticates with cookies, that code's requests to `/api` carry the signed-in user's session. On a shared browser, a wheel one person installs therefore runs as whoever signs in next. Mitigations, cheapest first:

1. **Done.** `dev/utils/slicerWebStorage.js` clears `slicerweb.*` keys and SlicerWeb's autosave databases (IndexedDB names under `/home/pyodide/`, which hold scene data) on sign-out, and when a different user signs in on the same browser.
2. **Done for case launches:** extensions installed by hand don't carry over to the next launch (see the limitation above). Still open: ask SlicerWeb upstream for a build flag that turns off install-from-URL and custom indexes.
3. Add a `connect-src` CSP on `/slicerweb/` limiting where wheels can be fetched from.

## Data model (Payload)

Both are new collections. Dev push creates them; nothing goes in `RETIRED_SCHEMA`.

**`workflows`**

| Field | Type | Notes |
|---|---|---|
| `name` | text, required | |
| `description` | textarea | |
| `owner_id` | text, indexed | Keycloak sub |
| `visibility` | select `private` / `public` | default `private` |
| `target` | select `slicerweb` | the only value for now; the field exists so Full Slicer can be added later without a schema change |
| `extensions` | json (string[]) | |
| `file_types` | json (string[]) | data file extensions it is for, stored lowercase without the dot (`mrb`, `nii.gz`); empty means any. Not used yet: it is for choosing which workflows to offer for a file once workflows come back to cases. |
| `icon_key` | text | storage key of an uploaded icon (`workflowIcons/<id>.<ext>`), or empty |

**`case-workflows`** (one row per approval)

| Field | Type | Notes |
|---|---|---|
| `case` | relationship → cases, indexed | |
| `workflow` | text | source workflow ID; may later point to a deleted workflow |
| `name` | text | copied at approval |
| `extensions` | json (string[]) | copied at approval |
| `approved_by` | text | Keycloak sub |
| `approved_at` | date | when it was approved |

A default workflow per case can be added later as an `is_default` field; it isn't needed for the first pass.

## API

Workflows are in `backend/src/routes/workflows.js`; workflows on a case (`/api/cases/:id/workflows`) are in `backend/src/routes/caseWorkflows.js`, next to the other case routes. What both use (collection names, list queries, the workflow's API shape) is in `backend/src/services/workflows.js`.

| Route | Who |
|---|---|
| `GET /api/workflows` | The signed-in user's own workflows; `?scope=public` lists everyone's public ones |
| `GET /api/workflows/:id` | The owner, or anyone if the workflow is public |
| `POST /api/workflows`, `PATCH /api/workflows/:id`, `DELETE /api/workflows/:id` | The owner |
| `GET /api/cases/:id/workflows` | Case members (read_only and up). Returns `{ approved, mine, canManage }`, plus `available` for admins (their own and public workflows not yet approved), so the case page needs one request. |
| `POST /api/cases/:id/workflows` with `{ workflowId }` | Case admin. The source must be public or owned by the admin. Approving the same workflow again refreshes the copy. |
| `DELETE /api/cases/:id/workflows/:approvalId` | Case admin |

Icons: `PUT` / `DELETE /api/workflows/:id/icon` (owner; multipart field `icon`) and `GET` (anyone who can see the workflow). Uploads are checked by their contents (PNG, JPEG, GIF or WebP, up to 256 KB; never SVG, since other people see public workflows), and responses carry a versioned `iconUrl`. Responses never include `owner_id`. Input validation: `extensions` is an array of at most 50 strings matching `/^[\w.-]{1,100}$/`, with duplicates removed.

## Launch

Each openable file, and the blank viewer, has an Open ▾ menu (`<open-with-menu>`, `dev/components/open-with-menu.js`); see [Workflows in cases](#workflows-in-cases). What it lists, which workflow the main button opens and the per-file choice (stored under `slicerweb.hub.openPicks`, so sign-out clears it with SlicerWeb's own state) are in `dev/utils/openWith.js`. `cases-page.js` loads the case's workflows once per case, hands them to the menus and to Case Settings (`dev/components/case-settings.js`), and reloads them after a change. `openWithWorkflow()` sends a choice to SlicerWeb (through `_slicerWebUrl()` and `buildSlicerWebUrl`) or to Full Slicer. Parts of this change in the next pass; see [Build status](#build-status).

The **Workflows** page in the sidebar (`dev/pages/workflows-page.js`) is laid out like My Cases. It has two tabs of cards with search and sort: "My workflows", split into "Just me" and "Public" sections, and "All workflows" (everyone's public ones). It also has a detail view that lists the extensions with their descriptions, and a form to create or edit, with the checklist in `dev/components/extension-picker.js`. From someone else's public workflow you can make a private copy. Workflows get into a case only from that case's Workflows panel; the Workflows page has no "Add to case" action. Extensions show their icons. Most icons live on GitHub, and a browser loading them there would reveal who is browsing, so the backend serves its own copies at `GET /api/slicerweb/extension-icon/:channel/:name` (`backend/src/services/extensionIcons.js`). It fetches only the exact `https` URL the build's `index.json` lists, accepts only PNG, JPEG, GIF or WebP up to 512 KB (no SVG, which can carry script), caches copies on disk (`SLICERWEB_ICON_CACHE_DIR`, default the system temp folder), and waits an hour before retrying a failed fetch. Icons shipped inside the build are served from it directly. With no icon, the tile shows the name's first letter. Public workflows don't show their author.

## Code style for this feature: concise and reusable

Patterns that this feature repeats go into shared utils. Existing callers move over when they're next touched; there's no separate refactor pass.

**Backend**

- `loadCaseWithAccess(caseId, req, minRole)` in `utils/caseAccess.js`. It replaces the `findByID('cases') → NotFoundError → assertCaseAccess` block that `routes/` repeats 18 times, and returns `{ caseDoc, role }`.
- `loadOwnedDoc(collection, id, req)` in `utils/ownedDocs.js` (new). It finds a document by ID, throws `NotFoundError` if missing, and throws `ForbiddenError` unless `owner_id` matches the requester. Workflows use it now, and anything else with an `owner_id` can use it later.
- `canView(doc, req)` (`owner || visibility === 'public'`) lives with `loadOwnedDoc`. It will be reused for the gallery.
- `requireOwnerId(req)` and `isOwner(doc, req)` live with `loadOwnedDoc`. It takes `{ write: false }` for read access; someone else's private document returns 404, not 403.
- `sanitizeNameList`, `sanitizeText` and `sanitizeChoice` in `utils/validation.js`.
- `ALL_COLLECTIONS` in `payload/collections.js` is the one collection list both Payload configs use.

**Frontend**

- `apiRequest(path, { method, body })` in `services/apiResponse.js`. It wraps `fetch(API_URL + path, { credentials: 'include', cache: 'no-store', JSON headers })` plus `parseApiResponse`, which `services/cases.js` currently repeats for each endpoint. `services/workflows.js` is then one line per endpoint.
- `loadExtensionCatalog(channel)` in `services/workflows.js`. It fetches and caches `index.json` for the editor.
- `styles/listPage.js` holds the My Cases look: page header, card grid, detail toolbar and header, the panel of rows (case attachments, workflow extensions), form panel, and their dark-mode rules. Rows are `file-list-row`; its `plain` option shows a name with nothing to open. The cases page and the workflows page both use it.
- `utils/listSort.js` (`LIST_SORT_OPTIONS`, `filterByText`, `sortRows`) does the search and sort for cases, attachments and workflows.
- Instead of `canManageWorkflows(role)`, the server returns `canManage`.

**Tests:** `tests/unit/backend/workflowsRoute.test.mjs` and `tests/unit/frontend/workflowsService.test.mjs`. `tests/unit/backend/helpers/routeHarness.mjs` (`makeApp`, `dispatch`, `fakePayload`) replaces the copies of these helpers in older route tests when those tests are next touched.

## Workflows in cases

Agreed on 12 Nov 2026 after a clickable prototype. It replaces the first-pass `<case-workflows>` picker above the file list, which acted as a hidden mode: nothing on a file showed which workflow it would open with. What's already built and what changes is under [Build status](#build-status).

Workflows are brought into a case only from within that case. The Workflows page stays about creating and browsing workflows.

### Opening a file: "Open ▾"

Each openable file, and the blank viewer, has a split button. The main part opens the file as described in [Which workflow opens](#which-workflow-opens); the chevron opens a menu for picking something else. **Most people should never need the menu.**

```
 heart_scan.mrb     12 MB   [ Open · SlicerHeart – Simplified ▾ ]

 ┌───────────────────────────────────┐
 │ Open in                           │
 │ [ SlicerWeb ] [ Full Slicer ]     │
 │ ───────────────────────────────── │
 │ ✓ No workflow                     │
 │     Just SlicerWeb                │
 │ This case                         │
 │   SlicerHeart                     │
 │   SlicerHeart – Simplified        │
 │   Cardiac segmentation            │
 │ Mine                              │
 │   My TAVR setup                   │
 │   More workflows… (4 more)        │
 └───────────────────────────────────┘
```

- **"Open in"** switches the viewer for this file; it starts on the person's own viewer. The blank viewer is SlicerWeb only, so it has no switch.
- **The blank viewer** is a plain "Open blank viewer ▾" button that only opens the menu: it's a starting point for any number of files, so nothing is assumed or remembered. The case default (or "No workflow") is checked and focused, so Enter opens with it.
- **"No workflow" comes first:** the one entry every menu has, in a fixed place. Then "This case" (approved workflows) and "Mine" (the person's own, unless the case turns them off; named like My Cases and My Groups). One of the person's own that the case has approved is listed only under This case, since its approved copy is what everyone in the case gets.
- **Only what you can use now.** Workflows the chosen viewer can't run, or made for other file types, are left out, not greyed. Pending requests aren't listed. Requesting and adding are in the [Workflows panel](#workflows-panel), not here.
- **Second line:** the workflow's description, cut to one line, or "Starts in <module>".
- **Overflow:** after 5 workflows the menu shows **"More workflows… (n more)"**, a searchable list of the same usable workflows; picking one opens the file. The current choice always stays in the short list.
- **Label:** next to the chevron, what's different from the person's own viewer with no workflow: the workflow's name, and the viewer when it isn't theirs ("SlicerHeart · Full Slicer").

### Which workflow opens

A launch is a **viewer** plus, optionally, a **workflow** installed on top.

**Viewer:** the person's pick for this file (the menu's "Open in"), else their account setting (`use_full_slicer`), which counts as an explicit choice. The blank viewer is always SlicerWeb.

**Workflow:**
1. The person's pick for this file, a workflow or "No workflow".
2. The case's default workflow, if it can be used for this file (its file types) in this viewer.
3. None.

A pick or default that isn't usable is skipped: removed from the case, a personal workflow when the case turns them off, made for other file types, or not runnable in the chosen viewer. No warning for now.

~~Picks are kept in the browser~~ Removed 19 Nov: a choice from the menu opens the file once and isn't remembered, so a one-off override never becomes that file's default. A lasting per-file choice, the same for everyone, is a question for defaults per file type (step 6).

The account viewer setting could go away if "Open in" is clear enough on its own, but only once picks are stored on the server: today a sign-out forgets them, so a Full Slicer user would re-pick every file after every sign-in.

### When a file needs an extension

"No workflow" is the fallback when nothing else applies, even though some files can only be read with an extension (`.mcs` and `.mxp` need SlicerHeart's `MimicsProject` reader). There's no table of which file types need which extensions: it would have to be known in advance and kept up to date. Instead, a failed load is recognised when it happens.

**No check before launch (decided 16 Nov 2026).** Not a prompt for known types ("`.mcs` files need SlicerHeart"), not a silent add, and not reader file types published in SlicerWeb's extension catalog. More than one extension can read a format, and which one suits a file is only known when Slicer tries it, so a failed load is the one reliable signal. Its cost is one failed start per file and browser, since the workflow picked from the dialog is remembered for that file, and cases whose admin sets a default workflow don't pay it at all.

Tested in SlicerWeb without SlicerHeart: opening an `.mcs` file doesn't report "no reader". Slicer falls back to its general volume reader, and ITK fails with `vtkITKArchetypeImageSeriesReader::ExecuteInformation: Cannot open <file>. ITK exception info: … Could not create IO object for reading file <file>`. So a check before loading ("is there a reader?") doesn't work; the failure has to be read afterwards.

- **Only that signature gets the targeted message.** When a load fails with ITK's "Could not create IO object for reading file" (the format wasn't recognised), the case page says: *"This file's format wasn't recognised. It may need an extension that isn't included. Try one of this case's workflows, or ask a case admin."* If the case has workflows the chosen viewer can run, they're offered as buttons ("Open with SlicerHeart").
- **Every other failure shows the real error**, as today. No general "file not supported" message: it would hide the real cause and mislead debugging.
- The match is on error text, so it could change between Slicer versions. If it stops matching, people simply see the real error again, which is safe; a unit test on the matcher with the message above catches the change.
- SlicerWeb's errors arrive through its `alert`, which `cases-page.js` already replaces inside the viewer iframe (`_slicerAlertMessage`), so the case page can show its own message instead of the browser's popup. Check that this path is caught: the test above showed the browser's native popup.

**As built:** `isUnrecognisedFormat()` in `dev/services/slicerErrors.js` matches ITK's text and also SlicerWeb's own "No reader is available for …" (no reader claims the file at all), which means the same thing. It only applies when nothing loaded; a scene that loads with one unreadable part still opens. Where the text comes from:
- Most files go through SlicerWeb's bridge `loadFiles`, which shows reader errors with `slicer.util.messageBox` → `window.alert` (in the iframe, so our override catches it; the native popup in the test was SlicerWeb opened on its own).
- `.mcs` / `.mxp` are loaded by naming SlicerHeart's `MimicsProject` reader. Only when that load fails (no SlicerHeart) does the case page let Slicer pick a reader instead, as desktop Slicer would, and read the messages it collected. Checking for the reader up front didn't work in testing: with SlicerHeart, the load hung and failed, probably because its reader registers after SlicerWeb reports ready.

The case page then shows the viewer error dialog (`#viewer-error-dialog`, which until now was never rendered, so every load error fell back to the page's error line; all load errors now use the dialog). It offers this case's workflows usable for the file in SlicerWeb that add an extension the failed launch didn't have (`workflowsAddingExtensions` in `openWith.js`), as one button: "Open with SlicerHeart", or with more than one, "Open with SlicerHeart ▾", a menu of them with the first checked, like "Open blank viewer ▾" (`<open-with-menu>` without "No workflow"). Past `MENU_LIMIT` the menu ends in "More workflows… (n more)", which closes this dialog and opens the searchable list in its place: one dialog at a time, never one on top of another. Picking one opens the file with it, once. With none to offer, the text says a case admin can add one, and the only button is Close. `PopupMenu` renders its panel inside a modal dialog it's opened from, since a modal dialog makes the rest of the page inert.


### Viewers and workflows

There are two viewers, SlicerWeb and Full Slicer. Whether a viewer can run a workflow follows one rule, with no workflow-specific code: **every extension the workflow needs is available in that viewer, and its startup configuration only uses keys that viewer supports.**

| Viewer | Extensions available | Startup keys |
|---|---|---|
| SlicerWeb | the build's `extensions/index.json` (per channel) | `module` (latest channel) |
| Full Slicer | the add-ons manifest, `slicer-gui-gpu/slicer-addons.json` (today Sandbox and SlicerHeart, plus the SimplifiedViewer module), which every seat loads | `module` |

So today Full Slicer can run SlicerHeart, SlicerHeart – Simplified and "No workflow". Adding an extension to the manifest (a config change plus the daily add-ons sync) makes workflows that use it available in Full Slicer, with no code change. Until seats load only a workflow's own extensions, "No workflow" and SlicerHeart behave the same in Full Slicer, since SlicerHeart is always loaded.

**Seeded workflows.** SlicerHeart stops being hardcoded into SlicerWeb launches (`buildSlicerWebUrl`'s `extensions = ['SlicerHeart']`). `scripts/setup-payload.mjs` (run on every update) creates two public workflows if missing (`backend/src/setup/workflowSeed.js`), owned by a fixed system owner (`owner_id: 'system'`) so no user can edit or delete them:

| Name | Extensions | Startup configuration | File types |
|---|---|---|---|
| SlicerHeart | SlicerHeart | none | any |
| SlicerHeart – Simplified | SlicerHeart | `{ "module": "SimplifiedViewer" }` | any |

**Existing cases** keep what they expect: the same setup step approves both on every case that existed before this change and makes SlicerHeart the default workflow. It's a migration, not part of the running server. It runs once per case (a per-case marker, `workflows_seeded`, so an admin who later changes this doesn't get it back). **New cases** start with no workflows. Later, creating a case could offer to import workflows, with SlicerHeart suggested.

**Account setting.** Simplified Viewer is no longer a viewer, so `use_simplified_viewer` goes away (its column into `RETIRED_SCHEMA` first); people who had it on keep Full Slicer and pick "SlicerHeart – Simplified" from the menu. Simplified Viewer **share links** (`routes/files.js`) stay hardcoded for now.

### Workflows panel

A **Workflows** button in the case toolbar, next to People, for everyone (with a count badge for admins when requests are waiting). Like People, members see what's there and admins manage it. Tabs:

- **In this case:** the approved workflows, each with its description, file types, where it runs ("SlicerWeb and Full Slicer", or "SlicerWeb (not Full Slicer yet)") and "starts in …". Admins can **remove** one here; removing the default workflow clears the default. Members also see **their own pending requests**, with Cancel.
- **Request workflows** (members above `read_only`) / **Add workflows** (admins): browse public workflows not yet in the case (admins also see their own private ones) with search. Members get **Request**, or **Request too** when someone already asked; admins get **Add** (approves directly). Same "runs in" line as above. Searching and paging happen on the server (see [Build status](#build-status)).
- **Requests** (admins): Approve, or Decline with an optional reason. The panel opens on this tab when requests are waiting.

### Case Settings (admins only)

A **Settings** button in the case toolbar, for case admins only, opens a settings view. Role-based sections, as on GitHub, may come later.

```
 Case settings
 ─────────────────────────────────────────────
 Default workflow
   What files in this case open with, unless someone picks something
   else for a file.                        [ SlicerHeart        ▾ ]

 Personal workflows
   [■] Members can use their own workflows
```

- **Default workflow:** "No workflow" or any approved workflow. It only applies where it can: files of its type, in viewers that can run it. There is no per-file-type table and no list of always-included extensions: one default keeps a launch's extensions coming from one place, the workflow.
- **Members can use their own workflows:** on by default. When off, Open menus list only the case's workflows. This is a consistency setting for studies, not a security boundary: it's applied in the browser, and users can still install extensions by hand in SlicerWeb. The settings text should say so.
- Adding and removing workflows is in the Workflows panel, with a link from here.

### Requests

There is at most **one request row per (case, workflow)**, however many people ask.

- **Request:** creates a pending row, or adds the requester to an existing pending one. The admin gets a bell notification and sees one line ("requested by A. Smith and 2 others").
- **Cancel:** a requester removes themselves. When nobody is left, the row is deleted and the admin's notification cleared.
- **Decline:** the admin may give an optional short reason. Every requester gets a bell notification ("Valve planning wasn't added to Case X"), with the reason if given.
- **Approve:** copies the workflow as approval does; requesters get a notification ("now available in Case X").
- **Request again after a decline:** the row goes back to pending with only the new requester. The admin sees the earlier decline date and reason.
- **Source no longer public** while pending: Approve is disabled and the line reads "No longer public". The admin declines it so requesters are told.
- **Requester leaves the case, becomes `read_only`, or is deleted:** they're left out when the request is read (names, counts) and aren't told the outcome, so a notification can't show them the title of a case they've left. Reads never write: their row goes when the request is decided. A request nobody in the case is still asking for is hidden, and reused if someone asks again.

### Notifications

These follow the two patterns already in use: pending invites (a live count in the bell, plus cards in Home's To do that act on the live data) and mentions (stored rows in `user-notifications`).

**Case admins: pending requests (live, not stored).**
- **Bell:** the count of pending workflow requests on cases they admin, next to `pendingInviteCount` in `notificationStore`, with when the newest arrived. No Keycloak lookups. As on most sites, the bell's dot is for what arrived since it was last opened (stored per user in the `bell-state` collection, so it holds across browsers): waiting to-dos stay listed in the bell until handled but don't keep the dot lit.
- **Home To do:** one card per pending request, built like `inviteToTodo`: "A. Smith and 2 others requested Valve planning for Case X", with **Approve** and **Decline** (decline asks for the optional reason). Clicking the card opens the case's Workflows panel on Requests.
- Because both come from the pending rows, a request that is cancelled, or decided by another admin, disappears for every admin with nothing to clean up.

**Requesters: outcomes (stored).**
- On approve or decline, each requester gets a `user-notifications` row, with type `workflow_request_approved` or `workflow_request_declined` and `case_id` set. The title names the workflow and case; for a decline the body is the reason, if one was given.
- It shows in the bell, and in To do while unread, like mentions. Clicking opens the case.
- The decline reason copied into a notification is kept under the notifications' normal retention (`services/dataRetention.js`), not the request row's.

### Data model

**`workflows`** gains `startup_config` (json, see [Startup configuration](#startup-configuration)) and `viewer` (`slicerweb` | `full`; empty on older rows, read as SlicerWeb). `case-workflows` copies `viewer` like the other fields, so changing it is an update.

**`case-workflows`** (one row per case and workflow; a request or an approval):

| Field | Type | Notes |
|---|---|---|
| `status` | select `pending` / `approved` / `declined` | rows with no status (from before requests) count as approved |
| `requested_at` | date | when the row last became pending |
| `decline_reason` | text | optional, up to 500 characters, plain text; shown to the admin if the workflow is requested again, cleared on approval |
| `decided_by`, `decided_at` | text, date | replaced `approved_by` / `approved_at` |

`name`, `description`, `extensions`, `file_types` and `startup_config` are copied (and compared, for "Update available") from the source on request and again on approval. A unique index on (case, workflow) enforces one row each; when two people make the first request at once, the second gets the first's row. Requesters are rows in a small `case-workflow-requesters` collection, keyed like the request by (case, workflow), plus `user_sub` (Keycloak sub only), unique on all three. So joining and cancelling are an insert and a delete, which two people at once can't overwrite; one person's rows can be found (and deleted) by `user_sub`; and the requesters go with the case without a reference between the two collections that would block deleting it. They're deleted once the request is decided. Names are looked up from Keycloak when shown, as the People dialog does.

**`attachments`** gains `open_with` (text): the file's default for everyone, as a menu key (`case:<case-workflows id>`, `viewer:slicerweb` or `viewer:full`; not personal toolkits). Empty: the case default.

**`cases`** gains:

| Field | Type | Notes |
|---|---|---|
| `default_workflow` | text | a `case-workflows` id, or empty |
| `allow_personal_workflows` | checkbox | default true |
| `workflows_seeded` | checkbox | set once the existing-case step has run |

Fields removed on the way (into `RETIRED_SCHEMA` first): `case_workflows.approved_by` / `approved_at` (done), `case_workflows.requesters` (json array, replaced by the collection; done, deleting the branch-only pending requests with it), `cases.workflow_defaults`, `user_preferences.use_simplified_viewer`.

### API

| Route | Who |
|---|---|
| `GET /api/cases/:id/workflows` | Members: `approved`, `mine` (empty when personal workflows are off), their own pending requests, `defaultWorkflow`, `allowPersonal`, `canRequest`. Admins also get `requests`. |
| `GET /api/cases/:id/workflows/available?q=&page=` | Members above `read_only`: public workflows not in the case (admins: plus their own), searched and paged on the server, for the Workflows panel |
| `POST /api/cases/:id/workflows/requests` with `{ workflowId }` | Members above `read_only`: request, or join a pending request. The source must be public. |
| `DELETE /api/cases/:id/workflows/requests/:workflowId` | A requester, to cancel their own request |
| `POST /api/cases/:id/workflows` with `{ workflowId }` | Case admin: add directly, approve a request, or re-approve to take an update |
| `POST /api/cases/:id/workflows/:rowId/decline` with `{ reason? }` | Case admin |
| `DELETE /api/cases/:id/workflows/:rowId` | Case admin: remove an approved workflow (clears the default if it was the default) |
| `PATCH /api/cases/:id/workflow-settings` with `{ defaultWorkflow?, allowPersonal? }` | Case admin |
| `GET /api/workflow-requests/pending` | Requests awaiting the signed-in user's decision across the cases they admin, for To do |
| `GET /api/workflow-requests/pending-count` | The bell's count, with no Keycloak lookups |

### Build status

**Built on `rhisey/wip/workflows-in-cases` (as of 13 Nov 2026; the latest pieces are uncommitted, for review):**
- The Open ▾ menu ("Open in" switch, "No workflow" first, only usable items, "More workflows…" after 5) and which workflow opens (per-file pick, else the case default, else none).
- Viewers and workflows: the one "can run" rule, Full Slicer's extensions from `slicer-addons.json`, start modules in Full Slicer's open request.
- Startup configuration: `startup_config`, the "Start in" field on the Workflows page, `module=` plus the after-load workaround for SlicerWeb (see [Startup configuration](#startup-configuration)).
- Seeding: the two SlicerHeart workflows and the existing-case step, run by `setup-payload.mjs`.
- The Workflows panel (In this case / Request or Add / Requests), opened from the case's ⋯ menu; Case Settings with the single default workflow and the personal switch.
- `cases-page.js` split: workflow code in `dev/controllers/caseWorkflowsController.js`, styles in `cases-page.styles.js`, Case Settings draws its own header.

- Failed loads (16 Nov): the "may need an extension" dialog with "Open with …" buttons (see [When a file needs an extension](#when-a-file-needs-an-extension)).
- Requesters as rows, unique indexes, reads that never write (16 Nov).
- Bell and Home To do for requests (17 Nov): `GET /api/workflow-requests/pending-count`; the bell's line for requests waiting (opens Home); To do cards with Approve / Decline (inline optional reason), whose title opens the case's Workflows panel on Requests; approved/declined outcomes in To do while unread, under a new "Workflow" category. The bell's count doesn't check that requesters are still in the case (that needs their roles on every poll), so a request whose requesters have all left counts until decided, though To do hides it.

- Server-side search and paging (18 Nov, uncommitted): the Workflows page's "All workflows" tab and the case panel's "Request or Add" list ask the server for 24 at a time (`?q=&sort=&page=`, `findWorkflowPage` in `services/workflows.js`), with "Load more" (`dev/utils/pagedList.js`). Search matches every word in the name, description, extensions or file types, through a `search_text` field that a Payload hook rebuilds on every save (Payload can't search inside json fields). No backfill: workflows exist only on this branch, and the one local database with older rows was filled in by hand. "My workflows" stays loaded whole and searched in the browser, since it's one person's. The case panel's unused `fileTypes` filter is gone.

- Cleanup (19 Nov, uncommitted):
  - Request limits (`services/workflowRequests.js`): a declined workflow can be asked for again a day later (`REQUEST_COOLDOWN_MS`), or at once if it has changed since in anything a case copies (admins can always add it); at most `MAX_PENDING_PER_MEMBER` (10) requests waiting per member per case; request and cancel share a per-person rate limit (30 per 10 minutes).
  - Workflow API errors have keys (`AppError.fromKey`), and the browser shows its own text for them from the `api` section of `dev/i18n/locales/en.js` (`apiErrorText` in `dev/services/apiResponse.js`), falling back to the server's message for keys it doesn't have. Validation messages name the field by a catalog key (`field`), so both sides translate it. A test checks every workflow key the server sends has browser text.
  - Case Settings shows "Workflows could not be loaded" with "Try again" instead of "Loading…" forever.
  - Constants: `REQUEST_STATUS`, `VISIBILITY` (backend); `WORKFLOW_VISIBILITY`, `WORKFLOW_SECTION` with `workflowKey()`, and the Workflows page's `TAB` (browser).
  - `case_workflows.source_updated_at` retired (`RETIRED_SCHEMA`); the retired-schema step runs in one transaction (`psql -1`) and stops setup on failure.

- UX round 2, more icon-led (started 19 Nov, after reviewer feedback; this section of the doc is rewritten once the design settles). Planned: the toolkit's icon before each file name; the chevron opens a grid of icons; the labelled menu moves to an overflow; the viewer becomes part of the toolkit; defaults per file type in Case Settings.
  - Named "Toolkit" for users (catalog text only; code, keys and routes still say workflow).
  - Each openable file shows its toolkit's icon before its name (the viewer's initial with no toolkit); clicking it opens the file, as the name does. It's pointer-only: keyboard and screen readers use the name button, so there's no second tab stop. The case's toolkits carry their source's `iconUrl` (not copied: the source's current icon, only when the person can see the source; otherwise the initial).
  - On file rows the Open ▾ button is a bare chevron (the toolkit's name is in its tooltip) that opens a grid of icons, 4 wide, each named in a tooltip on hover and keyboard focus (names under the icons wrapped badly): No toolkit, the short list, "More…", then "All options…", which shows the labelled list (with "Open in") in the same panel, so there's never a menu on a menu. Arrow keys go through the tiles in order, Left/Right as Up/Down, the same for every popup menu (so sighted keyboard and screen reader users get one behaviour). The chevron still shows when only one choice applies, because "Open in" lives behind it until the viewer becomes part of the toolkit. The blank viewer and the failed-load dialog keep the list.

  - The viewer is part of the toolkit (5a, data and editor): a `viewer` field, chosen on the toolkit form ("Opens in", before Extensions) and shown on its page. "Start in" drops its SlicerWeb notes for Full Slicer toolkits. Seeds: SlicerHeart opens in SlicerWeb, SlicerHeart – Simplified in Full Slicer (SimplifiedViewer only starts there); setup gives older seed rows their viewer. Cases that approved Simplified before this show "Update available" until re-approved. Opening files doesn't use it yet (5b).

  - Opening follows the toolkit's viewer (5b; replaces "Open in" and the viewer step in [Which workflow opens](#which-workflow-opens) and [Opening a file](#opening-a-file-open-)). Clicking a file opens it with the case default, in that toolkit's viewer; else the person's account viewer with no toolkit. A menu choice opens it once and isn't remembered (per-file picks in the browser were removed). Plain **SlicerWeb** and **Full Slicer** entries (keys `viewer:slicerweb` / `viewer:full`) replace "No toolkit" and the "Open in" switch; Full Slicer is offered once the case's data has loaded. The blank viewer offers only SlicerWeb and SlicerWeb toolkits. Menus, "More toolkits…" and Case Settings show each toolkit's viewer; the case panel says "Opens in …" or "Can't open in … here". The chevron always shows (there are always two plain viewers), so "hide it when only one choice applies" is dropped.

  - Each file has its own default (6a, data): `attachments.open_with`, set from the upload's tus metadata (`openWith`; a malformed key is dropped, the upload still succeeds) and changed later with `PATCH /api/cases/:id/attachments/:attachmentId/open-with` `{ openWith }` (null: back to the case default) by its uploader or a case admin. Only the key's form is checked. Clicking a file opens with its default, else the case default, else the person's account viewer; a file default that no longer applies (removed from the case, other file types) is skipped, not cleared. Next: the upload dialog that sets it (6b), "Default toolkit…" on the row and "Save as new" keeping the source's (6c).

  - The upload asks (6b): before uploading, "Choose the default toolkit for this file" (`default-toolkit-dialog`), one dropdown per file that opens in Slicer: the plain viewers ("SlicerWeb, no toolkit") and the case's toolkits that fit it (not personal ones), with the case default chosen if it fits, else SlicerWeb. Upload sends each choice as tus metadata; Cancel, ×, Escape or a click outside uploads nothing; focus starts on the first dropdown, and the hint is the dialog's description, so screen readers announce it. Not asked: files that don't open in Slicer (the server sends its list as `slicerFileTypes` with the case's workflows, so there's one list), and cases with no toolkit for any of the files (nothing to choose but a viewer; they get the case default). `app-dialog` now emits `dialog-closed`.

  - Changing a file's default and keeping it on save (6c): "Default for this file…" at the end of the Open ▾ menu (grid and list), for its uploader while they can still edit the case, or a case admin. It opens the same dialog (`default-toolkit-dialog`) with one row and a first option, "Case default: …", which clears it. Saving from a viewer, overwritten or saved as new, uploads the scene with the source file's default, so neither loses it (overwrite is a new upload plus deleting the old file, so it lost it before).

  - The toolkit icon moved next to download and remove (20 Nov), leaving the space before the name for thumbnails: an action button (a real one now, in the tab order: "Open MRHead.nrrd with SlicerHeart · SlicerWeb") and the chevron in one outlined split button (`.open-with-split`, with a divider; the menu's button is styled through `::part(trigger)`): the icon opens with the file's default, the chevron chooses. The file name still opens, as before. The menu lines up with the chevron's right edge. `file-list-row`'s leading slot still opens the file when clicked (for thumbnails); its unused `title-trailing` slot is gone.

**Next:** the two waiting items below, when their conditions are met; otherwise ready to merge.

**Open questions and follow-ups:**
- SlicerWeb can hang on startup from a broken service-worker cache (seen 19 Nov on latest: after `sw.js` nothing reached nginx; "Clear site data" fixed it). A hard refresh doesn't help and users won't know DevTools, and the latest channel will see real research use. Add a fallback: if SlicerWeb hasn't reported ready after a generous wait, offer "Reset viewer and try again", which unregisters SlicerWeb's service worker and deletes its caches (same origin, so the page can) without signing out. Also report it to SlicerWeb: its service worker should recover from a broken cache itself.
- "Start in" shows module names (`SegmentEditor`), not the titles Slicer users know ("Segment Editor"); decide together with the core module list once users have said where they start.
- Report to SlicerWeb: `?module=` should accept its built-in panels and apply after data loads; then remove the workaround.
- Move the remaining inline icons (download, search, `homeIcons.js`) into `dev/utils/icons.js`.
- Extract the viewer code (about 900 lines) from `cases-page.js`.
- **Before release:** a Docker 409 ("removal already in progress") when starting a Full Slicer seat right after a backend restart: the restart's orphan cleanup is still removing the person's old seat, so the user gets "Couldn't start the viewer. Please try again in a moment." (seen again 19 Nov). Handle it: on that 409, wait for the removal to finish (a few seconds), then start the seat; fail only if it's still there.
- A local test-data script (e.g. `scripts/seed-test-data.mjs`, never run by setup or bootstrap): data for trying things locally that a real installation shouldn't get, such as enough public workflows to page through, with a matching remove step. Paging was tested on 18 Nov with 30 public workflows owned by `test-paging`, added by hand.

**Cleanup agreed before merging:**
- ~~Requests: unique index, requesters as rows, no writes inside GETs (16 Nov); cooldown after a decline, cap per member per case, rate limit on request and cancel (19 Nov).~~
- ~~Workflow error messages with keys; the browser translates keyed API errors from its `api` catalog section (19 Nov).~~ Other API messages (auth, cases, …) move over key by key later; until then they show the server's English.
- ~~Case Settings: load failures shown with "Try again" (19 Nov).~~
- ~~Frozen constants for statuses, visibility, menu sections and keys (19 Nov).~~
- Retire the `use_simplified_viewer` preference and its "Use simplified viewer" checkbox (cases ignore it since the Open ▾ menu rework; Projects, their GPU route, share links and the seat loader still read it), together with Projects' move off SQLite. Then `accountDefaultViewer()` returns a `VIEWER` directly and `viewerFromAccount()` goes.
- Once every installation has run `setup-payload.mjs` with workflows: delete `seedExistingCases` from `backend/src/setup/workflowSeed.js` and retire `cases.workflows_seeded` (via `RETIRED_SCHEMA`, and stop setting it in case creation). Creating the two built-in workflows stays, for new installations.
- ~~Retire `case_workflows.source_updated_at`; `psql -1` and stop on failure for `RETIRED_SCHEMA` (19 Nov).~~

## To think about later

**Abuse once there's a public gallery.** Nothing limits how many workflows one person can create or make public, though `GET /api/workflows?scope=public` is now searched and paged on the server (sorted by title unless asked otherwise). One account could crowd the list, or publish misleading names and descriptions. None of this is a vulnerability today (public workflows can only name extensions we ship, and every field is shown as plain text), but the gallery needs some of these before it ships:

- a per-person limit on workflows, or on public ones, and rate limits on create and publish;
- a way to report a workflow, and to hide or unpublish it (for example from the Payload admin);
- showing who published a workflow, which needs the same opt-in as names elsewhere (`share_name_in_groups`); today public workflows show no author, by design;
- a sort that isn't just alphabetical (recent, or most used), so the first page can't be claimed by naming.

**Stacking: always-included extensions.** A launch is one viewer plus at most one workflow; workflows don't stack, because extensions combine but start modules don't (only one module can open first). For now, a case that always wants an extension (e.g. SlicerHeart in a cardiac case) gets it by including it in each of its workflows. If that becomes common, Case Settings could gain **"Always include these extensions"**: installed on every launch in the case, with or without a workflow, and never setting a start module, so the chosen workflow's startup configuration still decides where Slicer opens. The launch then merges two lists (the case's and the workflow's), each viewer checks the case's extensions too (one it lacks is left out, and the launch says so), and nothing about workflows or the menu changes. Free multi-select of workflows is not planned: it would need a "primary" workflow whenever two set a start module, and it makes the menu much harder for non-technical users.

**Workflow variants.** "SlicerHeart" and "SlicerHeart – Simplified" share an extension list and differ only in where they start, and admins approve each. If such variants become common, a workflow could be approved together with the variants based on it (parent/child), or carry several starting points. Not worth the complexity yet.

**Which files open in Slicer.** `SLICER_OPEN_EXTENSIONS` (`backend/src/utils/attachmentFlags.js`) is a hand-kept list of about 20 extensions; it decides which files get "Open" and which uploads are asked for a default (sent to the browser as `slicerFileTypes`). It's narrower than what Slicer reads (no `.mhd`, `.mrk.json`, `.tfm`/`.mat`/`.h5`, `.tsv`), and a toolkit's file types aren't checked against it, so a toolkit for `.mrk.json` is never offered. Near term: fill the gaps users actually hit, by hand. Better, later: generate the list per viewer from Slicer itself: for Full Slicer, the seat's IO manager (`allReadableFileExtensions()`), written out with the daily add-ons sync and read like `fullSlicerExtensions()`; for SlicerWeb, a readers list published with each build (needs SlicerWeb; otherwise generated per release). "Opens in Slicer" then depends on the viewer (and a toolkit's extensions can add readers, e.g. SlicerHeart's `.mcs`), so the attachment flags, the plain viewer tiles and the upload dialog would filter per viewer.

**Toolkit icons stay optional.** With the icon-only grid, toolkits without an icon fall back to an initial, and several can share one ("S" for SlicerHeart, SlicerHeart – Simplified and SlicerWeb). We won't require an icon, or offer a curated picker: many extensions already have logos authors can use, and we shouldn't be the gate. Revisit if look-alike icons become a real problem. A cheap improvement meanwhile: fall back to the toolkit's main extension's logo (`extensionIconUrl` in `dev/utils/iconTile.js`) before the initial; toolkits on the same extension would still look alike until their authors upload an icon.

**Noticing toolkit updates.** "Update available" only shows inside the case's Toolkits panel ("In this case", admins); the ⋯ menu's badge counts requests, not updates, so admins rarely see one. Updates usually aren't urgent, since the case keeps its approved copy. Later: a passive "look here" for admins (e.g. counting updates in the badge, opening on "In this case" when there are no requests), and a way for an owner to mark an update as a critical fix that does notify (bell, To do) or applies itself.

**Extension icon fetcher: DNS rebinding.** `services/extensionIcons.js` checks that every hop is https to a public address before requesting it. The address is looked up for the check and then again by `fetch`, so a host that changes its DNS answer between the two could still reach an internal address. Exploiting this needs control of a listed icon URL, and the response is discarded unless it's an image. Closing the gap fully means connecting to the checked address itself (a custom `undici` dispatcher with a pinned `lookup`), which isn't worth it for 16 icons from a build we control. Revisit if icons ever come from user input.

**Profile pictures uploaded before content checks.** Avatars are now checked by their contents on upload (`routes/auth.js`), as workflow icons are. Pictures uploaded earlier were stored under whatever extension their file name had. They're served with `nosniff`, so a disguised file can't run, but a one-off scan of `avatars/` with `sniffImageType` would find any that aren't really images.

## Startup configuration

A workflow can carry one **startup configuration**: what's passed to the viewer once it has started. For now that's a single key, the module to open:

```json
{ "module": "SimplifiedViewer" }
```

**Authors pick from lists; they never write code.** On the Workflows page, an optional **"Start in"** dropdown lists the modules of the ticked extensions (each extension's `modules` in the build's `extensions/index.json`; SlicerHeart lists SimplifiedViewer, and `SlicerHeartSimVascularPrivate` on stable lists ConduitPlanner) plus a short list of core modules kept in code. Untick the extension and a module that came from it is flagged. Modules a channel doesn't ship are flagged like extensions are ("Not in this SlicerWeb build").

As built (`dev/utils/startModules.js`): the core list is `CORE_MODULES`, a provisional guess (Data, Volumes, VolumeRendering, Models, Markups, Segmentations, SegmentEditor, Transforms) to replace once users say where they start; alternatives are every core module the build ships (with a search box, if the build publishes that list) or what saved workflows actually pick; extension modules come from both SlicerWeb channels' lists, so one only latest ships is marked "latest SlicerWeb only", and SimplifiedViewer is marked "Full Slicer only". A saved module whose extension has been unticked stays selected, with a note, until the author changes it. Full Slicer's own module list isn't consulted.

**Data, not code.** The configuration is checked on save against known keys only; anything else is refused, so a public workflow can't make a viewer do something we haven't chosen to support. Adding a key (`layout`, module options, placeholders such as `{inputFile}` filled in by the host at launch) is a deliberate change: the key goes on the allowed list and each viewer learns to apply it.

**How each viewer receives it:**

- **SlicerWeb:** `module` becomes `?module=<name>`, and the case page also selects it once the file has loaded (or, for the blank viewer, once SlicerWeb is ready), on both channels; see below for why both. Keys beyond the URL parameters would go through one `?config=` parameter or the `slicerWeb` bridge the case page already uses to load files.
- **Full Slicer:** the configuration goes in the open request that `slicer_session.py` already reads (where `useSimplifiedViewer` goes today), and it calls `slicer.util.selectModule()` after loading the file, after checking the name. SimplifiedViewer keeps the interface tidying seats apply today (`apply_simplified_viewer_ui`).

**Found in testing (Nov 2026):** SlicerWeb applies `?module=` once at startup, before our file loads, and only for real Slicer modules: only the latest channel reads it, and it ignores SlicerWeb's built-in panels. `?module=Volumes` works on latest; `?module=SegmentEditor` doesn't, because Segment Editor is a panel built into SlicerWeb's page rather than a Slicer module, so SlicerWeb reports "Unknown module". Its own paintbrush button opens it fine.

**Workaround (in place):** after the file loads, `cases-page.js` runs `selectModulePython()` (`dev/services/slicerBridgeUtils.js`) through the bridge. It sends the `select-module` message SlicerWeb's `selectModule()` sends, without the "is it loaded" check, so built-in panels open and the module is selected after loading rather than before. Both channels have that message. It is a SlicerWeb internal (`slicerweb.host`): if it changes, the module just isn't selected and a warning is logged. **To fix in SlicerWeb, then remove the workaround:** `?module=` should accept its built-in panels and apply after the page has loaded data.

## Later: Full Slicer

Full Slicer seats mount one shared add-ons snapshot (`data/slicer-addons`). The plan is to keep that single snapshot, containing every catalog extension, and have the workflow choose which modules load (via an environment variable read by `slicer_session.py`, or `--modules-to-ignore`). The workflow ID and version must then be part of the seat reuse check (where `priorUseSimplifiedViewer` is checked in `slicerGui/sessionManager.js`).

Full Slicer already runs workflows whose extensions are all in the add-ons manifest (see [Viewers and workflows](#viewers-and-workflows)). Loading only a workflow's own extensions per seat, and reusing seats per workflow, makes Full Slicer do exactly what a workflow says rather than load everything; it doesn't change the UX.
