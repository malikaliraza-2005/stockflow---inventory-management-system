# R-1 Spike Report — ZXing on target devices

| | |
|---|---|
| **Task** | 0.11 — ZXing device spike |
| **Risk** | R-1 (FEA §13 — "the only architecture-threatening unknown") |
| **Spike build** | `index.html` · @zxing/library 0.23.0 · @zxing/browser 0.2.1 |
| **Date filed** | 2026-07-23 |
| **Verdict** | **BLOCKED — no working camera hardware available at spike time** |

## Status

The spike tooling is complete and verified serving (HTTPS, vendored ZXing,
constraint-fallback chain, named failure states, per-decode latency logging).
Execution is blocked: the operator's phone camera and laptop webcam are both
physically non-functional as of the filing date. No decode evidence could be
collected on any real device.

## What WAS established

- Spike page loads over self-signed HTTPS on the LAN; `isSecureContext` true.
- Permission/enumeration path exercised on desktop: `cameras: 1 found`,
  `getUserMedia` reaches the hardware layer (fails only at the damaged device).
- Failure-state surfacing works (OverconstrainedError was caught, named, and
  displayed — the P4 state machine's error taxonomy is implementable as designed).

## Completion condition (hard gate — carried forward)

The device matrix below MUST be filled on ≥ 1 real phone (borrowed or the
actual shop device) **before Phase 4 (Scanning) begins** — R-1 is
architecture-threatening only to P4; Phases 1–3 have zero scanner dependency.
Owner: operator (AS-19). The spike tooling requires no further work — running
it is a 5-minute protocol per device (see README).

## Interim risk posture

- **Manual code entry is the SRS-guaranteed fallback path** and is deliberately
  the path the E2E scan flow tests (TST §2) — the system is fully operable
  with zero working cameras.
- If the shop's actual device fleet lacks working cameras at launch, Scanner
  (P4) ships manual-entry-first; camera scanning remains additive.

## Device matrix (pending)

| Device | OS | Browser | Camera init (ms) | EAN-13 | Code-128 | QR | Decode latency (ms) | Low light | Torch | Failure states OK | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| *(pending hardware)* | | | | ⬜ | ⬜ | ⬜ | | ⬜ | ⬜ | ⬜ | |

## Raw logs

```
[13:29:21.361] cameras: 1 found
[13:29:26.457] START FAILED: OverconstrainedError —   (desktop; damaged webcam)
```

---

*Filed under Phase 0 DoD: "R-1 spike report filed" — filed with BLOCKED status
and a hard completion gate at P4 kickoff.*
