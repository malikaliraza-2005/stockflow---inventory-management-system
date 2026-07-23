# Phase 2 — Catalog

| | |
|---|---|
| **Effort** | ≈ 2 weeks |
| **Features** | **F3** Categories · **F4** Products · **F5** Product Images · **F11** Settings (UI) — per IMP-020 §2 |
| **Milestone** | **M2 — Catalog Complete** |
| **Sources** | IMP-IMS-020 §2-F3/F4/F5/F11 · RDM-IMS-019 §2-P2 · DBD-IMS-004 · VAL-IMS-014 |

## Phase Overview

The full product catalog: categories, products with their complete lifecycle (SKU rules, optimistic concurrency, archive/restore/hard-delete), images via Cloudinary, and the Settings UI. Crucially, **the ledger invariant starts here** — `recordInitial` (MovementService's first slice) ships with F4 so every product ever created has a reconcilable ledger.

## Objectives

1. Catalog CRUD end-to-end with all BR-01…10/21…28 enforced and race-tested.
2. `quantity == Σ ledger` true from the first product (IMP Issue 1 resolution).
3. Image pipeline per FEV-01: signed uploads, failure isolation, no unswept orphan path (window accepted until P3).
4. Search live per the D-1 decision recorded in P0.

## Prerequisites

Phase 1 DoD complete (attribution + audit diff path exist — catalog writes are audited from their first commit).

## Scope & Tasks

All features run the standard pipeline (IMP-020 §1). Phase-specific content:

### F3 — Categories

Endpoints `05` §7.4 · collation-indexed `categories` · Categories page, `CategoryFormModal`, `ReassignDeleteModal` · BR-26…28, T5; collation-aware queries only in CategoryService · tests: delete-vs-assign race, collation duplicate vectors · **Acceptance:** Uncategorized undeletable; reassign-and-delete atomic under race.

### F4 — Products

- Endpoints: all eight `/products` routes incl. lookup, archive/restore, hard delete.
- **`recordInitial` — MovementService slice 1 (IMP Issue 1):** the T2 path (INITIAL insert + quantity set, one atomic transaction) implemented inside `MovementService`; **architecture-review label applies from here onward**; nothing stubbed.
- SKU rules incl. counters + PDV-02 formatting · optimistic concurrency (`version` → `STALE_WRITE`) · T3/T4 lifecycle with atomic predicates · search per D-1 (Atlas Search or the P0-checked fallback).
- Pages: Products / Detail / Add / Edit · `ProductForm`, `StockStatusBadge`, `ProductRowCard`, `QRLabel` (print-clean).
- Tests: SKU normalization vectors · version conflict · archive/hard-delete races · lookup precedence · `recordInitial` atomicity.
- **Acceptance:** full lifecycle on staging; lookup precedence correct; plans COLLSCAN-free; every seeded product's ledger sums to its quantity.

### F5 — Product Images

Upload endpoints · `ImageUploader` per FEV-01 · BR-36…38, DBR-03 exactly-one-primary, VAL Issue 4 folder/host pinning · tests: failure isolation (save proceeds), destroy-on-remove, rejection vectors · **Known accepted window (IMP Issue 3):** orphaned staging assets accumulate until P3's sweep — do not fix ad hoc.

### F11 — Settings (UI)

`GET/PUT /settings` · Settings page (Admin) · BR-41, audited via F2's diff path, DN-3 copy semantics · tests: audit-on-change; threshold propagation to *new* products only.

## Deliverables

Categories/Products/Detail/Add/Edit/Settings pages · `recordInitial` in MovementService · image pipeline · audit entries for every catalog write · search live.

## Definition of Done (gate to Phase 3)

- [ ] All F3/F4/F5/F11 binding rows green in the integration matrix
- [ ] Lifecycle race tests green (BR-22/23/27, T6-style interleavings)
- [ ] Every product on staging reconciles (`quantity == Σ ledger`)
- [ ] Catalog query plans spot-checked COLLSCAN-free
- [ ] Per-feature completion checklists (IMP §4) signed for F3/F4/F5/F11

## Git Milestones

| Tag / checkpoint | Content |
|---|---|
| `f3-categories` | Taxonomy + reassignment flows |
| `f4-products` | Catalog lifecycle + `recordInitial` + search |
| `f5-images` | Upload pipeline + failure isolation |
| `f11-settings-ui` | Admin settings form, audited |
| **`m2-catalog-complete`** | Phase exit — catalog demo + audit-trail walkthrough |

## Risks

R-6 fallback path exercised here if Atlas Search unavailable · the F5 orphan window is accepted and documented — resist ad-hoc fixes.
