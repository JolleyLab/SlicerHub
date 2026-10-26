# SlicerWeb Versioning — Azure Cloud Migration Guide

The versioning system was designed to require minimal code changes on the move to Azure. Most of the work is configuration and completing two short stubs.

## Summary: what stays vs. what changes

| Area | Self-hosted (now) | Azure (cloud) | Effort |
| --- | --- | --- | --- |
| Directus DB | SQLite (auto) | PostgreSQL (env var) | Config only |
| File storage | Local disk via Directus | Azure Blob Storage | Config only |
| Tiered archive | Stub (logs only) | `@azure/storage-blob` `setAccessTier()` | ~10 lines of code |
| Prune job | `setInterval` inside backend | Azure Function timer trigger | Copy fn, swap scheduler |
| Version API routes | Express in backend | Same Express routes | No change |
| Directus collection | Same schema | Same schema | No change |
| Retention policy logic | `selectVersionsToPrune()` | Same pure function | No change |
| `.env` variables | See section 5 | See section 5 | Additive only |

---

## 1. Directus database backend

Locally, Directus auto-creates a SQLite file. In Azure, point it at a managed PostgreSQL instance instead — no code changes anywhere in the versioning system; Directus abstracts this.

```
# .env (Azure)
DB_CLIENT=pg
DB_HOST=<your-postgres-host>.postgres.database.azure.com
DB_PORT=5432
DB_DATABASE=directus
DB_USER=directus@<server-name>
DB_PASSWORD=<password>
DB_SSL__REJECT_UNAUTHORIZED=true
```

The `case_attachment_versions` collection is created by `ensureVersionsCollection()` at startup — it runs the same Directus API calls regardless of the backing DB, so the schema bootstrap works unchanged.

---

## 2. File storage (Directus → Azure Blob)

Directus ships a first-party Azure Blob Storage driver. The backend never calls storage APIs directly — it only talks to Directus by file ID — so this is pure Directus configuration.

```
# .env (Azure)
STORAGE_LOCATIONS=azure
STORAGE_AZURE_DRIVER=azure
STORAGE_AZURE_CONTAINER_NAME=<your-container>
STORAGE_AZURE_ACCOUNT_NAME=<storage-account>
STORAGE_AZURE_ACCOUNT_KEY=<key>   # or use a managed identity connection string

# Tell the versioning system a storage driver is configured
# (enables the archive stub to attempt a tier transition)
STORAGE_DRIVER=azure
```

Setting `STORAGE_DRIVER=azure` flips `config.versioning.storageDriverConfigured` to `true`, which tells `fileStorageStrategy.js` to attempt real tier transitions instead of just logging.

---

## 3. Archive / tiered storage

`fileStorageStrategy.js` (`archiveFile` function) already has the exact code to add, as a commented stub. When `PRUNE_STRATEGY=archive` and `STORAGE_DRIVER=azure`, replace the stub body with:

```js
// In archiveFile() in backend/src/services/fileStorageStrategy.js,
// replace the stub comment block with:
import { BlobServiceClient } from '@azure/storage-blob';

const client = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = client.getContainerClient(process.env.STORAGE_AZURE_CONTAINER_NAME);
const blobClient = containerClient.getBlobClient(version.file_id);
// 'Cool' = standard infrequent access (~40% cheaper); 'Archive' = offline, requires rehydration
await blobClient.setAccessTier(tier === 'glacier_ir' ? 'Cool' : 'Archive');
```

Install the SDK: `npm install @azure/storage-blob`

**Tier mapping** (set via `PRUNE_ARCHIVE_TIER` env var):

| `PRUNE_ARCHIVE_TIER` | Azure tier | Access | Cost vs. hot |
| --- | --- | --- | --- |
| `glacier_ir` (default) | Cool | Milliseconds | ~40% cheaper |
| `archive` | Archive | 1–15 hours rehydration | ~80% cheaper |

The `archive_status` and `storage_tier` fields on the version record are already updated by the existing stub — only the SDK call is new.

---

## 4. Prune job → Azure Function timer trigger

`runPruneJob()` in `backend/src/jobs/pruneVersions.js` is a plain async function with no Express dependencies. It can be called from anywhere.

**Step 1** — Set `VERSION_RETENTION_ENABLED=false` in the backend's `.env` so the in-process `setInterval` scheduler doesn't also run.

**Step 2** — Create a new Azure Function (Node.js, timer trigger):

```js
// azure-functions/pruneVersions/index.js
import { runPruneJob } from '../../slicer-web/backend/src/jobs/pruneVersions.js';

export default async function (context, timer) {
    const stats = await runPruneJob();
    context.log('Prune job complete:', stats);
};
```

```json
// function.json
{ "bindings": [{ "type": "timerTrigger", "direction": "in",
  "schedule": "0 0 3 * * *" }] }
```

**Step 3** — Set the same `DIRECTUS_URL`, `DIRECTUS_TOKEN`, `PRUNE_STRATEGY`, and `PRUNE_ARCHIVE_TIER` env vars in the Azure Function App's Application Settings.

The admin endpoint `POST /api/directus/admin/versions/prune` still works for manual runs from either environment.

---

## 5. Environment variables to set

| Variable | Self-hosted value | Azure value | Notes |
| --- | --- | --- | --- |
| `DB_CLIENT` | _(not set, SQLite)_ | `pg` | Directus DB driver |
| `DB_HOST` | _(not set)_ | Azure PostgreSQL FQDN | |
| `DB_DATABASE` | _(not set)_ | `directus` | |
| `DB_USER` | _(not set)_ | `directus@<server>` | |
| `DB_PASSWORD` | _(not set)_ | strong password | |
| `STORAGE_LOCATIONS` | _(not set)_ | `azure` | |
| `STORAGE_AZURE_DRIVER` | _(not set)_ | `azure` | |
| `STORAGE_AZURE_CONTAINER_NAME` | _(not set)_ | blob container name | |
| `STORAGE_AZURE_ACCOUNT_NAME` | _(not set)_ | storage account name | |
| `STORAGE_AZURE_ACCOUNT_KEY` | _(not set)_ | storage account key | Or use managed identity |
| `STORAGE_DRIVER` | _(not set)_ | `azure` | Enables archive tier transitions |
| `PRUNE_STRATEGY` | `delete` | `archive` | Recommended in cloud |
| `PRUNE_ARCHIVE_TIER` | _(not set)_ | `glacier_ir` | Cool tier (millisecond access) |
| `VERSION_RETENTION_ENABLED` | `true` | `false` | Disable if using Azure Function |
| `AZURE_STORAGE_CONNECTION_STRING` | _(not set)_ | connection string | Used by the archive SDK call |

---

## 6. What does NOT need to change

- **`attachmentVersions.js`** — all Directus collection CRUD; Directus abstracts the DB
- **`pruneVersions.js`** — the retention policy (`selectVersionsToPrune`) and `runPruneJob` are pure logic; move as-is
- **`directusVersions.js`** — all REST route handlers
- **`directus.js`** (save handler) — the `createVersion` calls after overwrite saves
- **`directus-cases-page.js`** — the frontend; no storage awareness
- **The Directus collection schema** — `ensureVersionsCollection()` creates it the same way on any DB
- **The TUS upload pipeline** — `tusProxy.js` proxies to Directus; Directus handles storage
- **The version API contract** — all URLs, request/response shapes stay identical

The versioning system never imports a storage SDK directly. The only new import on migration is `@azure/storage-blob` inside the `archiveFile` stub in `fileStorageStrategy.js`.
