/**
 * Scheduled-jobs runner — BEA §7. Starts the interval timers for the two daily
 * jobs; each tick runs under the A-8 lease so exactly one instance executes
 * (`withLease`). A job throwing never crashes the process — failures are logged;
 * the Consistency report (F10) is the surfacing UI, not an exception (ERR).
 *
 * Ticks are skipped while shutting down (NFR-21). Timers are `unref`'d so a
 * pending tick never holds the process open during drain.
 */
import type { CloudinaryClient } from '../lib/cloudinary.js';
import type { Logger } from '../lib/logger.js';
import { withLease } from './lease.js';
import { runOrphanSweep } from './orphanSweep.js';
import { runReconciliation } from './reconciliation.js';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const DEFAULT_LEASE_MS = 10 * 60 * 1000; // 10 min — well above a job's runtime

export interface SchedulerDeps {
  logger: Logger;
  cloudinary: CloudinaryClient;
  /** Unique per process (host+pid+random) — the lease owner id. */
  instanceId: string;
  intervalMs?: number;
  leaseMs?: number;
  isShuttingDown?: () => boolean;
}

export interface Scheduler {
  stop: () => void;
}

export function startJobs(deps: SchedulerDeps): Scheduler {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const timers: NodeJS.Timeout[] = [];

  const tick = async (jobName: string, run: () => Promise<void>): Promise<void> => {
    if (deps.isShuttingDown?.()) return;
    try {
      const ran = await withLease({ jobName, owner: deps.instanceId, leaseMs }, async () => {
        deps.logger.info({ job: jobName }, 'scheduled job start (leader)');
        await run();
      });
      if (!ran) deps.logger.debug({ job: jobName }, 'scheduled job skipped (not leader)');
    } catch (error) {
      deps.logger.error({ job: jobName, err: error }, 'scheduled job failed');
    }
  };

  const schedule = (jobName: string, run: () => Promise<void>): void => {
    const timer = setInterval(() => void tick(jobName, run), intervalMs);
    timer.unref();
    timers.push(timer);
  };

  schedule('reconciliation', async () => {
    await runReconciliation({ logger: deps.logger });
  });
  schedule('orphan-sweep', async () => {
    await runOrphanSweep({ cloudinary: deps.cloudinary, logger: deps.logger });
  });

  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
