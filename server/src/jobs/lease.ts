/**
 * Leader lease guard — A-8 / BEV-05. `withLease` runs `fn` only if THIS instance
 * wins the lease for `jobName`, so a horizontally-scaled deployment runs each
 * scheduled job exactly once per tick.
 *
 * Acquisition is a single conditional upsert:
 *   filter { _id: jobName, expiresAt ≤ now }  — matches an EXPIRED lock (takeover)
 *   upsert                                     — INSERTS when no lock exists
 * A currently-valid lock matches neither branch, so the upsert attempts an insert
 * on the existing `_id` and fails with duplicate-key (11000) — that is the
 * "someone else holds it" signal, swallowed as `false`. The lease is released on
 * completion; if the holder crashes, the next tick past `expiresAt` takes over.
 */
import { isDuplicateKeyError } from '../lib/idempotency.js';
import { JobLock } from '../models/JobLock.js';

export interface LeaseOptions {
  jobName: string;
  owner: string;
  /** Lease duration — set comfortably above the job's expected runtime. */
  leaseMs: number;
  now?: () => number;
}

/** Try to acquire the lease. Returns true iff this instance now holds it. */
export async function acquireLease(opts: LeaseOptions): Promise<boolean> {
  const nowMs = (opts.now ?? Date.now)();
  const now = new Date(nowMs);
  try {
    await JobLock.findOneAndUpdate(
      { _id: opts.jobName, expiresAt: { $lte: now } },
      { $set: { owner: opts.owner, expiresAt: new Date(nowMs + opts.leaseMs), acquiredAt: now } },
      { upsert: true },
    );
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false; // a valid lease is held elsewhere
    throw error;
  }
}

/** Release the lease — only if we still own it (never steal another holder's). */
export async function releaseLease(jobName: string, owner: string): Promise<void> {
  await JobLock.deleteOne({ _id: jobName, owner });
}

/**
 * Run `fn` under the lease. Returns true if it ran (this instance was leader),
 * false if another instance held the lease. The lease is always released after
 * `fn`, even on throw.
 */
export async function withLease(opts: LeaseOptions, fn: () => Promise<void>): Promise<boolean> {
  if (!(await acquireLease(opts))) return false;
  try {
    await fn();
  } finally {
    await releaseLease(opts.jobName, opts.owner);
  }
  return true;
}
