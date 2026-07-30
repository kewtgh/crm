# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.18.0-bookworm-slim
ARG POSTGRES_IMAGE=postgres:18.4-bookworm

FROM ${NODE_IMAGE} AS node-toolchain
RUN npm install --global npm@12.0.1

FROM node-toolchain AS dependencies
WORKDIR /app
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,id=lumina-crm-npm,target=/root/.npm \
    npm ci

FROM dependencies AS build
WORKDIR /app
COPY . .
RUN npm run build:raw

FROM build AS verification
RUN npm run typecheck:raw \
    && npm run lint:raw \
    && npm run test:contracts:raw \
    && npm run test:deploy:raw

FROM node-toolchain AS production-dependencies
WORKDIR /app
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,id=lumina-crm-npm-production,target=/root/.npm \
    npm ci --omit=dev \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS application
ARG LUMINA_VCS_REF=unknown
LABEL com.lumina.crm.managed="true" \
      com.lumina.crm.repository="kewtgh/crm" \
      com.docker.compose.project="lumina-crm" \
      org.opencontainers.image.source="https://github.com/kewtgh/crm" \
      org.opencontainers.image.revision="${LUMINA_VCS_REF}"
ENV NODE_ENV=production \
    PORT=3200 \
    NEXT_TELEMETRY_DISABLED=1 \
    HOME=/home/lumina \
    XDG_CACHE_HOME=/tmp/lumina-cache \
    PATH=/app/node_modules/.bin:$PATH
RUN groupadd --gid 10001 lumina \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/lumina lumina
WORKDIR /app
COPY --from=production-dependencies --chown=lumina:lumina /app/node_modules ./node_modules
COPY --from=build --chown=lumina:lumina /app/dist ./dist
COPY --chown=lumina:lumina package.json package-lock.json ./
COPY --chown=lumina:lumina \
    scripts/bootstrap-admin.mjs \
    scripts/container-entrypoint.mjs \
    scripts/db-backup.mjs \
    scripts/db-bootstrap.mjs \
    scripts/db-migrate.mjs \
    scripts/db-restore-test.mjs \
    scripts/db-verify-migrations.mjs \
    scripts/process-calendar-deliveries.mjs \
    scripts/process-generated-jobs.mjs \
    scripts/process-integration-sync.mjs \
    scripts/process-notification-outbox.mjs \
    scripts/process-reminders.mjs \
    scripts/process-webhook-inbox.mjs \
    scripts/process-worker-cycle.mjs \
    scripts/run-worker-loop.mjs \
    scripts/worker-healthcheck.mjs \
    scripts/worker-heartbeat.mjs \
    scripts/worker-schema-check.mjs \
    ./scripts/
COPY --chown=lumina:lumina \
    scripts/lib/backup-crypto.mjs \
    scripts/lib/backup-policy.mjs \
    scripts/lib/bounded-concurrency.mjs \
    scripts/lib/delivery-webhook.mjs \
    scripts/lib/worker-database.mjs \
    scripts/lib/worker-object-store.mjs \
    ./scripts/lib/
COPY --chown=lumina:lumina db ./db
USER 10001:10001
EXPOSE 3200
ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
CMD ["web"]

FROM ${POSTGRES_IMAGE} AS operations
ARG LUMINA_VCS_REF=unknown
LABEL com.lumina.crm.managed="true" \
      com.lumina.crm.repository="kewtgh/crm" \
      com.docker.compose.project="lumina-crm" \
      org.opencontainers.image.source="https://github.com/kewtgh/crm" \
      org.opencontainers.image.revision="${LUMINA_VCS_REF}" \
      com.lumina.crm.image-kind="operations"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOME=/home/lumina \
    XDG_CACHE_HOME=/tmp/lumina-cache \
    PATH=/app/node_modules/.bin:/usr/lib/postgresql/18/bin:$PATH
COPY --from=application /usr/local /usr/local
RUN groupadd --gid 10001 lumina \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/lumina lumina
WORKDIR /app
COPY --from=application --chown=lumina:lumina /app /app
USER 10001:10001
ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
CMD ["backup"]
