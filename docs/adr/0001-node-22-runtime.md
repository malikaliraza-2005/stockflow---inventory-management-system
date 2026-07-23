# ADR-0001 — Backend runtime: Node 22 LTS (supersedes DEP §5 assumption A-5)

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-23 |
| **Deciders** | Operator (AS-19) + implementation |
| **Affects** | DEP-IMS-018 §5 ("Node 20 LTS (A-5)") · `.nvmrc` · `engines` × 2 · CI |

## Context

DEP-IMS-018 §5 pins the backend runtime to "Node 20 LTS (A-5)". Node 20 reached
end-of-life in **April 2026** — before this project's implementation window
(Phase 0 began 2026-07-23). Standardizing on an EOL runtime would ship without
security patches, contradicting the SEC-12 patch-cadence posture the same
document series mandates.

## Decision

**Node 22 LTS** (active LTS, maintenance into 2027) for both tiers — pinned via
`.nvmrc` and `engines`, used by every CI job (`setup-node` reads `.nvmrc`).

## Consequences

- A-5 is superseded; DEP §5's "Node 20 LTS" is read as "the current active LTS."
- No API-surface impact: no dependency in SRS §17.2 requires Node 20 specifically.
- Revisit at Node 22 maintenance end or if the chosen host platform constrains
  the runtime (DEP §5 platform choice happens in task 0.6/0.12).
