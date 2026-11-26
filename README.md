# slicer-web

GPU-enabled web application for file management and medical visualization workflows.

## License

This repository currently includes the existing BSD-3-Clause license in `LICENSE`.

## Runtime Licensing Note (Important)

Some GPU deployment paths use NVIDIA container/runtime components with separate license terms.

- Those runtime terms are separate from this repository's source code license.
- See [`THIRD_PARTY_RUNTIME.md`](THIRD_PARTY_RUNTIME.md) and [`licenses/NVIDIA-NOTICE.md`](licenses/NVIDIA-NOTICE.md) for official NVIDIA license links and GPU image details.

## Setup

See **[DEPLOYMENT.md](DEPLOYMENT.md)**, which covers a fresh install (local or server), updating, and migrating from the Directus version. The short version for local development:

```bash
node scripts/bootstrap.mjs
```

## Testing

Unit tests for the backend and the frontend (`dev/`) use Node's built-in test runner (Node 22+):

```bash
cd tests && npm test
```

`npm test` in `dev/` runs the same suite.

## Frontend

The frontend in `dev/` is Lit web components, served unbundled by es-dev-server (`npm run serve`) in the `frontend` container behind nginx. To check its dependencies' licenses, run `npm run licenses:check` in `dev/`.
