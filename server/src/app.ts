/**
 * Express app factory — the BEA §3 normative pipeline ("deviations are
 * defects"), completed to position #11 with F1:
 *
 *   #0 health · #1 requestId (+completion log) · #2 trust proxy ·
 *   #3 helmet · #4 cors (credentials only on /auth) · #5 compression ·
 *   #6 rate limiters (global /api/v1; strict on login+reset inside the auth
 *   router) · #7 json(1 MB)+cookies · #8 mongoSanitize ·
 *   #9 authenticate / #10 authorize / #11 validate (per-route) ·
 *   ∞ errorHandler
 *
 * Dependency-injected (logger, readiness, env subset) so integration tests
 * run the REAL pipeline against ephemeral Mongo with test configuration.
 */
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import helmet from 'helmet';

import { createAuditLogsController } from './controllers/auditLogsController.js';
import { createAuthController } from './controllers/authController.js';
import { createCategoriesController } from './controllers/categoriesController.js';
import { createChatController } from './controllers/chatController.js';
import { createDashboardController } from './controllers/dashboardController.js';
import { createMovementsController } from './controllers/movementsController.js';
import { createProductsController } from './controllers/productsController.js';
import { createReportsController } from './controllers/reportsController.js';
import { createSettingsController } from './controllers/settingsController.js';
import { createTransactionsController } from './controllers/transactionsController.js';
import { createUploadController } from './controllers/uploadController.js';
import { createUsersController } from './controllers/usersController.js';
import { NotFoundError, ServiceUnavailableError } from './errors/AppError.js';
import type { Logger } from './lib/logger.js';
import { createGoogleVerifier, type GoogleVerifier } from './lib/googleVerify.js';
import { authenticate } from './middleware/authenticate.js';
import { createAuthorize } from './middleware/authorize.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { createCloudinary } from './lib/cloudinary.js';
import { httpLogger } from './middleware/httpLogger.js';
import { createGlobalLimiter, createStrictLimiter } from './middleware/rateLimiters.js';
import { requestId } from './middleware/requestId.js';
import { createAuditLogsRouter } from './routes/auditLogs.js';
import { createAuthRouter } from './routes/auth.js';
import { createCategoriesRouter } from './routes/categories.js';
import { createChatRouter } from './routes/chat.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createMovementsRouter } from './routes/movements.js';
import { createProductsRouter } from './routes/products.js';
import { createReportsRouter } from './routes/reports.js';
import { createSettingsRouter } from './routes/settings.js';
import { createTransactionsRouter } from './routes/transactions.js';
import { createUploadRouter } from './routes/upload.js';
import { createUsersRouter } from './routes/users.js';
import { AuditQueryService } from './services/AuditQueryService.js';
import { AuditService } from './services/AuditService.js';
import { AuthService } from './services/AuthService.js';
import { CategoryService } from './services/CategoryService.js';
import { ChatService } from './services/ChatService.js';
import { createLlmProvider, type LlmProviderId } from './services/llm/providers/index.js';
import { DashboardService } from './services/DashboardService.js';
import { MovementService } from './services/MovementService.js';
import { ProductService } from './services/ProductService.js';
import { ReportService } from './services/ReportService.js';
import { SettingsService } from './services/SettingsService.js';
import { TransactionService } from './services/TransactionService.js';
import { UploadService } from './services/UploadService.js';
import { UserService } from './services/UserService.js';
import type { LlmProvider } from './services/llm/types.js';

/** The env slice the pipeline consumes — server.ts passes the validated Env. */
export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'staging' | 'production';
  JWT_ACCESS_SECRET: string;
  ACCESS_TOKEN_TTL: string;
  REFRESH_TOKEN_TTL: string;
  /** Google OAuth Web client id — absent ⇒ Google sign-in disabled. */
  GOOGLE_CLIENT_ID?: string | undefined;
  CORS_ORIGIN: string;
  RATE_LIMIT_GLOBAL_MAX: number;
  RATE_LIMIT_GLOBAL_WINDOW_MS: number;
  RATE_LIMIT_STRICT_MAX: number;
  RATE_LIMIT_STRICT_WINDOW_MS: number;
  /** D-1: Atlas Search available on the deployed tier (else regex fallback). */
  ATLAS_SEARCH_ENABLED: boolean;
  /** Cloudinary signed uploads (SEC-08) + delivery-host pinning (VAL Issue 4). */
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  CLOUDINARY_DELIVERY_HOST: string;
  /** AI Inventory Assistant kill switch — off ⇒ /chat is never mounted. */
  CHAT_ENABLED: boolean;
  LLM_PROVIDER: LlmProviderId;
  /** Absent ⇒ the provider's default model (services/llm/providers/index.ts). */
  LLM_MODEL?: string | undefined;
  LLM_API_KEY?: string | undefined;
  /** Optional second account, used only when the primary reports exhaustion. */
  LLM_FALLBACK_PROVIDER?: LlmProviderId | undefined;
  LLM_FALLBACK_API_KEY?: string | undefined;
  LLM_FALLBACK_MODEL?: string | undefined;
  LLM_MAX_TOKENS: number;
  LLM_TIMEOUT_MS: number;
  RATE_LIMIT_CHAT_MAX: number;
  RATE_LIMIT_CHAT_WINDOW_MS: number;
}

export interface AppDeps {
  logger: Logger;
  /** Readiness provider — server.ts owns the state (DB connected + integrity). */
  isReady: () => boolean;
  env: AppEnv;
  /** ARB-01: exact platform hop count (env TRUST_PROXY_HOPS); echo-verified in 0.12 (R-4). */
  trustProxyHops?: number;
  /** Seconds advertised in Retry-After while not ready (NFR-20). */
  readyRetryAfterSeconds?: number;
  /** Test seam: inject a stub Google verifier (no real Google call). Prod omits
   *  it — the verifier is built from GOOGLE_CLIENT_ID instead. */
  verifyGoogleToken?: GoogleVerifier | undefined;
  /** Test seam: inject a scripted LLM provider. Prod omits it — the provider is
   *  built from LLM_PROVIDER/LLM_MODEL/LLM_API_KEY (mirrors verifyGoogleToken). */
  llmProvider?: LlmProvider | undefined;
}

export function createApp(deps: AppDeps): Express {
  const { logger, isReady, env, trustProxyHops = 0, readyRetryAfterSeconds = 30 } = deps;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops); // #2 (ARB-01)

  // #0 — health endpoints mounted BEFORE everything: no auth, no limiters,
  // no correlation (ARB-04; ERR §4 — monitoring bodies, not the app).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', (_req, res, next) => {
    if (isReady()) {
      res.json({ status: 'ready' });
      return;
    }
    next(new ServiceUnavailableError(readyRetryAfterSeconds, 'Service not ready.'));
  });

  // #1 — correlation ID · completion logging
  app.use(requestId(logger));
  app.use(httpLogger());

  // #3 — helmet: CSP (self + Cloudinary image origin), HSTS, frame-deny,
  // referrer policy (SEC-05)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'img-src': ["'self'", 'https://res.cloudinary.com'] },
      },
    }),
  );

  // #4 — cors: exact frontend origin; credentials ONLY on /auth routes
  // (BEA §3 — the refresh cookie is the sole credentialed exchange)
  app.use(
    cors((req, callback) => {
      callback(null, {
        origin: env.CORS_ORIGIN,
        credentials: req.path.startsWith('/api/v1/auth'),
      });
    }),
  );

  // #5 — compression (NFR-07)
  app.use(compression());

  // #6 — global limiter on the API surface (SEC-04); strict limiter is wired
  // inside the auth router on login + reset-password only
  app.use(
    '/api/v1',
    createGlobalLimiter({
      windowMs: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
      max: env.RATE_LIMIT_GLOBAL_MAX,
    }),
  );

  // #7 — body parsing (1 MB cap, SEC-06) + refresh cookie
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // #8 — strip $-prefixed keys/operators (SEC-06)
  app.use(mongoSanitize());

  // ── services + per-route chain builders (#9/#10/#11 live on routes) ────
  const audit = new AuditService(logger);
  // Prod builds the real verifier from GOOGLE_CLIENT_ID; tests inject a stub via
  // deps.verifyGoogleToken. Absent both ⇒ /auth/google returns "not available".
  const googleVerifier =
    deps.verifyGoogleToken ??
    (env.GOOGLE_CLIENT_ID ? createGoogleVerifier(env.GOOGLE_CLIENT_ID) : undefined);
  const authService = new AuthService({
    audit,
    logger,
    config: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtl: env.ACCESS_TOKEN_TTL,
      refreshTtl: env.REFRESH_TOKEN_TTL,
      chatEnabled: env.CHAT_ENABLED, // FCM-01 settings block — the client hides the entry point
    },
    verifyGoogleToken: googleVerifier,
  });
  logger.info(
    { googleSignIn: Boolean(googleVerifier) },
    googleVerifier
      ? 'auth: Google sign-in ENABLED'
      : 'auth: Google sign-in DISABLED (no GOOGLE_CLIENT_ID)',
  );
  const authenticateMw = authenticate(env.JWT_ACCESS_SECRET);
  // App-scoped authorize: ONE BEV-03 denial window per instance (F2 — its
  // first consumer, the /users router).
  const authorize = createAuthorize({ audit });
  const userService = new UserService({
    audit,
    authService,
    clientOrigin: env.CORS_ORIGIN, // reset links point at the frontend (AS-6)
  });
  const categoryService = new CategoryService({ audit });
  const movementService = new MovementService({ audit });
  const uploadService = new UploadService({
    cloudinary: createCloudinary({
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
    }),
  });
  const productService = new ProductService({
    audit,
    movement: movementService,
    atlasSearch: env.ATLAS_SEARCH_ENABLED,
    uploads: uploadService,
    deliveryHost: env.CLOUDINARY_DELIVERY_HOST,
    logger,
  });
  const settingsService = new SettingsService({ audit });
  const transactionService = new TransactionService();
  const dashboardService = new DashboardService();
  const reportService = new ReportService();
  const auditQueryService = new AuditQueryService();

  app.use(
    '/api/v1/auth',
    createAuthRouter({
      controller: createAuthController({
        authService,
        secureCookies: env.NODE_ENV === 'production' || env.NODE_ENV === 'staging',
      }),
      authenticate: authenticateMw,
      strictLimiter: createStrictLimiter({
        windowMs: env.RATE_LIMIT_STRICT_WINDOW_MS,
        max: env.RATE_LIMIT_STRICT_MAX,
      }),
    }),
  );

  app.use(
    '/api/v1/users',
    createUsersRouter({
      controller: createUsersController(userService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/categories',
    createCategoriesRouter({
      controller: createCategoriesController(categoryService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/products',
    createProductsRouter({
      controller: createProductsController(productService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/inventory',
    createMovementsRouter({
      controller: createMovementsController(movementService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/transactions',
    createTransactionsRouter({
      controller: createTransactionsController(transactionService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/dashboard',
    createDashboardRouter({
      controller: createDashboardController(dashboardService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/audit-logs',
    createAuditLogsRouter({
      controller: createAuditLogsController(auditQueryService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/reports',
    createReportsRouter({
      controller: createReportsController(reportService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/settings',
    createSettingsRouter({
      controller: createSettingsController(settingsService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  app.use(
    '/api/v1/upload',
    createUploadRouter({
      controller: createUploadController(uploadService),
      authenticate: authenticateMw,
      authorize,
    }),
  );

  // AI Inventory Assistant — SHIPPED DARK. When CHAT_ENABLED is false the
  // router is never mounted, so /api/v1/chat falls through to the 404 below and
  // the feature costs exactly one boolean at runtime. That is what lets the code
  // deploy, the build be verified, and the feature be switched on per
  // environment — and off again in seconds, without a rollback.
  if (env.CHAT_ENABLED) {
    const chatService = new ChatService({
      // Mirrors the verifyGoogleToken seam: tests inject a scripted provider,
      // production builds the real one from config.
      llm: deps.llmProvider ?? createLlmProvider(env, logger),
      products: productService,
      transactions: transactionService,
      config: { maxTokens: env.LLM_MAX_TOKENS, timeoutMs: env.LLM_TIMEOUT_MS },
    });
    app.use(
      '/api/v1/chat',
      createChatRouter({
        controller: createChatController(chatService),
        authenticate: authenticateMw,
        authorize,
        limits: { windowMs: env.RATE_LIMIT_CHAT_WINDOW_MS, max: env.RATE_LIMIT_CHAT_MAX },
      }),
    );
  }
  logger.info(
    {
      chatEnabled: env.CHAT_ENABLED,
      llmProvider: env.LLM_PROVIDER,
      llmFallback: env.LLM_FALLBACK_PROVIDER ?? null,
    },
    env.CHAT_ENABLED ? 'chat: AI assistant ENABLED' : 'chat: AI assistant DISABLED (CHAT_ENABLED)',
  );

  // Unknown route → 404 envelope (ERR §11)
  app.use((_req, _res, next) => {
    next(new NotFoundError());
  });

  // ∞ — terminal errorHandler: the only failure-response writer (ERR §3)
  app.use(
    createErrorHandler((message, meta) => {
      logger.error(meta, message);
    }),
  );

  return app;
}
