# File storage

## Object keys (all backends)

The database stores **object keys**, not host paths:

```
userFiles/{userId}/{storedName}
```

Example: `userFiles/1/a1b2c3d4-Scene.mrb`

This matches how S3-API object stores address files (`bucket` + key). The control plane never persists absolute paths like `C:\...` or `/app/...`.

## Backends

| `STORAGE_BACKEND` | Today | Notes |
|-------------------|-------|-------|
| `local` (default) | Yes | Files under `backend/userFiles/` on disk |
| `object` | Not yet | S3-API compatible store (MinIO, R2, B2, etc.) |

Contract: `backend/src/storage/contract.js`

## Adding object storage later

1. Implement `backend/src/storage/objectStorage.js` using the contract (any S3-API client + custom `OBJECT_STORAGE_ENDPOINT`).
2. Wire it in `storage/index.js` when `STORAGE_BACKEND=object`.
3. Implement `getPresignedReadUrl()` so GPU nodes pull large scenes directly (see below).

Planned env vars (no AWS account required):

```env
STORAGE_BACKEND=object
OBJECT_STORAGE_ENDPOINT=https://minio.example.com
OBJECT_STORAGE_BUCKET=slicer-files
OBJECT_STORAGE_ACCESS_KEY=...
OBJECT_STORAGE_SECRET_KEY=...
OBJECT_STORAGE_PREFIX=          # optional
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_REGION=us-east-1 # some providers ignore this
```

## GPU file sync

| Storage | Sync path |
|---------|-----------|
| Local | Backend streams → `PUT /api/files/{userId}/{fileName}` on trame |
| Object | Presigned HTTPS URL → `POST /api/files/pull` on trame (GPU fetches directly) |

Both use the per-instance `syncToken` from billing provision. No SSH.
