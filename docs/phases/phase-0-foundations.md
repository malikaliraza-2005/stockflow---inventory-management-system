# Phase 0 — Foundations

| | |
|---|---|
| **Effort** | ≈ 1 week |
| **Features** | None — infrastructure + risk kills (IMP-020 has no F-block here by design) |
| **Milestone** | **M0 — Walking Skeleton** |
| **Sources** | RDM-IMS-019 §2-P0 · IMP-IMS-020 §1 (pipeline), §3 (infrastructure deps) · DEP-IMS-018 §12 · TST-IMS-017 §6 |

## Phase Overview

Everything the first feature PR needs, already working — plus every environmental risk killed before any dependent code exists. Ends with a deploy pipeline proven end-to-end by a walking skeleton.

## Objectives

1. A CI pipeline that runs every TST §6 PR gate (initially trivially green).
2. Dev + staging environments live, checklist-verified, seed-provisioned.
3. The shared vocabulary in place: validation primitives, error catalog, generated API types.
4. All four environmental risks (R-1/R-4/R-6/R-7) resolved with filed evidence.

## Prerequisites

- All 20 approved documents (this phase consumes, never re-decides).
- Accounts/access: platform, Atlas, Cloudinary, custom domain control (**DEP §2 mandate — needed now, not at launch**), uptime monitor, error tracker.
- Named operator confirmed (AS-19).

## Scope & Tasks

| # | Task | Source | Outcome |
|---|---|---|---|
| 0.1 | `git init`; first commit: docs series + FST-008 skeleton; trunk-based setup | RDM §9 | Repo exists; `main` protected |
| 0.2 | **Scaffold reconciliation** vs final component architecture (`assets/`, `config/`, stale `.gitkeep`s) | RDM Issue 3a | Tree matches UCA/FEA exactly |
| 0.3 | CI shell: lint → typecheck → unit → component → integration → OpenAPI drift → CVE scan → build | TST §6 | Red-blocking pipeline on PR |
| 0.4 | Env schema validation both tiers (fail-fast); `.env.example` inventory | NFR-28, DEP §7 | Boot refuses bad config by name |
| 0.5 | OpenAPI stub from `05` + type generation into `client/src/types` | NFR-27, **R-7** | Types from the contract, not a server |
| 0.6 | Atlas + Cloudinary `ims-dev`/`ims-staging` per naming convention | DEP §3 | Isolated environments |
| 0.7 | Seed module (Admin, settings, Uncategorized) wired as release phase | DBD §8, DEP §11 | Idempotent; integrity check green |
| 0.8 | `validation/primitives` (VAL §2) + Appendix-A vector tests | VAL | The shared vocabulary — both tiers depend on it |
| 0.9 | Error catalog constants + `AppError` skeleton + terminal handler shell | ERR §3 | Typed-error spine |
| 0.10 | pino + correlation IDs + `/health` + `/ready` (mounted first) | NFR-14/23, ARB-04 | Observability spine |
| 0.11 | **ZXing device spike** on target phones — report filed | **R-1** | The only architecture-threatening unknown resolved |
| 0.12 | DEP §12 Phase-0 checklists (dev + staging), incl. **shared-domain + refresh-cookie verification**, trust-proxy echo (**R-4**), Atlas Search tier check (**R-6**), console MFA | DEP §2/§12 | Signed checklists |

## Deliverables

Repo + protected `main` · green CI shell · both environments checklist-signed · seed release-phase proven on staging · primitives/catalog/types packages · spike report · uptime monitor + alert route test-fired.

## Definition of Done (gate to Phase 1)

- [ ] CI runs on PR; staging deploys on merge (walking skeleton through the full pipeline)
- [ ] Seed + boot integrity check green on staging
- [ ] R-1 spike report filed; R-4 echo verified; R-6 tier decision recorded; R-7 types generating
- [ ] **Both DEP §12 environment checklists signed** — including the DEP §2 domain mandate
- [ ] Scaffold reconciliation merged

## Git Milestones

| Tag / checkpoint | Content |
|---|---|
| `init` | Docs series + skeleton (first commit) |
| `ci-green` | Pipeline shell red-blocking on PR |
| `envs-verified` | Checklists signed; seed proven |
| **`m0-walking-skeleton`** | Phase exit — all DoD boxes checked |

## Risks Addressed Here

R-1 (spike) · R-4 (echo) · R-6 (tier check) · R-7 (contract-first types) — all front-loaded by design; a failure in any of these is cheapest to absorb now.
