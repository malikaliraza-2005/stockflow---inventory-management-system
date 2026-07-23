# Phase 5 — Dashboard & Reports

| | |
|---|---|
| **Effort** | ≈ 1.5 weeks · **parallelizable with Phase 4** (both depend only on Phase 3) |
| **Features** | **F9** Dashboard · **F10** Reports & Export · F7 (Audit Trail tab UI) — per IMP-020 §2 |
| **Milestone** | completes **M4 — Operations-Ready UX** (with Phase 4) |
| **Sources** | IMP-IMS-020 §2-F9/F10/F7 · RDM-IMS-019 §2-P5 · NFR-11/A-2 · BR-40 · ERR §7 |

## Phase Overview

The analytical surfaces over the ledger: the single-call cached dashboard, the five reports with Admin CSV export, and the Audit Trail tab. Everything here is a *view* — ledger-derived by rule (BR-40), never a second source of truth.

## Objectives

1. Dashboard = one aggregate endpoint, per-instance cache, `asOf` surfaced (NFR-11, A-2, BR-25).
2. All five reports byte-reproducible for past periods (BR-40).
3. CSV export truncation-proof (ERR §7 streaming policy).
4. Audit Trail fully browsable with expansion diffs (DataTable expansion's first consumer).

## Prerequisites

Phase 3 DoD (M3 hard gate) complete — the ledger is the data source for everything here.

## Scope & Tasks

Standard pipeline (IMP-020 §1). Phase-specific content:

### F9 — Dashboard

- Endpoint: `GET /dashboard/summary?range=7|30|90` — single aggregation pipeline, 30–60 s per-instance TTL cache, `asOf` stamping.
- UI: Dashboard page · `KpiCard` ×3 · `StockAlertList` (low/out-of-stock, product links + pre-filled Stock In `[+]`) · `RecentTransactions` (10, → ledger links) · **lazy `ChartPanel` (Recharts chunk's first consumer)** — movement trend + volume · quick actions: `[Scan]`, `[New movement]` (context-free → F6's Step 0 picker).
- Tests: aggregate correctness vs factory data · cache-staleness bound · range-param validation (`400` outside the enum).
- **Acceptance:** renders within NFR-02 at dev-scale data; every alert deep-links to its pre-filled action.

### F10 — Reports & Export

- Endpoints: the six `/reports/*` routes + `/reports/:name/export` (`05` §7).
- UI: Reports page — URL-param selector (`?type=`, SMP §4), per-report filter panels (date range pre-filled last 30 days; mandatory ≤ 366 d for history), totals rows, timezone + current-cost footnotes, Consistency section (Admin) rendering reconciliation drift.
- Export: cursor-batched CSV stream · first-batch gate + connection-destroy on mid-stream failure + client abort toast (ERR §7) · Admin-only (hidden UI **and** 403).
- Tests: date-span vectors · **export-abort simulation** · Staff-export 403 · drift-row rendering.
- **Acceptance:** re-running a past-period report is byte-identical (BR-40); a truncated-but-complete-looking export is impossible.

### F7 — Audit Trail tab (this phase's slice)

Transactions page, **Audit Trail tab** (Admin-only tab guard): entity/action/actor/date filters, `entityLabel` rendering (DN-4 — survives hard deletes), **`DataTable` expansion for before/after diffs (expansion's first consumer)**, security events visible.
Tests: filter matrix rows · expansion a11y (`aria-expanded`) · post-hard-delete label rendering.

## Deliverables

Dashboard + Reports pages · Audit Trail tab · export pipeline · consistency-report surfacing.

## Definition of Done (completes M4, with Phase 4)

- [ ] Dashboard within NFR-02 budget; `asOf` honest under cache
- [ ] All five reports + export green incl. abort simulation
- [ ] Audit Trail renders diffs, labels, and security events; expansion accessible
- [ ] A11y state-pass rows added for all new surfaces
- [ ] Per-feature checklists (IMP §4) signed for F9/F10/F7-slice
- [ ] **M4 review: full-flow demo on a phone** (with Phase 4)

## Git Milestones

| Tag / checkpoint | Content |
|---|---|
| `f9-dashboard` | Aggregate endpoint + cached dashboard |
| `f10-reports` | Five reports + truncation-proof export |
| `f7-audit-tab` | Audit Trail with expansion diffs |
| **`m4-operations-ready`** | Phase 4 + 5 exit — full-flow phone demo |

## Risks

**R-5** (audit query plans at volume) — indexes are specified (DBD §3); formal verification at P6's load test. Chart-bundle discipline: Recharts must stay in its lazy chunk (NFR-06) — verify no login-path regression.