# Phase 0 · Task 0.2 — Scaffold Reconciliation Record

| | |
|---|---|
| **Task** | 0.2 — Scaffold reconciliation vs final component architecture |
| **Sources** | FEA-IMS-007 §13.5 · UCA-IMS-012 (folders clause) · FST-IMS-008 §1–§3, §5, §6 · RDM-IMS-019 §10 Issue 3a |
| **Date** | 2026-07-23 |
| **Verified against commit** | `81d1978` (tag `init`) |
| **Result** | **Tree matches UCA/FEA exactly — zero corrective changes** |

## Method

The committed placeholder tree (`git ls-files | grep '\.gitkeep$'`) was diffed against a
manifest transcribed from FST-IMS-008 §1–§3 (44 directories). The diff was empty.

## Checks performed

| # | Check | Source | Result |
|---|---|---|---|
| 1 | `client/src/assets/icons/` present (FEV-04 addition) | FEA §13.5, §9 | ✅ present |
| 2 | `client/src/config/` present (FEV-03 addition) | FEA §13.5, §9 | ✅ present |
| 3 | Exactly 14 `pages/` folders per SRS §9, PascalCase | FST §2, §5 rule 1 | ✅ |
| 4 | All non-component folders lowercase | FST §5 rule 1 | ✅ |
| 5 | 44 `.gitkeep` placeholders, none stale (no folder has real files yet) | FST §5 rule 4 | ✅ 44/44 |
| 6 | No folders outside the approved tree | FST §1–§3 | ✅ diff empty |
| 7 | Deliberate absences respected: no `repositories/`, `suppliers/`, `notifications/`, `uploads/`, `migrations/`, `features/`, `core/`, `shared/`, `contexts/` | FST §6 | ✅ |
| 8 | Backend tree: 12 `src/` layers + 3 test tiers per BEA §2 | FST §3 | ✅ |
| 9 | `docs/adr/` exists (NFR-29) | FST §4 | ✅ |

## Notes

- FEA §13.5 anticipated that `assets/` and `config` would need to be **added** during
  reconciliation; FST-IMS-008 (authored after the FEA review) had already absorbed
  FEV-01…04, so the scaffold committed at tag `init` required no modification.
- FST §5 rule 4 remains standing policy: each `.gitkeep` is deleted as its folder gains
  real files (enforced by convention in review, starting Phase 0 tasks 0.3+).
- `docs/evidence/` is introduced by this record as the filing location for Phase
  artifacts that the phase documents require to be "filed"/"signed": this record (0.2),
  the R-1 ZXing spike report (0.11), and the DEP §12 environment checklists (0.12).
  It extends `docs/` only; the FST-governed `client/`/`server/` trees are untouched.

## Amendments

- **2026-07-23 (task 0.4):** `client/tests/unit/` added as the home of the
  "Unit (frontend)" tier (TST §2) — FST-008's client test tree named only
  `components/ hooks/ e2e/`, leaving that tier without a folder. Mirrors
  `server/tests/unit/`. First occupant: the FEV-03 config-module tests.
  Approved with task 0.4.

---

*Filed under Phase 0 · gate item "Scaffold reconciliation merged" (phase-0-foundations.md DoD)*
