# SlicerWeb Versioning Architecture

## Data model

Three layers work together:

| Layer | What it stores | Who writes it | API |
| --- | --- | --- | --- |
| `case_attachment_versions` | File history within a branch (file ID, label, pin, archive status) | Backend on every save | `/api/directus/cases/:caseId/attachments/:attachmentId/versions` |
| `attachment.parent` | Branch lineage — which attachment was forked from which | Backend on SaveAsNew | Directus items API |
| Directus revisions + activity | Audit log — every field change on the attachment record (file, name, metadata), who, when | Directus automatically | `/api/directus/revisions` (proxied) |

### When each is written

- **Overwrite save** → new `case_attachment_versions` record on the existing attachment; Directus revision recorded automatically
- **SaveAsNew** → new attachment created with `parent = source attachmentId`; first `case_attachment_versions` record written for the new attachment
- **Rename** → no version record; Directus revision records the name change automatically

---

## Branch model

Every attachment belongs to a tree. `parent` walks up toward the root.

```
attachment A  ──── v1, v2, v3, v4
                        └─── attachment B (SaveAsNew from v2)  ──── v1, v2, v3
                                   └─── attachment C (SaveAsNew from B-v1)  ──── v1
```

- Overwrite saves add versions to the current node
- SaveAsNew creates a child node, starting its own version history

---

## Planned UI: two separate views

### 1. Version history (GitHub-style)

Powered by `case_attachment_versions` + `attachment.parent`.

- Timeline of file saves on the current attachment, newest first
- Each row: date, label (editable inline), pin toggle, restore button
- Pinned versions are excluded from automated pruning
- If `attachment.parent` exists: "View parent branch" link — loads that attachment's version history
- Restore: non-destructive — points the attachment at the old file and writes a new version record labeled "Restored from [date]"

### 2. Audit log

Powered by Directus revisions + activity API.

- Every change to the attachment record: file updates, renames, metadata edits
- Columns: date, user, change (e.g. "renamed to X", "file updated", "parent set")
- Read-only — informational only, no restore action
- Useful for compliance and debugging

These are two separate UI surfaces (e.g. separate tabs or drawers), not one combined view.

---

## Backend endpoints (already built)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/directus/cases/:caseId/attachments/:attachmentId/versions` | List versions, newest first |
| `POST` | `/api/directus/cases/:caseId/attachments/:attachmentId/versions/:versionId/restore` | Restore a version (non-destructive) |
| `PATCH` | `/api/directus/cases/:caseId/attachments/:attachmentId/versions/:versionId` | Update label or pin |
| `DELETE` | `/api/directus/cases/:caseId/attachments/:attachmentId/versions/:versionId` | Delete a non-pinned version |
| `POST` | `/api/directus/admin/versions/prune` | Manually trigger the prune job (admin only) |

The audit log endpoint still needs to be built — a thin BFF proxy to Directus's `/activity` and `/revisions` APIs filtered to the attachment item.

---

## Retention policy (prune job)

Runs daily (`startPruneScheduler`). Skips pinned versions. Per attachment:

| Age | What's kept |
| --- | --- |
| 0–7 days | All versions |
| 7–30 days | Latest per calendar day |
| 30–90 days | Latest per calendar week |
| 90+ days | Latest per calendar month |

Controlled by env vars — see [versioning-azure-migration.md](versioning-azure-migration.md) for the full list.

---

## Key files

| File | Purpose |
| --- | --- |
| `backend/src/services/attachmentVersions.js` | Directus CRUD for `case_attachment_versions`; schema bootstrap |
| `backend/src/services/fileStorageStrategy.js` | Delete vs. archive on prune; Azure/S3 stub |
| `backend/src/jobs/pruneVersions.js` | Retention policy logic + scheduler |
| `backend/src/routes/directusVersions.js` | REST endpoints |
| `backend/src/routes/directus.js` | `createVersion` called after every save |
