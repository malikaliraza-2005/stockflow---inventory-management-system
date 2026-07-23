# Phase 4 — Scanning

| | |
|---|---|
| **Effort** | ≈ 1 week · **parallelizable with Phase 5** (both depend only on Phase 3) |
| **Features** | **F8** Scanning — per IMP-020 §2 |
| **Milestone** | contributes to **M4 — Operations-Ready UX** (shared with Phase 5) |
| **Sources** | IMP-IMS-020 §2-F8 · RDM-IMS-019 §2-P4 · FEA-IMS-007 §6.1 · WIR §9 · R-1 spike report (P0) |

## Phase Overview

The camera-driven floor workflow: the scanner state machine, hostile-payload handling, and scan-driven movements — frontend-dominant, since the lookup endpoint has been live since Phase 2 and the movement dialogs since Phase 3.

## Objectives

1. Every FR-SCAN state is a named, tested UI rendering — no improvised conditionals.
2. Scan payloads treated as hostile input end-to-end (BR-16/EC-20).
3. Scan-to-recorded-movement in ≤ 3 interactions on real devices.
4. The R-1 device matrix executed against staging and filed.

## Prerequisites

Phase 3 DoD (M3 hard gate) complete — movements exist to launch from the result card. P0's spike report informs device-specific handling.

## Scope & Tasks

Standard pipeline (IMP-020 §1) — T-b/T-c/T-d are minimal (lookup endpoint already live; this phase adds no new backend surface). Phase-specific content:

### F8 — Scanning

- UI: Scanner page (full-height, thumb-zone per NFR-31) · `ScannerViewport` — the FEA §6.1 state machine (`idle → requesting-permission → scanning → decoded → looking-up → found | not-found | archived`, side states `permission-denied · no-camera · insecure-context`) with 2 s duplicate-read cooldown (EC-21) and torch detection · `ManualCodeEntry` — **rendered in every state** (FR-SCAN-01) · `ScanResultCard` — found/not-found/archived variants, role-dependent CTAs (create-from-barcode for Admin via route state; notify-admin for Staff), **post-movement success flash + updated quantity, ready for next scan** (WIR Issue 2a).
- Payload hardening: printable ≤ 64 validation before any call; rendered escaped; never navigated/executed (BR-16, EC-20).
- Lazy chunk: ZXing loads with this route only (SMP §7); guard-outside-lazy rule holds.
- Integration: movements launch the Phase 3 dialogs with product context (Step 0 skipped); Adjustment visible to Admin only.

### Tests

Machine-transition component tests (every named state) · payload-hostility vectors (`INVALID_BARCODE`) · lookup-precedence integration rows (already green from F4 — re-verified) · **E2E scan flow via manual entry** (TST Issue 1 — zero camera mocks) · **R-1 device matrix executed on staging** (real phones, both platforms from the spike list).

## Deliverables

Scanner page complete with all states · device-matrix report filed · scan E2E green.

## Definition of Done (contributes to M4)

- [ ] Every FR-SCAN-01…07 state renders its named UI in component tests
- [ ] Scan-to-movement ≤ 3 interactions verified across the device matrix
- [ ] Manual-entry E2E flow green on staging
- [ ] Payload-hostility vectors green; no scan value ever navigated or executed
- [ ] Per-feature checklist (IMP §4) signed for F8

## Git Milestones

| Tag / checkpoint | Content |
|---|---|
| `f8-scanner-machine` | State machine + manual entry, component tests green |
| `f8-scan-movements` | Result card → dialogs wiring; E2E green |
| `p4-device-matrix` | Matrix executed + filed (pairs with Phase 5's exit for `m4`) |

## Risks

**R-1** (device variance) — this is its resolution phase; the state machine contains variance architecturally, the manual-entry fallback is a complete workflow, and the matrix is the evidence. A failing device class degrades to manual entry rather than blocking release.