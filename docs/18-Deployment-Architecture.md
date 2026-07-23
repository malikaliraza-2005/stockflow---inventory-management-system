# Deployment Architecture

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | DEP-IMS-018 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (deployment review rating 8.5/10) |
| **Source of truth** | SRS-IMS-001 §18 · ARC-IMS-002 §5 · BEA-IMS-006 §8 · DBD-IMS-004 · SEC-IMS-016 · TST-IMS-017 §6 · AAD-IMS-009 — this document consolidates them and never overrides them |
| **Review record** | Principal Cloud/DevOps audit — Issues 1–3 (incl. one **Critical**) + readiness-flap alert incorporated (§13) |
| **Role** | The single source of truth for deployment, configuration, and operations |

---

## Table of Contents

1. [Deployment Topology](#1-deployment-topology)
2. [Domain Topology (Critical Mandate)](#2-domain-topology-critical-mandate)
3. [Environments](#3-environments)
4. [Frontend Deployment](#4-frontend-deployment)
5. [Backend Deployment](#5-backend-deployment)
6. [Database Deployment](#6-database-deployment)
7. [Configuration Management](#7-configuration-management)
8. [Network Architecture & Security](#8-network-architecture--security)
9. [Observability](#9-observability)
10. [Backup & Disaster Recovery](#10-backup--disaster-recovery)
11. [CI/CD Pipeline](#11-cicd-pipeline)
12. [Operational & Release Checklists](#12-operational--release-checklists)
13. [Review Findings Incorporated](#13-review-findings-incorporated)

---

## 1. Deployment Topology

```text
                          ┌─────────── CI/CD (§11) ───────────┐
                          ▼                                    ▼
┌────────────────────┐  deploy   ┌──────────────────────────────────────┐
│ STATIC HOST / CDN  │           │ APP PLATFORM                          │
│  app.<domain>      │           │  api.<domain>                         │
│  React SPA build   │           │  ┌─────────┐ ┌─────────┐             │
│  hashed immutable  │           │  │ api-1   │ │ api-2   │  … (N ≥ 2   │
│  assets · SPA      │           │  └─────────┘ └─────────┘   in prod)  │
│  fallback routing  │           │   LB + /ready health gate ·          │
│  DOCUMENT headers  │           │   trust-proxy exact hop (ARB-01) ·   │
│  (CSP, HSTS,       │           │   rolling deploys · SIGTERM drain    │
│   frame-ancestors) │           │   jobs: TTL-lease leader (A-8)       │
└─────────┬──────────┘           └───────┬──────────────────┬───────────┘
          │ browser loads SPA            │ TLS, SRV conn     │ signed
          ▼                              │ string, least-    │ upload
   Browser ── /api/v1 (HTTPS, Bearer ────┘ priv user,        │ params
   + auth-scoped cookie) ───────────────▶  IP-allowlist      ▼
          │                        ┌──────────────────┐ ┌──────────────┐
          └── direct upload ──────▶│  MongoDB ATLAS   │ │  CLOUDINARY  │
              (signature-scoped)   │  M10+ prod       │ │  per-env     │
                                   │  3-node replica  │ │  environment │
                                   │  snapshots       │ └──────────────┘
                                   └──────────────────┘
   Observability plane: log sink · error tracking (both tiers) ·
   external uptime monitor → alerts to named operator (AS-19)
```

**Allowed communication paths (exhaustive — the network contract):** browser→CDN (documents/assets) · browser→API (`/api/v1`, HTTPS) · browser→Cloudinary (signed upload + image delivery) · API→Atlas (TLS, IP-allowlisted) · API→Cloudinary (signatures/destroy) · monitors→`/health`,`/ready`. **Nothing else.**

---

## 2. Domain Topology (Critical Mandate — review Issue 1)

The refresh cookie is `SameSite=Strict` (AAD §3.2) — it is **never sent cross-site**. Therefore:

> **The SPA and the API MUST share a registrable domain (eTLD+1)** — e.g., `app.<domain>` + `api.<domain>` — in staging and production. **Platform default domains (different registrable sites) are prohibited for these two origins**: with them, the refresh cookie never flows and every session dies at first token expiry.

- Custom domains + TLS on both origins are **Phase 0 prerequisites** (§12).
- Pinned by an explicit verification step: log in on staging, wait out an access-token expiry, confirm silent refresh succeeds.
- Development uses localhost (same-site by nature).

---

## 3. Environments

| | Development | Staging | Production |
|---|---|---|---|
| Purpose | Local dev; ephemeral test DBs (TST §11) | Release verification: E2E/a11y gates, restore drills, pen-test target | Live operation |
| Atlas | Free/shared tier, own project | Own project, prod-shaped | **M10+ (AS-12)**, own project |
| Cloudinary | Dev environment/folder | Own environment | Own environment |
| Config | Local `.env`; relaxed CORS to localhost | **Config-identical in shape to production (NFR-28)**; distinct secrets | Platform secret manager only |
| Data | Seed + factories; disposable | Seeded per-role accounts (TST); **no production data copies** | Real data; §10 backups |
| Deploy rule | Developer-driven | Every merge, automatic | Health-gated rolling, after staging gates |
| Access | Developers | Developers + operator | Operator-controlled; consoles MFA'd (SEC §7) |

**Naming convention:** `ims-dev` / `ims-staging` / `ims-prod` across platform projects, Atlas projects, Cloudinary environments, and secret namespaces — one name, four systems.

---

## 4. Frontend Deployment

- **Build:** Vite production build; TS strict + lint as pipeline gates; `VITE_` vars injected at build time per environment — **public by definition** (SEC §7); config module fail-fast (FEV-03).
- **Hosting:** static host/CDN at `app.<domain>` with SPA fallback (all paths → `index.html` — SMP deep links); brotli/gzip at the edge.
- **Caching:** hashed assets `Cache-Control: immutable, max-age=1y` · `index.html` `no-cache` — deploys visible immediately, chunks stay cached; post-deploy stale-chunk requests absorbed by the E-2 reload policy (ERR).
- **Headers:** the **document-header set lives here** (SEC §10 split): CSP (`connect-src` = API origin, `img-src` = Cloudinary host), HSTS, `frame-ancestors 'none'`, nosniff, referrer policy.

---

## 5. Backend Deployment

- **Runtime:** Node 20 LTS (A-5); platform-managed processes; ≥ 2 instances in production, 1 elsewhere; `api.<domain>`.
- **Lifecycle (BEA §8):** boot = config-schema validation (fail fast, named variable) → Mongo connect with backoff (`/ready` false meanwhile) → integrity check (settings singleton + ≥ 1 active Admin) → listen. SIGTERM = `/ready` false → drain → close DB → exit 0. Crash = log + track + exit; platform restarts.
- **Scaling:** horizontal by instance count (stateless, NFR-09). Per-instance caveats priced in: rate limits ≈ N× nominal (DB-backed lockout is the global authority) · per-instance dashboard cache within the ≤ 60 s bound (A-2) · jobs leader-guarded across rolling overlap (A-8).
- **Timeouts:** DB ops ≤ 10 s (NFR-20) · platform request timeout ≥ the 30 s client timeout · CSV streams exempted from short idle timeouts (cursor-batched, ERR §7).
- **Health:** `/health` liveness + `/ready` readiness, mounted before all middleware (ARB-04); consumed by the LB, deploy gates, and the uptime monitor.

---

## 6. Database Deployment (Atlas)

- **Connection:** SRV string from secrets; TLS enforced; Mongoose default pool (tuned only on load-test evidence, R-2); retryable writes on; `majority` write/read concern inside transactions (A-1).
- **Access:** one app user per environment, `readWrite` on its own DB only (SEC-11) · network access = platform egress IPs/VPC only, never `0.0.0.0/0` · console access MFA'd, named operators (SEC §7).
- **Retention:** transactions/audit indefinite (AS-16); sessions TTL-expired; snapshots per §10.
- **Growth:** tier bump covers well past NFR-12 volumes; FE-11 archival is the long-horizon path.

---

## 7. Configuration Management

| Kind | Mechanism |
|---|---|
| Build-time (frontend) | `VITE_` vars — public; no secret ever (SEC §7 + CI grep) |
| Runtime (backend) | Platform secret manager env vars, schema-validated at boot (NFR-28); missing/invalid → named-variable abort |
| Inventory | Per SRS §18.4: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, TTLs, `CORS_ORIGIN`, `CLOUDINARY_*`, `SEED_ADMIN_*`, `RATE_LIMIT_*`, `LOG_LEVEL`, tracker DSN; `.env.example` documents names + purpose only |
| Secrets | Per-environment, ≥ 256-bit where cryptographic; documented rotation (JWT rotation forces re-login — accepted); never in repo/artifact/log |

---

## 8. Network Architecture & Security

All §1 paths HTTPS/TLS end-to-end (camera requires it — NFR-35). Trust-proxy set to the **exact platform hop count, verified per environment in Phase 0** (ARB-01/R-4). CORS: exact frontend origin per environment; credentials only on `/auth`. Environment isolation: separate projects/namespaces (§3) — a staging credential opens nothing in production. Deployment least privilege: CI deploy tokens scoped per environment; production deploys only via the pipeline — no console pushes.

---

## 9. Observability

- Structured JSON logs (correlation IDs) → platform log sink; ≥ 30-day retention in production.
- Error tracking on both tiers, scrubbed per ERR §8. Metrics: request rate / p95 / error rate (NFR-23).
- External uptime monitor: SPA origin + `/ready`, alerting the named operator (AS-19, NFR-17).
- **Alert-worthy events:** lockout spikes · token-reuse · reconciliation drift · restore-drill failures · **readiness-flap (N `/ready` transitions in M minutes — earliest symptom of crash-loops and seed deadlocks; review improvement)**.

---

## 10. Backup & Disaster Recovery

- Atlas snapshots: daily minimum (continuous where the tier allows); **RPO ≤ 24 h, RTO ≤ 4 h** (NFR-22).
- **Quarterly restore drill to staging** — drill failure is an S1-class operational defect; an untested backup is treated as no backup.
- Cloudinary assets are provider-redundant; `publicId`s in Mongo make re-linking deterministic.
- **Recovery runbook (ordered):** restore snapshot → boot integrity check passes → run reconciliation (BR-18) → reconcile Cloudinary orphans (sweep) → **production verification set (§11)** → reopen.
- **Ownership:** the named operator (AS-19) owns backups, drills, alerts, and secret rotation — by name.

---

## 11. CI/CD Pipeline (platform-agnostic — SRS §18.3 + TST §6)

```text
PR:      lint → typecheck → unit → component → integration/API (+security,
         DB, jobs) → OpenAPI drift → CVE scan (fail on critical) → build
merge:   auto-deploy staging (seed release-phase → instances) →
         FULL mutating E2E smoke + critical flows → axe state-pass →
         manual gate (operator)
release: seed release-phase (idempotent) → rolling production deploy
         gated on /ready → PRODUCTION VERIFICATION SET (non-mutating)
rollback: redeploy previous artifact, < 15 min (NFR-15); schema-on-read —
         no migration reversal in v1
```

- **Artifacts are immutable and environment-agnostic** — the artifact promoted to production is byte-identical to the one staging verified; config injects at deploy.
- **Seed as release phase (review Issue 3):** the idempotent seed (DBD §8) runs as a release-phase command before new instances start, in every environment — resolves the first-deploy readiness deadlock by design.
- **Verification split (review Issue 2):** **staging** runs the full mutating smoke (creates products, moves stock). **Production post-deploy verification is strictly non-mutating:** `/health` + `/ready` · SPA document loads with correct headers · login with a dedicated smoke account · read-only list/dashboard fetches · logout. **The mutating suite is banned from production** — test artifacts in an append-only ledger are uncleanable by design (FR-TXN-02).

---

## 12. Operational & Release Checklists

**Phase 0 (once per environment):**
1. Custom domains live: `app.<domain>` + `api.<domain>` under one eTLD+1, TLS on both (**§2 mandate**)
2. Staging refresh-cookie verification: login → access-token expiry → silent refresh succeeds
3. Trust-proxy verified with a real client-IP echo (ARB-01)
4. Atlas: network allowlist + least-privilege user confirmed
5. Cloudinary: folder scoping + unsigned presets disabled
6. Dual-origin headers verified (SEC §10) on both origins
7. Console MFA confirmed (Atlas + Cloudinary), named operators only
8. Secret namespace populated; boot config validation passes
9. Seed release-phase executed; integrity check green
10. Uptime monitor live; alert route test-fired

**Every release:** pipeline green through staging gates · zero S1/S2 open (TST §9) · rollback artifact identified before deploy · production verification set green after.

**Quarterly:** restore drill · secret-rotation review · dependency patch cadence check (SEC-12).

---

## 13. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | Cookie/domain topology unstated — platform default domains are cross-site, so the `SameSite=Strict` refresh cookie would never flow: **every session dies at first token expiry** (**Critical** — a cross-document composition failure only the deployment view could expose) | §2 shared-registrable-domain mandate + Phase 0 prerequisites + staging refresh verification |
| 2 | "Post-deploy smoke" in production would write real products and stock movements into the uncleanable append-only ledger (**Major**) | §11 verification split: mutating suite staging-only; non-mutating production verification set |
| 3 | Seed execution mechanics undefined — first production deploy would hit a readiness deadlock resolvable only by an undocumented manual step (Minor) | §11 idempotent seed as a release-phase command in every environment |
| + | Readiness-flap alert (improvement) | §9 — earliest observable symptom of crash-loops and seed deadlocks; monitor already polls the endpoint |

**New-content statement:** beyond these review resolutions, this document's additions are process only — environment naming, the §10 runbook order, and the §12 checklists. Zero architectural impact; everything else cites its approving artifact.

---

*End of document — DEP-IMS-018 v1.0 · Approved — Ready for Production · 2026-07-23*