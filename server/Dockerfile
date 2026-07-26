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

# Boot the server IMMEDIATELY (it binds the port and answers /health before Mongo
# connects, so the platform health check passes fast) and run the idempotent
# release seed in the BACKGROUND. `&&` would hold the port closed until the seed
# finished, which on a cold start (Atlas connect + index/validator/provision) can
# exceed a platform's health-check grace window → "container exited before healthy".
CMD ["sh", "-c", "node dist/seeds/run.js & node dist/index.js"]
