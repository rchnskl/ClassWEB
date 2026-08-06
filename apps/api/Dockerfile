# Production image for the ClassWeb NestJS API.
# Multi-stage: install + build with dev deps, then ship a lean runtime image.
# Works on any container host (Fly.io, Railway, Render, Cloudflare Containers).

# ---- build stage ----
FROM node:20-slim AS build
WORKDIR /app

# Prisma needs openssl at generate time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install deps from the monorepo root (workspaces).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/database/package.json packages/database/
RUN npm ci

# Copy sources and build the API + generate the Prisma client.
COPY . .
RUN npm run db:generate \
  && npm run build -w @classweb/api

# Prune to production dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /usr/sbin/nologin app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/assets ./apps/api/assets
COPY --from=build /app/packages/database ./packages/database
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER app
# PORT is provided by the platform; the app reads process.env.PORT.
EXPOSE 3001
CMD ["./docker-entrypoint.sh"]
