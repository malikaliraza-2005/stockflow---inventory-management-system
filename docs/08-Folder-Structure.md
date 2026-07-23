# Production Folder Structure

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | FST-IMS-008 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (folder-structure review rating 8.5/10) |
| **Source of truth** | SRS-IMS-001 §13 · BEA-IMS-006 §2 · FEA-IMS-007 §3/§9 — this structure realizes them 1:1 |
| **Review record** | Principal Architect folder-structure audit — 3 minor findings, all resolved (§4) |

---

## 1. Repository Layout

```text
Inventory System/
├── docs/                             # documentation series (immutable approved artifacts)
│   ├── 01-SRS.md
│   ├── 02-System-Architecture.md
│   ├── 03-ERD.md
│   ├── 04-Database-Design.md
│   ├── 05-REST-API-Specification.md
│   ├── 06-Backend-Architecture.md
│   ├── 07-Frontend-Architecture.md
│   ├── 08-Folder-Structure.md        # this document
│   └── adr/                          # Architecture Decision Records (NFR-29):
│                                     # session model, ledger invariant, Archive lifecycle, …
├── client/                           # React frontend (FEA-IMS-007)
└── server/                           # Express backend (BEA-IMS-006)
```

## 2. Frontend — `client/` (FEA-IMS-007 §3/§9)

```text
client/
├── public/                           # static assets: logo, placeholder art (FEV-04);
│                                     # served as-is, hashed refs where imported
├── src/
│   ├── api/                          # single Axios instance + interceptor pair (token attach,
│   │                                 # single-flight refresh/replay, error-envelope mapping);
│   │                                 # typed per-resource clients GENERATED from OpenAPI (NFR-27)
│   ├── assets/
│   │   └── icons/                    # typed React icon components — one tree-shakeable module
│   ├── components/
│   │   ├── ui/                       # domain-blind primitives: Button, Input, Select, Modal,
│   │   │                             # Table (virtualized), Badge, PlaceholderImage, Skeleton, Toast
│   │   ├── layout/                   # AppShell (sidebar + top bar), RequireAuth,
│   │   │                             # ForcePasswordChange gate (FEV-02), RequireRole
│   │   └── domain/                   # one business interaction each: StockMovementDialog,
│   │                                 # AdjustmentDialog, ProductForm, ImageUploader (FEV-01),
│   │                                 # ScannerViewport, QRLabel, ChartPanel, TransactionTable,
│   │                                 # AuditTrailTable   → growth rule: subgroup by feature
│   │                                 #   (domain/products/, domain/inventory/, …) past ~15 files
│   ├── config/                       # validated import.meta.env, fail-fast at bootstrap (FEV-03);
│   │                                 # components never read import.meta.env directly
│   ├── hooks/                        # usePermission, useIdempotencyKey, useQueryState,
│   │                                 # useDebounce, useCamera
│   ├── lib/                          # formatters (money/date/timezone, NFR-33),
│   │                                 # error-code→message table (05 §6.2), constants
│   ├── pages/                        # 14 route targets per SRS §9 — one folder per page,
│   │   ├── Login/  ResetPassword/    # PascalCase = folder names a React component (§5 rule)
│   │   ├── Dashboard/  Products/  ProductDetail/  AddProduct/  EditProduct/
│   │   ├── Scanner/  Categories/  Transactions/  Reports/
│   │   └── Users/  Settings/  Profile/
│   ├── stores/                       # exactly three Zustand stores: authStore, uiStore,
│   │                                 # settingsStore (NFR-25 — server state is page-scoped)
│   └── types/                        # OpenAPI-generated + domain types (TS strict)
└── tests/
    ├── components/                   # Testing Library — domain-component contracts
    ├── hooks/                        # interceptor pair, useIdempotencyKey, useQueryState
    └── e2e/                          # Playwright smoke: login → add product → stock in →
                                      # stock out → ledger check (BR-17 assertion)
```

## 3. Backend — `server/` (BEA-IMS-006 §2)

```text
server/
├── src/
│   ├── config/                       # env schema validation (fail-fast, NFR-28) · db ·
│   │                                 # cloudinary · cors · trustProxy (ARB-01)
│   ├── routes/                       # one router per SRS §12 resource (12 routers);
│   │                                 # path + middleware chain + controller reference ONLY
│   ├── controllers/                  # HTTP concerns only — extract validated input,
│   │                                 # call one service method, shape via serializers
│   ├── services/                     # ALL business rules (BR-01…41): Auth, User, Product,
│   │                                 # Category, Movement ⚠ (change-controlled), Audit,
│   │                                 # Dashboard, Report, Upload
│   ├── models/                       # 8 Mongoose schemas mirroring DBD-IMS-004 §2 + indexes
│   ├── middleware/                   # requestId · httpLogger · rateLimiters · mongoSanitize ·
│   │                                 # authenticate (JWT + per-request user load) ·
│   │                                 # authorize(role) · validate(schema) · errorHandler
│   ├── validation/                   # zod schema per endpoint (SRS §15) — single source
│   │                                 # for boundary validation, incl. blank→absent (PDV-04)
│   ├── serializers/                  # wire contract: Decimal128→string, ObjectId→string,
│   │                                 # ISO-8601 UTC, list envelope, secret-field exclusion
│   ├── errors/                       # typed AppError hierarchy keyed to §16.3 catalog
│   ├── lib/                          # pino logger (correlation children) · ttlCache (A-2) ·
│   │                                 # idempotency helper (ARB-02/A-4) · csvStream · pagination
│   ├── jobs/                         # ledger reconciliation (BR-18) · orphan sweep (BEV-04)
│   │                                 # — leader-guarded via jobLocks TTL lease (A-8/BEV-05)
│   └── seeds/                        # first Admin + settings singleton + Uncategorized (DBD §8)
└── tests/
    ├── unit/                         # service layer — every BR traceable (NFR-26);
    │                                 # MovementService concurrency + replay suites
    ├── integration/                  # per-endpoint auth/validation/error matrix on
    │                                 # ephemeral MongoDB (replica-set mode for T1–T6)
    └── e2e/                          # smoke suite — CI release gate
```

## 4. Review Findings & Resolutions

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | `components/domain/` concentrates growth — dumping-ground risk past ~15–20 files (Minor) | **Written growth rule (§2):** subgroup by feature (`domain/products/`, `domain/inventory/`, `domain/scanner/`…) when the folder exceeds ~15 files. Foldering within the approved tier — not a new tier |
| 2 | Documentation series loose at repo root (Minor) | **Applied:** series moved to `docs/`; root is now `docs/ · client/ · server/` |
| 3 | Mixed folder casing implicit (Minor) | **Convention recorded (§5):** PascalCase exactly where a folder names a React component; lowercase everywhere else |
| — | `docs/adr/` missing — ADRs are requirement-backed (NFR-29) | **Applied:** created; first ADRs due at implementation start (session model, ledger invariant, Archive lifecycle) |

## 5. Conventions & Growth Rules

1. **Casing:** folders naming a React component are PascalCase (`pages/AddProduct/`); all other folders are lowercase. No abbreviations.
2. **Domain growth rule:** `components/domain/` subgroups by feature past ~15 files (Finding 1).
3. **Layer boundaries are physical:** business logic outside `services/`, role checks outside `usePermission`, or model access outside services have no folder to live in — misplacement is visible in review by path alone.
4. **`.gitkeep` placeholders** (44) keep every empty directory alive under version control; delete each as its folder gains real files.
5. **Files that arrive with implementation, not before:** `server/openapi.yaml`, `package.json` × 2, `client/src/router.tsx`, `app`/`server` entrypoints, `tailwind.config`, `.env.example`, `README`, CI workflows (`.github/workflows/`), and `scripts/` if and when a real script exists — creating them empty now was rejected as premature.

## 6. Deliberate Absences (discipline, not gaps)

| Absent | Why |
|---|---|
| `server/src/repositories/` | Documented decision — Mongoose models are the data-access layer (BEA §1.3) |
| `suppliers/` feature folders | Supplier is an embedded value object (OS-2; FE-3 migration path) |
| `notifications/`, `emails/`, `queues/`, `workers/`, `events/` | Out of scope v1 (OS-4); transaction creation is the documented future seam (EXT-03) |
| local `uploads/` / `storage/` | Cloudinary is the media store (SEC-08) — image bytes never touch the server |
| `migrations/` | Schema-on-read + idempotent seeds suffice for v1; revisit with FE-11 archival |
| frontend `features/` slicing, `core/`, `shared/`, `contexts/` | Contradict the approved three-tier component architecture or duplicate existing homes (`lib/`, stores) |

---

*End of document — FST-IMS-008 v1.0 · Approved — Ready for Production · 2026-07-23*