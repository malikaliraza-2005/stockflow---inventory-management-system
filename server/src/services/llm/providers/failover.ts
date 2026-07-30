/**
 * Failover across providers — "when this account's tokens are empty, use the
 * other one."
 *
 * The switch condition is narrow ON PURPOSE. It advances only on
 * `error.exhausted` — quota spent, credit gone, key rejected — because those
 * are the failures where waiting cannot help but a different account can. It
 * deliberately does NOT advance on:
 *
 *   - timeouts and 5xx, which are transient. Failing over would spend the
 *     backup's quota to work around a blip that a retry already covers, and on
 *     a free tier the backup's quota is the scarce thing.
 *   - malformed or unparseable output, which is a prompt problem that follows
 *     you to every provider.
 *
 * Once a provider reports exhaustion it is SKIPPED for the rest of the process
 * lifetime. Re-probing a spent daily quota on every message would add a
 * guaranteed-failing round trip to each request for hours, and the reset is
 * measured in hours while a deploy is measured in minutes — a restart is the
 * honest way back.
 */
import type { Logger } from '../../../lib/logger.js';
import { LlmProviderError, type LlmProvider, type LlmRequest, type LlmResponse } from '../types.js';

export interface FailoverDeps {
  /** Ordered: first is preferred. A single-element list is returned as-is. */
  providers: LlmProvider[];
  logger?: Pick<Logger, 'warn'> | undefined;
}

export function makeFailoverProvider(deps: FailoverDeps): LlmProvider {
  const { providers, logger } = deps;
  const first = providers[0];
  if (first === undefined) throw new Error('makeFailoverProvider: at least one provider required.');
  if (providers.length === 1) return first;

  const exhausted = new Set<string>();

  return {
    // Reports the ACTIVE provider, so the per-message log record names whoever
    // actually answered rather than whoever was configured first.
    get id() {
      return (providers.find((p) => !exhausted.has(p.id)) ?? first).id;
    },
    get model() {
      return (providers.find((p) => !exhausted.has(p.id)) ?? first).model;
    },

    async complete(req: LlmRequest): Promise<LlmResponse> {
      const usable = providers.filter((p) => !exhausted.has(p.id));
      // Everyone is spent: fall through to the primary so the caller gets a real
      // provider error (and a clean 503) rather than a synthetic one.
      const chain = usable.length > 0 ? usable : [first];
      let last: unknown;

      for (const provider of chain) {
        try {
          return await provider.complete(req);
        } catch (error) {
          last = error;
          if (!(error instanceof LlmProviderError) || !error.exhausted) throw error;

          exhausted.add(provider.id);
          logger?.warn(
            { provider: provider.id, status: error.status },
            `llm: ${provider.id} is exhausted — failing over for the rest of this process`,
          );
        }
      }
      throw last;
    },
  };
}
