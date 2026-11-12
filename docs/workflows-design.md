# Workflows (design)

**Status:** first pass built (SlicerWeb, extensions only).
**Related:** [slicer-gui-addons.md](./slicer-gui-addons.md) (Full Slicer extensions), [keycloak-case-groups.md](./keycloak-case-groups.md) (case roles).

A **workflow** is a named, pre-defined viewer setup that people can create, share and launch.
Today every SlicerWeb launch hardcodes `extensions=SlicerHeart`. Workflows replace that hardcoded value.

## Scope

| | First pass | Later |
|---|---|---|
| Viewer | SlicerWeb | Full Slicer (needs per-seat module loading and seat reuse keyed on workflow; see the end of this doc) |
| Contents | Extensions | Start module (see [Later: start module](#later-start-module)), layout, favourite modules, sample data or template scene |
| Discovery | An "All workflows" tab on the Workflows page; case admins pick from a list | Search across all public workflows, authors, ratings |

## Decisions

- **Anyone can create a workflow.** Its visibility is `private` (just me) or `public`.
- **Only a case admin can approve a workflow for their case.** They can approve their own workflows or any public one.
- **Launching in a case:** a member can pick one of their own workflows (private or public) or any workflow the case admin approved. A case admin can turn off members' own workflows for a case (see [Workflows in cases](#workflows-in-cases-next-pass)).
- **Members above `read_only` can request a public workflow for a case;** the case admin approves or declines. Letting admins choose which roles may request is part of a possible later move of case permissions into Case Settings; not needed now.
- **A viewer and a workflow are different things.** The viewer is where it runs (SlicerWeb, Full Slicer, Simplified Viewer); a workflow is what's installed on top, and only applies to the viewer it targets (SlicerWeb, for now). The person's own viewer choice is respected: a per-file pick, or their account setting, comes before a case's default workflow.
- **SlicerHeart is an ordinary workflow,** pre-seeded as a public workflow. Plain SlicerWeb opens with no extensions. Existing cases get SlicerHeart approved and set as their default, so nothing changes for them; new cases start with no workflows, and admins add SlicerHeart if they want it.
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

**Limitation:** extensions a user installs by hand in SlicerWeb's Extensions Manager are saved in the browser's `localStorage` under `slicerweb.extensions`, as a list of wheel URLs. That storage belongs to the browser profile and site origin, not to a SlicerHub account or a session:

- It stays until browser storage is cleared. Signing out of SlicerHub doesn't clear it, and the stable and latest channels share it.
- Anyone who later uses the same browser profile (for example on a shared workstation) gets those extensions, whoever they sign in as.
- It still loads alongside a workflow, so a workflow sets the minimum set of extensions, not the exact set.

**Security note:** the Extensions Manager can install a wheel from **any URL**, and `slicerweb.extensionIndex` can point at a different extension index. Workflows can't do this, but users can, by hand. The wheel's code runs on the SlicerHub origin. Because SlicerHub authenticates with cookies, that code's requests to `/api` carry the signed-in user's session. On a shared browser, a wheel one person installs therefore runs as whoever signs in next. Mitigations, cheapest first:

1. **Done.** `dev/utils/slicerWebStorage.js` clears `slicerweb.*` keys and SlicerWeb's autosave databases (IndexedDB names under `/home/pyodide/`, which hold scene data) on sign-out, and when a different user signs in on the same browser.
2. Have workflow launches ignore extensions installed by hand (needs a SlicerWeb option), or ask SlicerWeb upstream for a build flag that turns off install-from-URL and custom indexes.
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
| `source_updated_at` | date | the source's `updatedAt` when approved; a later `updatedAt` shows "Update available". Comparing two database timestamps avoids clock skew between the app and the database. |

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

Each openable file, and the blank viewer, has an Open ▾ menu (`<open-with-menu>`, `dev/components/open-with-menu.js`); see [Opening a file](#opening-a-file-open-). What it lists, which workflow the main button opens and the per-file choice (stored under `slicerweb.hub.workflowChoices`, so sign-out clears it with SlicerWeb's own state) are in `dev/utils/caseWorkflowMenu.js`. `cases-page.js` loads the case's workflows once per case, and `openWithWorkflow()` sends a choice to SlicerWeb (with its `extensions`, through `_slicerWebUrl()` and `buildSlicerWebUrl`) or to Full Slicer. Case admins manage workflows in Case Settings (`<case-settings>`, `dev/components/case-settings.js`), opened from the case toolbar: requests, approved workflows (add through the same "Find more…" dialog, `dev/components/find-workflows-dialog.js`; update; remove), the defaults table and the personal-workflows switch. The case page loads the case's workflows once and hands them to the menus and to Case Settings, which reload them after a change.

The **Workflows** page in the sidebar (`dev/pages/workflows-page.js`) is laid out like My Cases. It has two tabs of cards with search and sort: "My workflows", split into "Just me" and "Public" sections, and "All workflows" (everyone's public ones). It also has a detail view that lists the extensions with their descriptions, and a form to create or edit, with the checklist in `dev/components/extension-picker.js`. From someone else's public workflow you can make a private copy. Approving a workflow for a case happens on the case page only; how workflows get into cases needs its own design pass (see the "Open" section below). Extensions show their icons. Most icons live on GitHub, and a browser loading them there would reveal who is browsing, so the backend serves its own copies at `GET /api/slicerweb/extension-icon/:channel/:name` (`backend/src/services/extensionIcons.js`). It fetches only the exact `https` URL the build's `index.json` lists, accepts only PNG, JPEG, GIF or WebP up to 512 KB (no SVG, which can carry script), caches copies on disk (`SLICERWEB_ICON_CACHE_DIR`, default the system temp folder), and waits an hour before retrying a failed fetch. Icons shipped inside the build are served from it directly. With no icon, the tile shows the name's first letter. Public workflows don't show their author.

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

## Workflows in cases (next pass)

**Status:** mostly built (bell and Home To do, server-side search and the viewer/workflow split below are still to do). This replaces the first-pass `<case-workflows>` picker above the file list, which acts as a hidden mode: nothing on a file shows which workflow it will open with.

Workflows are brought into a case only from within that case. The Workflows page stays about creating and browsing workflows; it has no "Add to case" or "Request for a case" action, to keep it uncluttered.

### Opening a file: "Open ▾"

Each openable attachment, and the blank viewer, gets a split button. It replaced the old `<attachment-open-menu>` (which offered SlicerWeb, Full Slicer and Simplified Viewer) rather than adding a second menu. The main part opens with the workflow chosen as described below; the chevron opens a menu.

**Most people should never need the menu.** For non-technical users the main button is the interface, so case defaults carry most of the weight. Case Settings should nudge admins to set them (a hint when a case has approved workflows but no defaults).

```
 heart_scan.mrb     12 MB   [ Open · Cardiac segmentation ▾ ]

 ┌───────────────────────────────────┐
 │ Recommended for this case         │
 │ ✓ Cardiac segmentation            │
 │     Opens in your browser         │
 │   Valve planning                  │
 │     For aortic valve measurements │
 │ Yours                             │
 │   My TAVR setup                   │
 │ ───────────────────────────────── │
 │   Other ways to open            ▸ │
 │   Find more…                      │
 └───────────────────────────────────┘

 Other ways to open ▸
   In your browser (SlicerWeb)
   Full Slicer          slower to start, more tools
   Simplified Viewer
```

- **Grouped by who chose it, not by viewer.** "Recommended for this case" is the approved workflows; "Yours" is the user's own (unless the case turns them off). Empty sections aren't shown. No "built-in", "(case)" or "only you" tags; the headers say it.
- **Second line:** the workflow's description, cut to one line, or else where it opens in plain words ("Opens in your browser", "Opens in Full Slicer"). Extension lists stay on the detail view; they mean little to most clinicians.
- **"Other ways to open ▸"** holds the plain viewers, with no workflow (see [Viewers and workflows](#viewers-and-workflows)). Viewers the user can't use (Full Slicer feature off or no access) are left out.
- **File types:** for a file, only workflows whose `file_types` match, plus those with no file types, are listed; the blank viewer lists them all.
- **Label:** the button shows the workflow (or viewer) it will use when that isn't the person's own plain viewer.
- **No choices, no chevron.** If the menu would only hold the submenu and the user can't request more (`read_only`), the button is a plain "Open". People who don't use workflows never see the feature.
- **"Find more…"** (not shown to `read_only` members) opens a searchable picker of public workflows not yet approved for the case, filtered by the file's type when opened from a file. Each result lists its extensions. Members get **Request**; admins get **Add** (approves directly). Workflows already requested show "Requested", with **Cancel request** for one's own.
- **Pending requests** appear in the requester's Open menu, greyed out, as "Pending approval". Only the requester sees them.

### Which workflow opens

1. **The person's choice for this file:** whatever they last picked from that file's Open menu, a workflow or a plain viewer. Picking the case default from the menu is also a choice.
2. **The person's viewer:** their account setting (today's `use_full_slicer` / `use_simplified_viewer`), which counts as an explicit choice. If it's Full Slicer or Simplified Viewer, the file opens there and the case's SlicerWeb workflow defaults are skipped. No warning for now: workflows are meant to come to Full Slicer.
3. **The case's default workflow** (only when the person's viewer is SlicerWeb): the default for the file's type, then for all other files (or the blank viewer's default).
4. **The plain viewer**, with no workflow.

A saved choice or case default that isn't usable is skipped: removed from the case, a personal workflow when the case turns them off, or a viewer the person can't use. Choices are kept in the browser, keyed by case and attachment, under the `slicerweb.hub.` prefix so sign-out clears them. If an admin changes a default while someone is mid-way through a file, that file keeps whatever the person picked; files they haven't picked for follow the new default. This edge case is acceptable.

The account viewer setting may go away later, if the Open ▾ menu makes the viewer choice clear enough on its own.

### Viewers and workflows

The plain viewers are code constants, listed under "Other ways to open":

| ID | Viewer | Launches |
|---|---|---|
| `builtin:slicerweb` | SlicerWeb | no extensions |
| `builtin:full` | Full Slicer | as today |
| `builtin:simplified` | Full Slicer | as today, with `useSimplifiedViewer: true` |

They need no approval, have no owner, and aren't affected by the "Members can use their own workflows" switch. They are never case defaults: a case's defaults are always workflows. `openWithWorkflow(caseRow, attachment, entry)` routes by the entry's `target`.

**SlicerHeart** stops being hardcoded into SlicerWeb launches (`buildSlicerWebUrl`'s `extensions = ['SlicerHeart']`). Instead a public "SlicerHeart" workflow (extensions: SlicerHeart; any file type) is created at setup if missing, owned by a fixed system owner (`owner_id: 'system'`) so no user can edit or delete it.

**Existing cases** keep what they expect: a one-off step at setup approves the seeded SlicerHeart workflow on every case that existed before this change and makes it the default for all other files and for the blank viewer. It runs once per case (a per-case marker, so an admin who later removes SlicerHeart doesn't get it back). **New cases** start with no workflows; admins add SlicerHeart, or anything else, from Case Settings. Later, creating a case could offer to import workflows, with SlicerHeart suggested.

Simplified Viewer becomes a workflow in the full sense only with Full Slicer workflows (see the end of this doc). Simplified Viewer **share links** (`routes/files.js`) stay hardcoded for now.

### Case Settings (admins only)

A **Settings** button in the case detail toolbar, next to People, opens a settings view. Only case admins see it. Role-based sections, as on GitHub, may come later. Moving the title and description edit here is optional.

```
 Case settings › Workflows
 ─────────────────────────────────────────────
 Requests (1)
   Valve planning · requested by A. Smith and 2 others
   Previously declined on 3 Nov: "Use Cardiac instead"
                                  [ Approve ] [ Decline ]

 Approved workflows                                   [ Add… ]
   Cardiac segmentation  .mrb      (●) Default for .mrb    Update ✕
   Valve planning        .nii.gz   ( ) Default for .nii.gz        ✕
   SlicerHeart           Any                                      ✕

 Everything else
   Files with no default open with each person's own viewer.
   All other files open with   [ SlicerHeart          ▾ ]
   Blank viewer opens with     [ No workflow          ▾ ]

 [■] Members can use their own workflows
```

- **Approved workflows:** add (same picker as "Find more…"), re-approve when an update is available, remove. A workflow made for particular file types has a **"Default for …"** switch: on makes it the default for each of its types (replacing whatever was the default for them), off clears them. Workflows for any file type have no switch; they can be chosen for all other files or the blank viewer.
- **Everything else:** "All other files" offers no workflow or an approved workflow for any file type; "Blank viewer" offers no workflow or any approved workflow. A line says that files with no default open with each person's own viewer, and that the most specific match wins (`.seg.nrrd` before `.nrrd`, a file type before all other files). Admins never type file types: they come from the workflows.
- Removing an approved workflow clears the defaults that used it. `workflow_defaults` maps `blank`, `*` and file types to approval ids only.
- **Members can use their own workflows:** on by default. When off, Open menus list only approved workflows and the plain viewers. This is a consistency setting for studies, not a security boundary: it's applied in the browser, and users can still install extensions by hand in SlicerWeb. The settings text should say so.

### Requests

There is at most **one request row per (case, workflow)**, however many people ask.

- **Request:** creates a pending row, or adds the requester to an existing pending one. The admin gets a bell notification and sees one line ("requested by A. Smith and 2 others").
- **Cancel:** a requester removes themselves. When nobody is left, the row is deleted and the admin's notification cleared.
- **Decline:** the admin may give an optional short reason. Every requester gets a bell notification ("Valve planning wasn't added to Case X"), with the reason if given.
- **Approve:** copies the extension list as approval does today; requesters get a notification ("now available in Case X").
- **Request again after a decline:** the row goes back to pending with only the new requester. The admin sees the earlier decline date and reason.
- **Source no longer public** while pending: Approve is disabled and the line reads "No longer public". The admin declines it so requesters are told.
- **Requester leaves the case or is deleted:** they're dropped from the request; an empty request is deleted. The simplest version filters out non-members whenever requests are read.
- Requests reuse the collaborator-invite approval pattern; see Notifications below.

### Notifications

These follow the two patterns already in use: pending invites (a live count in the bell, plus cards in Home's To do that act on the live data) and mentions (stored rows in `user-notifications`).

**Case admins: pending requests (live, not stored).**
- **Bell:** the count of pending workflow requests on cases they admin is added next to `pendingInviteCount` in `notificationStore`.
- **Home To do:** one card per pending request, built like `inviteToTodo`: "A. Smith and 2 others requested Valve planning for Case X". It has **Approve** and **Decline** (decline asks for the optional reason), and clicking the card opens Case Settings › Workflows.
- Because both come from the pending rows, a request that is cancelled, or decided by another admin, disappears for every admin with nothing to clean up.

**Requesters: outcomes (stored).**
- On approve or decline, each requester gets a `user-notifications` row, with type `workflow_request_approved` or `workflow_request_declined` and `case_id` set. The title names the workflow and case; for a decline the body is the reason, if one was given.
- It shows in the bell, and in To do while unread, like mentions. Clicking opens the case.
- The decline reason copied into a notification is kept under the notifications' normal retention (`services/dataRetention.js`), not the request row's.

### Data model changes

**`case-workflows`** gains:

| Field | Type | Notes |
|---|---|---|
| `status` | select `pending` / `approved` / `declined` | existing rows are `approved` |
| `requesters` | json (string[]) | Keycloak subs only. No names or emails are copied; they're looked up from Keycloak when shown, as the People dialog does. Cleared once the request is decided. |
| `requested_at` | date | when the row last became pending; for "requested 3 days ago" |
| `decline_reason` | text | optional, short (500 characters), plain text; shown to the admin if the workflow is requested again, and cleared on approval |
| `decided_by`, `decided_at` | text, date | replace `approved_by` / `approved_at` |

`name`, `description`, `extensions`, `file_types` and `source_updated_at` are copied from the source on request and again on approval. Members' Open menus read only `approved` rows; rows with no `status` (made before requests existed) count as approved. Renaming `approved_by` / `approved_at` drops columns, so they go into `RETIRED_SCHEMA` first.

**`cases`** gains:

| Field | Type | Notes |
|---|---|---|
| `workflow_defaults` | json | `{ blank?, "*"?, <file type>? }` mapping to `case-workflows` IDs. A map on the case keeps each key to one value. |
| `allow_personal_workflows` | checkbox | default true |

### API changes

| Route | Who |
|---|---|
| `GET /api/cases/:id/workflows` | Members get `approved`, `mine` (empty when personal workflows are off), their own pending requests and the case's `defaults`. Admins also get `requests` and `settings`. |
| `GET /api/cases/:id/workflows/available?q=&fileTypes=` | Members: public workflows not approved for the case, for "Find more…" |
| `POST /api/cases/:id/workflows/requests` with `{ workflowId }` | Members above `read_only`: request, or join a pending request. The source must be public. |
| `GET /api/workflow-requests/pending` | Requests awaiting the signed-in user's decision across the cases they admin, for To do and the bell count (like `listInvitesAwaitingMyApproval`) |
| `DELETE /api/cases/:id/workflows/requests/:workflowId` | A requester, to cancel their own request |
| `POST /api/cases/:id/workflows/:rowId/decline` with `{ reason? }` | Case admin |
| `POST /api/cases/:id/workflows` with `{ workflowId }` | Case admin: approve directly, or approve a pending request |
| `PATCH /api/cases/:id/workflow-settings` with `{ defaults?, allowPersonal? }` | Case admin |

## To think about later

**Abuse once there's a public gallery.** Nothing limits how many workflows one person can create or make public, and `GET /api/workflows?scope=public` returns the first 200 by name. One account could crowd the list, or publish misleading names and descriptions. None of this is a vulnerability today (public workflows can only name extensions we ship, and every field is shown as plain text), but the gallery needs some of these before it ships:

- a per-person limit on workflows, or on public ones, and rate limits on create and publish;
- paging and search on the server instead of a fixed 200;
- a way to report a workflow, and to hide or unpublish it (for example from the Payload admin);
- showing who published a workflow, which needs the same opt-in as names elsewhere (`share_name_in_groups`); today public workflows show no author, by design;
- a sort that isn't just alphabetical (recent, or most used), so the first page can't be claimed by naming.

**Extension icon fetcher: DNS rebinding.** `services/extensionIcons.js` checks that every hop is https to a public address before requesting it. The address is looked up for the check and then again by `fetch`, so a host that changes its DNS answer between the two could still reach an internal address. Exploiting this needs control of a listed icon URL, and the response is discarded unless it's an image. Closing the gap fully means connecting to the checked address itself (a custom `undici` dispatcher with a pinned `lookup`), which isn't worth it for 16 icons from a build we control. Revisit if icons ever come from user input.

**Profile pictures uploaded before content checks.** Avatars are now checked by their contents on upload (`routes/auth.js`), as workflow icons are. Pictures uploaded earlier were stored under whatever extension their file name had. They're served with `nosniff`, so a disguised file can't run, but a one-off scan of `avatars/` with `sniffImageType` would find any that aren't really images.

## Later: start module

A workflow could name the module to open in, so a file opens straight into the tool people need. Deferred: the next pass covers extensions only.

What's already in place:

- SlicerWeb **latest** reads `?module=<name>`, matches it against loaded modules ignoring case, and logs a console warning for unknown names. **Stable** doesn't read it yet (it reads `layout`, `favoriteModules` and `sample`), so on stable the setting would be ignored until stable catches up.
- `extensions/index.json` lists each extension's `modules` (for example ExtraMarkups: `Label`, `Shape`), so the editor can offer a dropdown rather than free text.

What it would take:

- A `start_module` text field on `workflows` (`/^\w{1,100}$/`), copied into `case-workflows` on approval like `extensions`.
- `buildSlicerWebUrl` adds `module=<name>`.
- An optional "Start in" dropdown in the editor, listing the selected extensions' modules plus a short list of core modules kept in code (core modules aren't in `index.json`). Removing the extension that provides the chosen module clears it.
- "Starts in Segment Editor" can serve as the Open menu's second line when a workflow has no description.

To check: whether loading a file (especially an MRB) switches modules after SlicerWeb applies `module=`, and whether to hide the field or label it "latest only" while stable lacks it. For Full Slicer, `startModule` would go into the open request and `slicer_session.py` would call `slicer.util.selectModule()` after loading, after checking the name.

## Later: Full Slicer

Full Slicer seats mount one shared add-ons snapshot (`data/slicer-addons`). The plan is to keep that single snapshot, containing every catalog extension, and have the workflow choose which modules load (via an environment variable read by `slicer_session.py`, or `--modules-to-ignore`). The workflow ID and version must then be part of the seat reuse check (where `priorUseSimplifiedViewer` is checked in `slicerGui/sessionManager.js`).

Simplified Viewer is already Full Slicer plus the `SimplifiedViewer` module, which `slicer_session.py` loads and switches to. Once workflows gain a "start module" field, `builtin:simplified` becomes `{ target: full_slicer, startModule: 'SimplifiedViewer' }`, launched through the same Full Slicer workflow path as any other, and the `useSimplifiedViewer` flag goes away. It stays built-in rather than a stored public workflow, so no owner can edit or unpublish it. The account preference's two checkboxes (`use_full_slicer`, `use_simplified_viewer`) may go away if the Open ▾ menu makes the viewer choice clear on its own (see [Which workflow opens](#which-workflow-opens)); their columns would go into `RETIRED_SCHEMA` first.
