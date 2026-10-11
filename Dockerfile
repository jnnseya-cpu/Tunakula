# Production image for the Tunakula API (NestJS on Fastify, run directly from TypeScript via tsx).
# The API migrates the database on startup, then serves on $PORT (default 8080).
# The two web frontends are static exports (`npm run build:frontend`) served by a CDN/static host, not this image.
FROM node:22-slim

WORKDIR /app

# Install the whole workspace from a clean lockfile. --include=dev keeps tsx (the TypeScript runner) available.
COPY . .
RUN npm ci --include=dev

ENV NODE_ENV=production
ENV PORT=8080

# Run as the unprivileged user that ships with the node image, from the API workspace.
USER node
WORKDIR /app/backend/api
EXPOSE 8080

# Liveness: the /v1/health route does a database round-trip. No curl in slim, so use node's global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node runs as PID 1 (no npm/shell wrapper), so SIGTERM reaches the process and the graceful-shutdown handler
# in main.ts runs — draining in-flight requests on rolling deploys. tsx is loaded in-process via --import.
CMD ["node", "--import", "tsx", "src/http/main.ts"]
