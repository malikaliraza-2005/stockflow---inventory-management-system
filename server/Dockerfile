# Back4App Containers — ims-staging API.
# Env vars are injected by the platform (NOT a .env file), so we invoke node
# directly rather than the package.json start/seed scripts (those pass
# --env-file=.env, which does not exist in the container).
#
# Full node:22 image (not -slim) so bcrypt's native addon builds/installs
# reliably.
FROM node:22

WORKDIR /app

# Install deps first (layer cached until package files change).
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and compile TypeScript -> dist/ (.dockerignore keeps local
# node_modules/dist/.env out of the build context).
COPY . .
RUN npm run build

# The app reads process.env.PORT (default 3000); Back4App sets PORT.
EXPOSE 3000

# Release phase: idempotent seed (Admin/settings/Uncategorized) then boot.
# Seed is safe to re-run; a single staging instance cannot race the upsert.
CMD ["sh", "-c", "node dist/seeds/run.js && node dist/index.js"]
