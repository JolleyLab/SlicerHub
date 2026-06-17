# GPU Runtime Contract

This document defines the API contract between the control plane (`backend`) and the GPU session plane (`trame-service` runtime).

Goal: allow runtime implementation changes (Docker, process-based, future schedulers) without changing control-plane behavior.

## Scope

- This contract covers only `trame-service` session APIs used by `backend`.
- It does not define frontend routes or nginx routing details.
- Runtime internals may change as long as this contract remains stable.

## Stability Rules

1. Endpoint paths and HTTP methods in this document are considered stable.
2. Existing response fields used by `backend` must remain present and compatible.
3. New optional request/response fields are allowed.
4. Breaking changes require:
   - a versioned path (for example `/api/v2/sessions/...`), or
   - coordinated backend update in the same release.

## Session Endpoints

### `POST /api/sessions/start`

Start a user viewer session.

Request body:

```json
{
  "userId": "string",
  "filePath": "string | null",
  "viewState": "object | null"
}
```

Response body (shape used by backend):

```json
{
  "sessionId": "string",
  "port": 9000,
  "wsUrl": "ws://...",
  "userId": "string",
  "containerName": "string"
}
```

Behavior notes:

- May stop/replace prior active session for the same user.
- `userId` in response is used by backend to construct viewer URL.

---

### `POST /api/sessions/{sessionId}/stop`

Stop a specific session.

Response body:

```json
{
  "status": "stopped",
  "sessionId": "string"
}
```

---

### `POST /api/sessions/{sessionId}/heartbeat`

Extend sliding lease for an active session.

Response body:

```json
{
  "status": "ok",
  "sessionTtlSeconds": 1800,
  "leaseExpiresAt": 0,
  "maxSessionWallSeconds": 28800
}
```

---

### `POST /api/sessions/{sessionId}/save`

Trigger save in the running viewer.

Request body:

```json
{
  "targetFileName": "string | null"
}
```

Response body:

```json
{
  "status": "saved",
  "sessionId": "string",
  "path": "/data/filename.mrb"
}
```

Contract requirement:

- `path` must be present on success and refer to the saved file path from the runtime perspective.

---

### `POST /api/sessions/{sessionId}/apply-view-state`

Apply a view-state payload to a live viewer.

Request body:

```json
{
  "viewState": {}
}
```

Response body:

```json
{
  "status": "applied | failed",
  "sessionId": "string",
  "error": "string",
  "debug": {}
}
```

---

### `GET /api/sessions/{sessionId}/view-state`

Capture current view-state from a live viewer.

Response body:

```json
{
  "viewState": {}
}
```

Contract requirement:

- Must always return a `viewState` object on success path (may be fallback object).

---

### `GET /api/sessions`

List active sessions.

Response body:

```json
{
  "sessions": [
    {
      "sessionId": "string",
      "userId": "string",
      "port": 9000,
      "idleMinutes": 0,
      "leaseExpiresAt": 0,
      "sessionTtlSeconds": 1800,
      "minutesUntilLeaseExpiry": 0
    }
  ],
  "sessionTtlSeconds": 1800,
  "maxSessionWallSeconds": 28800
}
```

Contract requirement:

- `sessions[].sessionId` and `sessions[].userId` are required for backend lookup logic.

## Viewer URL routing

Backend builds browser viewer URLs from session metadata:

- **Docker runtime (default):** `/trame-session/user-{userId}/`
- **Process runtime:** `/trame-session-port/{port}/` on the app host, or `{TRAME_VIEWER_PUBLIC_BASE_URL}/trame-session-port/{port}/` when GPU plane is remote

The GPU API contract itself remains unchanged; only the browser URL path differs by runtime mode.

## Error Contract

- Runtime should return standard HTTP status codes:
  - `404` for unknown session IDs.
  - `503` when runtime dependencies are unavailable (for example GPU runtime/image not ready).
  - `500` for unexpected internal failures.
- Error responses should include a human-readable `detail` or `error` message.

## Current Backend Call Sites

- `backend/src/routes/containers.js`
- `backend/src/routes/files.js`

Any API change must be validated against both call sites.

