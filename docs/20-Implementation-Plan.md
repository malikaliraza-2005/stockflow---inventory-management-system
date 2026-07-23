# Feature-by-Feature Implementation Plan

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | IMP-IMS-020 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (implementation review rating 8.5/10) |
| **Source of truth** | All nineteen approved artifacts — this plan is the **execution layer**: tasks are pointers into BEA §5 (endpoint bindings), UCA (component contracts), VAL §3/§5 (schemas), DBD §2/§4 (models, boundaries), TST (tiers), AAD/SEC (rules), RDM (phases). Nothing a source document owns is restated; nothing new is introduced |
| **Review record** | Principal Architect / Tech Lead audit — Issues 1–3 + the first-consumer law incorporated (§6) |
| **Governing law** | **First-consumer rule:** no shared component, service, or job may be scheduled later than its first consumer. Violations found during implementation are sequencing defects to fix in this plan — never local workarounds |

---

## Table of Contents

1. [The Standard Task Pipeline](#1-the-standard-task-pipeline)
2. [Feature Implementation Matrix (F1–F11)](#2-feature-implementation-matrix-f1f11)
3. [Cross-Feature Dependency Diagram](#3-cross-feature-dependency-diagram)
4. [Per-Feature Completion Checklist](#4-per-feature-completion-checklist)
5. [Universal Checkpoints & Integration Points](#5-universal-checkpoints--integration-points)
6. [Review Findings Incorporated](#6-review-findings-incorporated)

---

## 1. The Standard Task Pipeline (defined once — every feature runs it)

**Order rationale:** contract-first (schema → model → service → route) makes each layer testable the moment it exists; the frontend starts only when its typed client is generated; tests are written *with* each task, never after (TST shift-left).

| # | Task | Completion criteria (universal) |
|---|---|---|
| T-a | **Validation schemas** — the feature's VAL §3/§5 rows as zod modules (server + client mirror) | Appendix-A boundary vectors pass |
| T-b | **Model / DB** — DBD §2 fields + indexes + JSON validators for touched collections | Index behavior + validator-rejection tests green |
| T-c | **Service** — the feature's BR set; transaction boundaries per DBD §4 | Every BR traceable to a named unit test (`BR-xx__…`) |
| T-d | **Routes + controllers** — per-endpoint middleware chain per the BEA §5 binding row | Integration matrix rows green: auth × role × validation × declared errors × success shape |
| T-e | **OpenAPI + types** — contract updated; client types regenerated | CI drift check green |
| T-f | **Frontend data layer** — typed client calls, `useQueryState` wiring, store touchpoints (SMA map) | Hook tests green |
| T-g | **UI components** — the feature's UCA contracts; states per WIR frames | Component tests: every specified state rendered |
| T-h | **Pages + routing** — SMP routes, guards, URL params | Guard + URL round-trip tests green |
| T-i | **Error handling** — the feature's §16.3 codes wired through `errorMap` to WIR states | Each declared code renders its designed state |
| T-j | **E2E** (where the feature owns a critical flow) | Flow green on staging |
| T-k | **Docs** — ADR if due (NFR-29); spec deltas via each source's evolution rule | Review label satisfied |

---

## 2. Feature Implementation Matrix (F1–F11)

### F1 — Authentication & Sessions *(Phase 1)*

| Aspect | Reference |
|---|---|
| Purpose / SRS | §3.1; UC-01…03 |
| Depends on | P0 foundations only (first feature) |
| Endpoints | `05` §7.1 — all five `/auth` routes |
| DB | `users` (credential fields) · `refreshTokens` (DBD §2.1/2.5) |
| Frontend | Login, ResetPassword, ForcePasswordChange screen · interceptor pair · guard spine · `authStore` full · `settingsStore` hydration — **FCM-01 lands here; ratify before T-d** |
| **AuditService core (review Issue 2)** | **Insert-only writer + the security-event path land here** — F1's own acceptance suite requires `LOGIN_FAILED`/`LOCKOUT`/`TOKEN_REUSE_DETECTED` events |
| Rules / codes | AAD entire · VAL §3.1 · `UNAUTHORIZED, ACCOUNT_LOCKED, ACCOUNT_DEACTIVATED` |
| Feature tasks | Rotation + family revocation · single-flight interceptor · dummy-hash timing defense · lockout with injected clock |
| Tests | AAD §11 suite complete · interceptor hooks · login + reset/forced-change E2E |
| **Acceptance** | Both roles authenticate on staging via the real domain topology; all adversarial tests green; refresh survives token expiry (DEP §2 verification) |

### F2 — User Management *(Phase 1)*

Purpose §3.2 · needs F1 · endpoints `05` §7.2 (all seven) · DB `users` lifecycle fields · UI: Users page, `UserFormModal`, `ResetLinkModal` + **`DataTable` core, `SearchInput`, `Pagination` (first consumers)** · **AuditService entity-diff path (`changes[]`, `entityLabel`/DN-4) lands here — user updates are its first consumer (review Issue 2)** · rules BR-29…31, T6 · codes `LAST_ADMIN` + duplicate email · tests: T6 concurrent-demotion race, matrix rows, reset-link path · **Acceptance:** Admin provisions a Staff account that works immediately; last-admin unviolable under the race test; role changes appear in audit data.

### F3 — Categories *(Phase 2)*

Purpose §3.4 · needs F2 (`DataTable`) · endpoints `05` §7.4 · DB `categories` (collation index) · UI: Categories page, `CategoryFormModal`, `ReassignDeleteModal` · rules BR-26…28, T5; collation-aware name queries live only in CategoryService · audit: consumes F2's diff path · code `CATEGORY_IN_USE` · tests: delete-vs-assign race, collation duplicate vectors · **Acceptance:** Uncategorized undeletable; reassign-and-delete atomic under race.

### F4 — Products *(Phase 2)*

| Aspect | Reference |
|---|---|
| Purpose / SRS | §3.3 · needs F3 (category refs) |
| Endpoints | `05` §7.3 — all eight incl. lookup, archive/restore, hard delete |
| DB | `products` + `counters` |
| UI | Products / Detail / Add / Edit pages · `ProductForm` · `StockStatusBadge` · `ProductRowCard` · `QRLabel` |
| **`recordInitial` — MovementService's first slice (review Issue 1)** | **The T2 path (INITIAL transaction insert + quantity set, one atomic multi-document transaction) is implemented inside `MovementService` in this feature** — no conditional guard needed (the product is new). The invariant `quantity == Σ ledger` holds from the first product ever created; nothing is stubbed. **The architecture-review label applies to `MovementService` from F4 onward** |
| Rules / codes | BR-01…10, 21…25 · T2/T3/T4 · `DUPLICATE_SKU/BARCODE, STALE_WRITE, PRODUCT_ARCHIVED` · search per D-1 (or the P0-checked fallback) |
| Tests | SKU normalization vectors · version conflict · archive/hard-delete races · lookup precedence · `recordInitial` atomicity |
| **Acceptance** | Full catalog lifecycle on staging; lookup precedence correct; plans COLLSCAN-free; every seeded product's ledger sums to its quantity |

### F5 — Product Images *(Phase 2)*

Purpose FR-PROD-06 · needs F4 · endpoints `05` upload rows · DB `products.images` · UI: `ImageUploader` (FEV-01), `PlaceholderImage` everywhere · rules BR-36…38, DBR-03, VAL Issue 4 (folder/host pinning) · tests: failure isolation (save proceeds), destroy-on-remove, publicId/URL rejection vectors · **Known accepted window (review Issue 3):** orphaned staging assets accumulate until F6's sweep lands — do not fix ad hoc · **Acceptance:** a failed upload never blocks a save; no orphan path exists unswept once F6 lands.

### F6 — Stock Movements & Adjustments *(Phase 3 ⚠ change-controlled)*

| Aspect | Reference |
|---|---|
| Purpose / SRS | §3.5; UC-08/09 — **the core**. Extends F4's `recordInitial` module with T1 |
| Endpoint | `POST /inventory/movements` — the validate-before-authorize exception (AAD §5.2) |
| DB | `transactions` full (append-only, sparse idempotency index) · `jobLocks` (infra, BEV-05) |
| UI | `StockMovementDialog` (incl. Step 0 `ProductPicker`) · `AdjustmentDialog` · `useIdempotencyKey` · Transactions page ledger tab |
| Rules | BR-11…20 · T1 with A-1 concerns · ARB-02 replay (idempotency helper in `lib/` **before** the service) · DES-1 verification (no mutation surface) |
| Jobs (T-c siblings) | Lease guard (A-8) · reconciliation (BR-18, ARB-05) · orphan sweep (BEV-04 — closes F5's window) |
| Codes | `INSUFFICIENT_STOCK, IDEMPOTENCY_CONFLICT, PRODUCT_ARCHIVED` |
| Tests | The deepest set: parallel-T1 concurrency · replay/conflict · injected-failure atomicity · jobs group (TST §4) · **E2E smoke completed to the ledger-sum assertion** |
| **Acceptance** | **M3 hard gate:** the invariant holds under the concurrency suite; architecture-review label on every diff |

### F7 — Ledger & Audit Views *(data F1–F6 · UI P3 + P5)*

Purpose §3.8 · needs F6 (ledger rows), F1/F2 (audit data) · endpoints `/transactions`, `/audit-logs` · UI: Transactions page — ledger tab (P3), Audit Trail tab with `DataTable` expansion (P5, expansion's first consumer) · rules FR-TXN-01…06, DN-4, PDV-01 closed enum · tests: filter matrix rows, archived-badge rendering (EC-16), expansion a11y · **Acceptance:** any quantity explainable from the ledger UI; any price/role change attributable in the audit tab.

### F8 — Scanning *(Phase 4)*

Purpose §3.6 · needs F6 (dialogs), F4 (lookup — already live; frontend-dominant feature) · UI: Scanner page, `ScannerViewport` machine, `ManualCodeEntry`, `ScanResultCard` (incl. post-movement flash), create-from-barcode route state · rules BR-16, FR-SCAN-01…07, EC-20/21 · code `INVALID_BARCODE` · tests: machine transitions, payload-hostility vectors, E2E via manual entry, **R-1 device matrix** · **Acceptance:** scan-to-movement ≤ 3 interactions on matrix devices; every failure state renders its named UI.

### F9 — Dashboard *(Phase 5)*

Purpose §3.7 · needs F6 · endpoint `/dashboard/summary` · UI: Dashboard page, `KpiCard`, `StockAlertList`, `RecentTransactions`, lazy `ChartPanel` (first consumer), quick actions (context-free movement via F6's Step 0) · rules NFR-11/A-2 cache, BR-25 `asOf` · tests: aggregate correctness vs factory data, staleness bound, range-param validation · **Acceptance:** within NFR-02 at dev-scale; every alert deep-links to its pre-filled action.

### F10 — Reports & Export *(Phase 5)*

Purpose §3.10 · needs F6/F7 (ledger-derived, BR-40) · endpoints `05` reports rows (six + export) · UI: Reports page, URL-param selector, CSV download with abort toast · rules FR-RPT-01…06, ERR §7 streaming policy, Admin export gate · tests: date-span vectors, export-abort simulation, Staff-export 403, drift rendering · **Acceptance:** re-running a past-period report is byte-identical (BR-40); a truncated-but-complete-looking export is impossible.

### F11 — Settings *(store F1 · UI Phase 2)*

Purpose §3.11 · endpoints `/settings` GET/PUT · UI: Settings page (Admin) · rules BR-41, audited changes (consumes F2's diff path), DN-3 copy semantics · tests: audit-on-change, threshold propagation to *new* products only · **Acceptance:** edits audited; existing products unaffected (DN-3 verified).

---

## 3. Cross-Feature Dependency Diagram

```text
F1 Auth (+AuditService core) ──▶ F2 Users (+diff path, DataTable core)
        │                              │
        └── settingsStore (F11 store)  ▼
                                 F3 Categories ──▶ F4 Products ──▶ F5 Images
                                                     │ (recordInitial =
                                                     │  MovementService slice 1)
                                                     ▼
                                       F6 Movements ⚠ (T1 + jobs; closes F5 window)
                                            │
                            ┌───────────────┼──────────────────┐
                            ▼               ▼                  ▼
                       F8 Scanning     F9 Dashboard      F7 Ledger/Audit UI
                                            └──▶ F10 Reports ◀─┘

First consumers (the governing law): DataTable/SearchInput/Pagination → F2 ·
AuditService core → F1 · diff path → F2 · recordInitial → F4 · dialogs → F6 ·
expansion → F7 · ChartPanel → F9 · ImageUploader → F5
Infrastructure (all features): P0 primitives, error catalog, interceptor,
generated types, seed.
```

---

## 4. Per-Feature Completion Checklist (applied to every F1–F11)

```text
□ Validation schemas green against Appendix-A vectors        (T-a)
□ Models / indexes / validators tested                       (T-b)
□ Every feature BR has a named passing test                  (T-c)
□ All binding-table rows green in the integration matrix     (T-d)
□ OpenAPI drift check green; types regenerated               (T-e)
□ Component states per WIR/UCA all rendered in tests         (T-f/g)
□ Routes, guards, URL params round-trip                      (T-h)
□ Every declared error code renders its designed state       (T-i)
□ Owned E2E flow green on staging                            (T-j)
□ Security placement verified vs SEC-016 §2                  (checkpoint)
□ A11y assertions for new interactive states                 (checkpoint)
□ ADR filed if due · traceability script green               (T-k)
□ PR reviewed (+ architecture label where required)          (checkpoint)
```

---

## 5. Universal Checkpoints & Integration Points

**Quality checkpoints (every feature):** PR review — `MovementService` diffs require the architecture-review label from F4 onward · security placement vs SEC-016 §2 · a11y assertions for new interactive states · no business-rule coverage regression · traceability script green for the feature's IDs.

**Integration points (every feature):** AppShell navigation (SMP §3) · `usePermission` gating (FD-3) · toasts/confirms via `uiStore` facades · correlation-ID error path (ERR §5) · serializer wire contract · URL-state conventions (SMP §4).

---

## 6. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | The F4→F6 `INITIAL` seam was marked but unspecified — a naive stub would ship products violating `quantity == Σ ledger` for weeks, and back-filling an append-only ledger falsifies timestamps: **permanently irreconcilable data** (**Major**) | `recordInitial` = MovementService's first slice, delivered inside F4 as a full atomic T2 path; architecture-review label applies from F4 onward; F6 extends the same module with T1 (§2-F4) |
| 2 | AuditService scheduled in F3/F4, but F1's acceptance suite requires security events and F2's user changes require diff audits — F1 couldn't pass its own criteria (**Major**) | AuditService core + security events → F1; entity-diff path (`changes[]`, DN-4) → F2; later features consume (§2-F1/F2) |
| 3 | The F5→F6 orphan-sweep window was real but unstated — invites an ad-hoc mid-P2 "fix" (Minor) | Documented as a known accepted window in F5's notes |
| + | Both Majors were later-than-first-consumer defects (improvement) | Codified as the plan's **governing law** (header): no shared component, service, or job later than its first consumer |

---

*End of document — IMP-IMS-020 v1.0 · Approved — Ready for Production · 2026-07-23*
