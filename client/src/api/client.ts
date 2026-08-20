/**
 * The single Axios instance + interceptor pair — FEA §4.1, the dependency
 * root every typed resource client builds on.
 *
 *   request  → attach Bearer from authStore (memory only, A-7)
 *   response → no response   → synthesize NETWORK_ERROR (E-1, ERR §12)
 *            → 401           → SINGLE-FLIGHT refresh (one in-flight promise;
 *                              every 401'd request awaits it) → replay the
 *                              original request ONCE → refresh failed →
 *                              endSession('expired') (EC-30: forms preserve
 *                              their own state through the redirect)
 *            → envelope      → typed ApiError{code, message, details,
 *                              correlationId}
 *
 * Behavior mapping (toast/redirect/inline) belongs to lib/errorMap consumers —
 * this layer only TYPES failures, it never renders them.
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

import { getConfig } from '../config';
import { sessionEpoch, useAuthStore } from '../stores/authStore';
import { endSession, performRefresh } from './session';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly correlationId: string | undefined;

  constructor(args: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    correlationId?: string | undefined;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.code = args.code;
    this.status = args.status;
    this.details = args.details;
    this.correlationId = args.correlationId;
  }
}

interface WireEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    correlationId?: string;
  };
}

export const api = axios.create();

// Config is resolved lazily per request so tests can construct the module
// without a full import.meta.env (FEV-03 validation still fails loudly).
api.interceptors.request.use((config) => {
  config.baseURL ??= `${getConfig().apiBaseUrl}/api/v1`;
  // Credentials mode ONLY on /auth — mirrors the server CORS policy (app.ts:
  // credentials = path.startsWith('/api/v1/auth')). Every other route is
  // Bearer-only; sending credentials there trips the missing-ACAC block and
  // discards the response. performRefresh uses its own axios, so it's unaffected.
  config.withCredentials = (config.url ?? '').includes('/auth/');
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * ARB-03 single flight: at most ONE refresh in flight, ever — app-wide, not
 * just per-interceptor. Exported because the A-7 bootstrap refresh MUST join
 * this same flight: the server rotates on every use and treats a second use of
 * a rotated token as theft (BR-35 — it revokes the whole family), so two
 * overlapping `/auth/refresh` calls with one cookie log the user out. React's
 * StrictMode double-invokes the bootstrap effect in dev, which made that the
 * NORMAL case rather than the rare one.
 */
let refreshInFlight: Promise<string> | null = null;

export function refreshOnce(): Promise<string> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

interface RetriableConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

function toApiError(error: AxiosError): ApiError {
  if (!error.response) {
    // E-1 — client-synthesized, never on the wire
    return new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Network error',
      status: 0,
    });
  }
  const envelope = (error.response.data ?? {}) as WireEnvelope;
  return new ApiError({
    code: envelope.error?.code ?? 'INTERNAL_ERROR',
    message: envelope.error?.message ?? 'Request failed',
    status: error.response.status,
    details: envelope.error?.details,
    correlationId: envelope.error?.correlationId,
  });
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = (error.config ?? {}) as RetriableConfig;
  const status = error.response?.status;
  const url = config.url ?? '';

  // 401s on the auth surface itself are terminal answers (bad credentials,
  // dead refresh token) — only OTHER requests earn the silent refresh.
  const isAuthRoute = url.includes('/auth/');

  if (status === 401 && !isAuthRoute && !config._retried) {
    const epoch = sessionEpoch();
    try {
      await refreshOnce();
    } catch {
      // A login (or another refresh) may have installed a NEWER session while
      // ours was in flight. That session is valid — our failure is stale news,
      // so replay against it instead of tearing it down.
      if (sessionEpoch() === epoch) {
        endSession('expired'); // EC-30 — forms preserve their state themselves
        throw toApiError(error);
      }
    }
    config._retried = true; // replay ONCE — a second 401 is terminal
    return api.request(config);
  }

  throw toApiError(error);
});
