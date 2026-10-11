# Production image for the Tunakula API only (NestJS on Fastify, run from TypeScript via tsx).
# Deployed as its own unit — the two web frontends are separate static images (frontend/*/Dockerfile).
# This installs ONLY the backend + shared workspaces (scoped npm ci), so none of the frontend toolchain
# (Next.js etc.) ends up in the image. The API migrates the database on startup, then serves on $PORT.
FROM node:22-slim

WORKDIR /app

# Only the manifests, shared packages, and backend workspaces — the frontends are not copied.
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared ./shared
COPY backend ./backend

# Scope the install to the backend runtime graph. --include=dev keeps tsx (the TypeScript runner).
RUN npm ci --include-workspace-root --include=dev \
      -w @tunakula/ts-contracts \
      -w @tunakula/ts-money \
      -w @tunakula/payment-http \
      -w @tunakula/payment-connector-bitripay \
      -w @tunakula/payment-connector-koda \
      -w @tunakula/payment-connector-sandbox \
      -w @tunakula/payment-connector-stripe \
      -w @tunakula/api

ENV NODE_ENV=production
ENV PORT=8080

# Run as the unprivileged user that ships with the node image, from the API workspace.
USER node
WORKDIR /app/backend/api
EXPOSE 8080

# Liveness: the /v1/health route does a database round-trip. No curl in slim, so use node's global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node is PID 1 (no npm/shell wrapper), so SIGTERM reaches the graceful-shutdown handler in main.ts.
CMD ["node", "--import", "tsx", "src/http/main.ts"]
