/**
 * `jobLocks` — A-8 / BEV-05 leader-election lease. An OPERATIONAL/INFRASTRUCTURE
 * collection, deliberately OUTSIDE the business data model (BEV-05): no ERD
 * entity, no API surface, no audit. Declared here so the collection-count
 * discrepancy with DBD §2 is a documented decision, not an accident.
 *
 * One document per scheduled job (`_id` = job name). A tick acquires the lease
 * via a conditional upsert (take over only if absent or expired) so exactly ONE
 * instance runs a job at a time. Validity is by VALUE (`expiresAt`), consistent
 * with the PDV-03 rule; the TTL index is cleanup only — it GCs an abandoned lock
 * whose holder crashed without releasing, but the expired-takeover check is what
 * actually lets a new leader proceed.
 */
import { model, Schema } from 'mongoose';

export interface JobLockDoc {
  _id: string; // job name
  owner: string; // acquiring instance id
  expiresAt: Date; // lease expiry — checked by value (PDV-03)
  acquiredAt: Date;
}

const jobLockSchema = new Schema<JobLockDoc>(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acquiredAt: { type: Date, required: true },
  },
  { versionKey: false, timestamps: false },
);

// TTL cleanup only (GC of abandoned locks); takeover is the expired-lease check.
jobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const JobLock = model<JobLockDoc>('JobLock', jobLockSchema);
