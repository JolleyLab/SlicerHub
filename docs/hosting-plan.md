# Hosting Plan

## Current hosting

The application runs as a Docker Compose stack on a physical machine, exposed to the internet through a Cloudflare Tunnel. Nothing in the infrastructure is fixed — we are open to refactoring based on your recommendations. Current usage is research-scale with a small number of users, but we are planning for growth.

## Deployment model

We anticipate that we will likely need multiple deployment scenarios rather than a single shared instance. Some use cases will require the application to be hosted entirely within the contracting institution's own cloud infrastructure, with strict data residency requirements. Other use cases will be research-oriented, where the goal is to share data and collaborate across institutions. The architecture will ideally support both: a self-contained deployable stack for institutional hosting, and a shared research instance for cross-institutional use. This is an important consideration when evaluating identity, data isolation, and storage architecture.

## Existing components

### Reverse proxy — nginx

All inbound traffic enters through an nginx container. It routes API calls to the Node.js backend, the SPA to the frontend container, viewer sessions to on-demand containers, and SlicerWeb static assets. nginx also handles WebSocket upgrades for the interactive viewer connections and passes the large TUS upload chunks without buffering.

### Frontend — Lit

Single-page application built with web components, served from a dev server container. No server-side rendering.

### Backend API — Node.js/Express

Runs in Docker and acts as a BFF (backend-for-frontend): the frontend only ever talks to this service, never to Payload or Keycloak directly. It owns:

- **Authentication and sessions** — issues its own JWT session cookies after verifying credentials with Keycloak as the identity provider. Keycloak tokens are never exposed to the browser.
- **GPU session lifecycle** — provisions and tears down non-native viewer containers (Trame, Full Slicer), manages session leases and heartbeats, and proxies GPU viewer WebSocket connections.
- **File serving** — handles attachment downloads and content requests.
- **Email dispatch** — sends transactional email (invitations, registration notices) via nodemailer/SMTP.
- **Case and data API** — handles case management, collaborators, task groups, and registration requests, backed by Payload CMS via its Local API.

### CMS / data layer — Payload CMS

Payload CMS runs embedded within the backend service and owns the primary application data: cases, collaborators, file metadata, comments, registration requests, and task groups. Data is stored in a Postgres database. The backend communicates with Payload through its Local API (in-process), with no additional HTTP hop. A separate Payload admin UI is available for internal administration.

### File storage

Anonymized medical imaging files are uploaded via the TUS resumable upload protocol, which handles large files and unreliable clinical connections. File bytes are written to object storage and metadata is tracked in Payload. As the platform grows, we anticipate a need for long-term file retention with tiered storage — frequently accessed files kept hot and older or inactive cases moved to cheaper cold storage.

### Email — SMTP

The backend dispatches transactional email (case invitations, registration notices) through nodemailer. Production SMTP is configured via environment variables and is currently using ReSend. This can be swapped for another SMTP provider at any time.

### Authentication — Keycloak

Custom registration and approval workflow backed by Keycloak as the identity provider. The backend acts as a BFF, exchanging Keycloak credentials for its own session cookies — the SPA never holds Keycloak tokens directly. Hospital SSO via SAML/OIDC is a near-term requirement; Keycloak natively supports federation with institutional IdPs, so the foundation is already in place.

### Web viewer — SlicerWeb

A prebuilt static site (in-browser medical imaging viewer) served from local disk by nginx. Runs entirely client-side after load.

### Interactive GPU sessions

The application requires support for on-demand, GPU-accelerated 3D Slicer sessions launched per user. The backend manages container lifecycle and session proxying. This capability exists as a proof-of-concept and has not been fully implemented; the architecture will need to accommodate bursty, on-demand GPU workloads. Most of these workloads are on-demand, concentrated during working hours, so it would be important to find a solution that would allow us to pay based on used minutes and not for 24/7. A dynamic scaling plan based on demand would also be a requirement.

#### Full Slicer desktop

A separate slicer-gui Docker image runs a full 3D Slicer desktop accessible via noVNC in the browser. Sessions are per-user, on-demand, and GPU-accelerated via NVIDIA drivers on the host.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | Lit Element (web components), ES modules, no framework |
| Reverse proxy | nginx |
| Backend API | Node.js, Express |
| Identity provider | Keycloak (OIDC) |
| CMS / data layer | Payload CMS (Postgres, Local API) |
| File uploads | TUS protocol (resumable uploads) |
| Authentication | JWT session cookies, Keycloak |
| Email | nodemailer, ReSend (SMTP) |
| Containerisation | Docker, Docker Compose |
| Public access | Cloudflare Tunnel |
| Web viewer | SlicerWeb (in-browser, client-side) |
| Desktop viewer | noVNC (browser-accessible full Slicer desktop) |
| GPU sessions | Docker container per session, gRPC for viewer communication (PoC) |
| Communication protocol | REST (external), gRPC (internal viewer sessions) |

## Additional nice-to-haves

- Information relevant to SSO and security posture as we grow
- Audit logging and application monitoring — we have minimal observability today and would welcome recommendations on what Azure tooling could cover this
- Cost predictability matters. We are not at enterprise scale today, but want to make architecture decisions that hold as usage grows.
