# Cloud Hosting Plan
**Status:** Active — architecture confirmed (Keycloak + Payload + Infisical bootstrap working locally, Oct 2026)  
**Date:** September 2026  
**Audience:** Technical and non-technical stakeholders

---

## Overview

This document evaluates two cloud hosting options for the medical imaging web application: **Microsoft Azure** and **Amazon Web Services (AWS)**. Both are fully capable of hosting this application. The goal is to present the relevant facts — cost, complexity, and fit — so stakeholders can make an informed decision.

---

## The Application

The application is a web-based platform for medical imaging review and collaboration. It consists of several services that each have different hosting requirements:

| Component | What it does | Hosting need |
|---|---|---|
| Frontend | Web interface served to the browser | Lightweight — static files |
| Backend API | Authenticates users, manages sessions, proxies data | Always-on, moderate compute |
| Payload CMS | Manages cases and collaboration data (replaced Directus) | Always-on, moderate compute |
| Session Manager | Starts and stops 3D viewer sessions on demand | Low compute, occasional bursts |
| Database | Stores users, projects, preferences, case data | Managed, persistent |
| File Storage | Case attachments, imaging data | High capacity, tiered by access frequency |
| Secret Manager | Stores application secrets (Infisical self-hosted → Azure Key Vault) | Always-on, low compute |

**GPU viewers** (3D Slicer, Trame) are **not included** in the app hosting cost model below. Clients (or the org) provide GPU infrastructure. The session manager connects to that plane via configuration — no per-client app rewrite.

**Full Slicer addons** (Sandbox, SlicerHeart, SimplifiedViewer, …) are updated with a **daily host sync** on the GPU machine — not by pushing a new container image to ACR each day. See [slicer-gui-addons.md](./slicer-gui-addons.md) for setup (local now, Hub base later, and Azure N-series shape).

---

## Shared Requirements

Both options meet these requirements:

- **US data residency** — US-region deployments keep all data in the United States
- **HIPAA BAA** — both Azure and AWS offer Business Associate Agreements
- **SSO** — the backend supports any OIDC-compliant identity provider (Okta, Entra, Ping, etc.). The client's existing SSO provider is used — no new identity vendor is introduced. This applies equally to both cloud options.
- **No long-term rewrites** — the existing Docker containers run unchanged on either cloud
- **Database** — Payload CMS (PostgreSQL) is already running in the stack and holds cases and attachments. The remaining SQLite tables (user accounts, sessions, GPU credentials) must be migrated to PostgreSQL before cloud deployment. This is the only remaining structural change; no business logic is affected.

---

## Shared Architecture

Regardless of cloud provider, the services connect the same way:

```
User's browser
    ↓  HTTPS
Entry point (routes requests by URL path)
    ├── /       → Frontend (serves the web app)
    └── /api/*  → Backend API
                    ├── Auth → Keycloak → PostgreSQL
                    ├── Cases → Payload CMS → PostgreSQL
                    ├── Files → Blob / Object Storage
                    └── Viewer sessions → Session Manager → Client GPU cluster
                                                              ↓
                                              3D stream flows directly to browser
```

The entry point and specific storage services differ between the two options; everything else is the same.

---

## Keycloak in Production

Authentication is handled by Keycloak using a **Backend-for-Frontend (BFF) pattern**: the browser submits credentials to the Node.js backend, which verifies them with Keycloak server-to-server. The browser never contacts Keycloak directly.

```
Browser → HTTPS → backend (/api/auth/login)
                       ↓  server-to-server (internal network only)
                   Keycloak
```

This has two practical consequences for cloud deployment:

- **Keycloak does not need a public URL.** It communicates only with the backend over the internal container network. No Cloudflare tunnel, no public DNS entry, no ALB/Front Door rule pointing at Keycloak is required.
- **No nginx or routing changes are needed** when moving from the current Cloudflare-tunnel setup to a cloud deployment. The backend's `KEYCLOAK_URL` env var points at the internal service address (`http://keycloak:8080` in Docker Compose; an internal hostname or private IP in cloud).

### What changes on Azure vs. local

| | Local / physical server (Docker Compose) | Azure (Container Apps) |
|---|---|---|
| Keycloak runs as | A compose service (`--profile keycloak`) | A separate Container App (same environment) |
| Backend reaches Keycloak at | `http://keycloak:8080` (Docker network) | Internal Container Apps FQDN (e.g. `http://keycloak.internal.azurecontainerapps.io`) |
| Admin console access | `http://localhost:8082` (host port) | Not publicly exposed — access via `az containerapp exec` or a bastion |
| Secrets storage | Infisical self-hosted (`http://localhost:8888`); secrets injected via `node scripts/start.mjs` | Azure Key Vault; injected as env vars via Managed Identity |
| Secret injection mechanism | `scripts/start.mjs` fetches from Infisical API and passes to `docker compose` | Platform-native — Container Apps reads from Key Vault references in the app definition |
| Client secret | Written to Infisical by `setup-keycloak.mjs`; fetched at runtime | Stored in Azure Key Vault |

The `setup-keycloak.mjs` provisioning script (`node scripts/setup-keycloak.mjs`) works against any Keycloak instance reachable on the host. In cloud, set `KEYCLOAK_ADMIN_URL` to the temporarily-exposed admin endpoint, run the script once to provision the realm, then remove public exposure.

---

## Option A: Microsoft Azure

### Services

| Azure Service | Role | Est. monthly cost |
|---|---|---|
| Azure Container Apps | Runs backend, Payload CMS, Keycloak, session manager | ~$0–50 (scales to zero) |
| Azure Container Registry | Stores Docker images | ~$5 |
| PostgreSQL Flexible Server | Database | ~$15–50 |
| Azure Blob Storage | File storage | ~$2–10 |
| Azure Key Vault | Secrets management | ~$5 |
| Container Apps Ingress | HTTPS routing — built in | Included |
| **Total (light usage, optimised)** | | **~$50–80 / month** |

### Rollout stages

**Stage 1 — Launch** (~$50–80/month)  
All services in Container Apps. PostgreSQL for the database. Blob Storage for files. HTTPS routing included at no extra cost. Suitable for internal pilots and non-clinical use.

**Stage 2 — Compliance ready** (+~$30–50/month)  
Private Virtual Network and Private Endpoints — data stays off the public internet between services. Azure Monitor for observability. Required before handling real patient data. Enables HIPAA BAA.

**Stage 3 — Enterprise scale** (+~$35–50/month)  
Azure Front Door (CDN, WAF, DDoS protection). Azure Static Web Apps replaces the frontend container. Client SSO connects via OIDC — a backend configuration change, no code changes.

### Cost optimisations

- **Blob SAS tokens** instead of a shared file system — viewers download files directly from Blob Storage via short-lived signed URLs. Removes ~$100/month of provisioned storage (Azure Files Premium) from the estimate above.
- **Blob lifecycle policy** — files move automatically from Hot ($0.018/GB) → Cool ($0.010) → Cold ($0.005) → Archive ($0.002) based on last-access date.
- **Storage Service Endpoints** — free; routes Blob traffic over the Azure backbone rather than the public internet.
- **Log Analytics retention policy** — Azure Monitor charges $2.30/GB ingested. Set a retention policy and filter verbose logs from day one to avoid uncontrolled growth.

### Setup complexity

Azure Container Apps handles HTTPS routing and secrets access natively — there is no separate load balancer or credential configuration required. Private networking at Stage 2 is configured per-service via Private Endpoints. Overall, the number of moving parts to configure is lower than AWS, which is the main operational difference between the two options.

---

## Option B: Amazon Web Services (AWS)

### Services

| AWS Service | Role | Est. monthly cost |
|---|---|---|
| Amazon ECS on Fargate | Runs backend, Payload CMS, Keycloak, session manager | ~$0–60 (scales to zero) |
| Amazon ECR | Stores Docker images | ~$5 |
| Application Load Balancer | HTTPS routing — required separately | ~$16–20 |
| Amazon RDS for PostgreSQL | Database | ~$15–50 |
| Amazon S3 | File storage | ~$2–10 |
| AWS Secrets Manager | Secrets management | ~$5–8 |
| **Total (light usage, optimised)** | | **~$65–100 / month** |

### Rollout stages

**Stage 1 — Launch** (~$65–100/month)  
All services in ECS on Fargate. PostgreSQL on RDS. S3 for files. An Application Load Balancer is required separately for HTTPS routing. AWS Copilot (a CLI tool from AWS) automates most of the initial configuration.

**Stage 2 — Compliance ready** (+~$20–40/month)  
VPC with private subnets, NAT Gateway, and VPC Endpoints. CloudWatch and X-Ray for observability. Required before handling real patient data. Enables HIPAA BAA.

**Stage 3 — Enterprise scale** (+~$20–40/month)  
CloudFront CDN and WAF. AWS Amplify Hosting replaces the frontend container. Client SSO connects via OIDC — a backend configuration change, no code changes.

### Cost optimisations

- **Presigned S3 URLs** instead of Amazon EFS — same approach as Azure. Viewers download directly from S3. Removes shared file system cost.
- **S3 lifecycle policy** — Standard ($0.023/GB) → Infrequent Access ($0.013) → Glacier Instant ($0.004) → Deep Archive ($0.001).
- **S3 Gateway VPC Endpoint** — free; routes S3 traffic off NAT Gateway. Essential at Stage 2.
- **Fargate Spot** for non-critical services (session manager, frontend) — up to 70% discount with interruption risk. Not suitable for the backend, Payload CMS, or Keycloak.
- **CloudWatch log retention** — $0.50/GB ingested. Set a retention policy from day one.

### Setup complexity

AWS requires explicit configuration of several components that Azure handles automatically: IAM task roles for secrets access, security groups for network traffic, and an Application Load Balancer for routing. AWS Copilot reduces this significantly, and the patterns are well-documented. Teams with existing AWS experience will find this straightforward; teams starting from scratch face a steeper initial learning curve. AWS has a larger community and more available engineers with platform experience, which is an advantage if dedicated infrastructure support is needed.

---

## Comparison

### Infrastructure cost (optimised)

**Light usage (Stage 1)** — small team, a few active sessions per day, under 100 GB of files. No private networking or CDN yet.

| Component | Azure | AWS |
|---|---|---|
| App containers (backend, Payload CMS, Keycloak, session manager — mostly idle) | ~$0–50/mo | ~$0–60/mo |
| HTTPS routing / entry point | Included | ~$16–20/mo (ALB) |
| Database (small instance) | ~$15–50/mo | ~$15–50/mo |
| File storage (<100 GB, mostly hot) | ~$2–10/mo | ~$2–10/mo |
| Secrets management | ~$5/mo | ~$5–8/mo |
| Monitoring / logging (low volume) | ~$5–15/mo | ~$5–10/mo |
| **Light usage total** | **~$50–80/mo** | **~$65–100/mo** |

**Heavy usage (Stage 3)** — 50+ active clinicians, many concurrent sessions, 1–5 TB of case data, high API traffic. Includes private networking and CDN.

| Component | Azure | AWS |
|---|---|---|
| App containers (scaled up, multiple replicas) | ~$150–300/mo | ~$200–350/mo |
| Database (larger instance) | ~$100–200/mo | ~$100–200/mo |
| File storage (1–5 TB, mixed tiers) | ~$30–100/mo | ~$30–100/mo |
| Entry point / CDN (Front Door / CloudFront) | ~$50/mo | ~$30–50/mo |
| Private networking | ~$20–30/mo | ~$30–50/mo |
| Monitoring / logging (high volume) | ~$50–100/mo | ~$30–50/mo |
| **Heavy usage total** | **~$400–780/mo** | **~$420–800/mo** |

At heavy usage the cost difference between the two platforms narrows significantly — database and compute size become the dominant driver, and these scale identically on both. The Stage 1 routing cost difference ($15–20/month) becomes negligible relative to overall spend.

**Per-stage additions** (for reference when planning incremental rollout):

| Stage | Azure | AWS |
|---|---|---|
| Stage 1 (baseline) | ~$50–80/mo | ~$65–100/mo |
| Stage 2 adds (private networking + monitoring) | +~$30–50/mo | +~$20–40/mo |
| Stage 3 adds (CDN + WAF + SSO config) | +~$35–50/mo | +~$20–40/mo |

### Key factors

| Factor | Azure | AWS |
|---|---|---|
| HTTPS routing | Built into Container Apps — no extra service | Requires a separate Application Load Balancer |
| Secrets access from containers | Managed Identity — no credential config | IAM task role + Secrets Manager policy required |
| Private networking (Stage 2) | Service Endpoints, Private Endpoints | VPC, subnets, NAT Gateway, route tables, security groups |
| Scale to zero | Default behaviour | Requires an explicit Auto Scaling policy |
| Client SSO (Okta, Entra, Ping, etc.) | OIDC config in backend — same on either cloud | OIDC config in backend — same on either cloud |
| Community and documentation | Good | Larger; more tutorials and third-party tooling |
| HIPAA BAA | Available | Available |
| US data residency | Supported | Supported |
| Existing AWS workloads at client | Re-platforming effort | Existing patterns reusable |
| Existing Azure workloads at client | Existing patterns reusable | Re-platforming effort |

---

## User Experience: Cold Starts

Both options scale to zero when idle, which means the first user after a quiet period (overnight, weekends) may experience a delay while services restart.

| Service | Typical cold start |
|---|---|
| Frontend | ~3–5 seconds |
| Backend API | ~4–8 seconds |
| Payload CMS | ~10–20 seconds |
| Keycloak | ~15–25 seconds |

**Free mitigation (applies to either cloud):**

1. The frontend loads in 3–5 seconds and immediately fires a silent background request to wake the backend and Payload CMS.
2. An identifier-first login flow (email screen → password screen) adds 8–15 seconds of natural interaction time, hiding most of the warm-up behind typing.
3. By the time the user clicks Sign In, services are typically warm.

**Paid mitigation:** Set minimum 1 replica on the backend, Payload CMS, and Keycloak (~$50/month on either cloud). Eliminates cold starts entirely.

The identifier-first login pattern is also the standard pattern for client SSO: after the user enters their email, the system detects the SSO configuration for that domain and redirects automatically — no password screen needed.

---

## Factors to Consider When Deciding

### Setup effort

**Azure Stage 1** can realistically be deployed in 1–3 days by a developer with no prior Azure experience. Container Apps, the database, and storage are configured in one environment with a consistent model. HTTPS, routing, and secrets access work out of the box.

**AWS Stage 1** realistically takes 3–7 days for a developer starting fresh. The additional components — load balancer, IAM task roles, security groups — each require separate configuration and must be correctly connected. AWS Copilot (a CLI tool) automates a significant portion of this and is recommended. With prior AWS experience, this drops to a similar timeframe as Azure.

Both timelines assume Stage 1 only. Stage 2 private networking adds roughly the same effort on either platform: 1–3 days to configure and verify correctly.

### Ongoing maintenance

Both platforms require similar routine maintenance: updating container images when dependencies change (roughly monthly), reviewing monitoring alerts, and managing database backups (automated on both).

Where they differ day-to-day:

- **Azure** has fewer configuration files to keep in sync. HTTPS certificates renew automatically. Secrets and network access are managed through Managed Identity — no credential rotation required for service-to-service calls.
- **AWS** requires periodic review of IAM policies and security group rules, which can drift over time as the application evolves. Adding a new API path, for example, may require an ALB routing rule update. These are manageable tasks but represent ongoing configuration work that does not exist on Azure.

### Infrastructure ownership

If infrastructure will be a dedicated role: AWS has a larger talent pool of engineers with platform certifications, and its ecosystem of third-party tooling is more mature. This makes AWS the more straightforward hire.

If infrastructure will be managed by the development team alongside application work: the lower number of moving parts on Azure reduces the likelihood of configuration errors and the time spent diagnosing them.

### Existing cloud footprint

If the organisation or its clients already operate on one platform, the existing network configurations, IAM patterns, and operational familiarity are directly reusable. Starting on the opposite platform from an existing footprint is not a blocker, but it eliminates a meaningful advantage.

### Logging and observability

Both platforms provide adequate logging and monitoring for this application. The practical difference is cost and initial setup friction.

AWS CloudWatch charges $0.50/GB ingested and is straightforward to get started with — ECS integrates automatically and logs appear with minimal configuration. Azure Monitor / Log Analytics charges $2.30/GB ingested (roughly 4× more expensive) and has a steeper initial learning curve. At low log volumes the dollar difference is small, but at heavy usage unmanaged Azure logging costs can grow significantly faster. Both platforms allow log filtering and retention policies to control this; the discipline to apply them is more important on Azure due to the pricing gap.

If detailed observability is a priority from day one, this is a meaningful advantage for AWS. For this application at Stage 1, both are manageable.

### Healthcare and research grant programs

Both providers have publicly documented credit and grant programs relevant to healthcare and research applications. Eligibility varies by organisation type (nonprofit, academic institution, research-funded entity) and application.

**AWS:** The [NIH STRIDES Initiative](https://datascience.nih.gov/strides) is a formal partnership between the National Institutes of Health and AWS (as well as Google Cloud) that provides discounted or credited cloud access to NIH-funded researchers. AWS also offers research credits independently of NIH, and startup credits through AWS Activate. If the application or its users have NIH funding affiliations, STRIDES is worth investigating directly.

**Azure:** Microsoft offers the [Azure for Research](https://www.microsoft.com/en-us/research/academic-program/microsoft-azure-for-research/) program and the [AI for Health](https://www.microsoft.com/en-us/ai/ai-for-health) initiative, both of which provide credits for qualifying healthcare and research projects. Microsoft also has nonprofit pricing tiers through the Microsoft Nonprofit Program.

Both programs have application processes and specific eligibility criteria not fully detailed in public documentation. A direct conversation with each provider's healthcare team is the most reliable way to determine what applies to this project.

### Switching cost

Both options run the same Docker containers and the same PostgreSQL database. Migrating between clouds is a configuration exercise — rewriting infrastructure setup, not application code. At Stage 1 scale this is approximately 20–40 hours of work. The longer the deployment runs and the more infrastructure is built on one platform, the higher this cost becomes.

---

## Appendix: Client GPU plane (Full Slicer) and Azure

The tables above cover the **application** cloud. Full Slicer seats run on a **GPU host** that the org or client operates. Addon updates use a host directory sync, not daily image publishes.

### Pattern (all clouds)

1. Rare: build/pull `SLICER_GUI_IMAGE` (adapter on top of local or Hub Slicer base).  
2. Daily: run `slicer-gui-gpu/sync-slicer-addons` on the GPU host → `data/slicer-addons/`.  
3. New seats mount that tree so all users share the same snapshot.

Details, cron, webhooks, and env vars: **[slicer-gui-addons.md](./slicer-gui-addons.md)**.

### What it looks like on Azure hardware

| App cloud (this plan) | GPU plane (separate) |
|---|---|
| Container Apps, ACR, PostgreSQL, Blob, Key Vault | **NVIDIA VM** (e.g. NCasT4_v3 / NC / NV) with Docker + NVIDIA Container Toolkit |
| Holds backend that *starts* sessions | Holds `SLICER_GUI_IMAGE`, `data/slicer-addons`, per-user seat data |
| ACR stores app images | ACR (or the same registry) stores **base/adapter** images only when those change |
| No daily rebuild for Sandbox/SimplifiedViewer | **cron / Automation / Run Command / GitHub → SSH** runs sync on the VM |

Outbound HTTPS from the GPU VM is required during sync (Extension Index + git). Seats that successfully mount the sync tree do not need to talk to the Extension Index at start.

Vast.ai or on-prem NVIDIA boxes use the same sync scripts; only the VM/provider differs.

---

## Secrets Management

Application secrets (database passwords, API keys, JWT signing keys) are never stored in plaintext `.env` files in the repository or on the server. The architecture uses a secrets manager at every stage:

| Stage | Secrets manager | Injection mechanism |
|---|---|---|
| Local dev | Infisical self-hosted (Docker Compose service) | `node scripts/start.mjs` fetches secrets and injects as env vars before `docker compose` |
| Physical server (current prod) | Infisical self-hosted (same stack) | Same `start.mjs` wrapper, same workflow |
| Azure (future) | Azure Key Vault + Managed Identity | Platform-native: Container Apps reads Key Vault references; no wrapper script needed |
| AWS (future) | AWS Secrets Manager + IAM role | Platform-native: ECS task definition references Secrets Manager ARNs |

**Swap-out path:** application code reads `process.env.*` throughout. When moving to Azure/AWS, replace `scripts/start.mjs` with platform-native secret injection. No application code changes.

**What stays in `.env`** (non-sensitive config, not secrets):
- Service URLs, timeouts, feature flags
- `INFISICAL_ENCRYPTION_KEY`, `INFISICAL_AUTH_SECRET` — Infisical bootstrap vars (cannot be circular)
- `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` — machine identity for the bootstrap tooling
- Profile selection (`COMPOSE_PROFILES`)

See [secrets-management.md](./secrets-management.md) for the full architecture and migration runbook.

---

## Next Steps

| Decision | Options |
|---|---|
| Cloud provider | Azure / AWS |
| Stage to launch at | Stage 1 in both cases |
| Cold start handling | Identifier-first login (free) / minimum replicas (~$35/month) |
| PostgreSQL migration | Before cloud deployment recommended — easier with less data |
| SSO | When first client requires it — OIDC config only, no code changes |
| GPU / Full Slicer addons | Client GPU host + daily sync — [slicer-gui-addons.md](./slicer-gui-addons.md) |

---

*Cost estimates are based on light usage and current public pricing. Actual costs vary with traffic and data volume.*
