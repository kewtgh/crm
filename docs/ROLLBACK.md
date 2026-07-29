# Image rollback runbook

Inspect the persisted accepted and rollback images:

```sh
npm run deploy:production:status
npm run deploy:production:logs
```

Request the recorded rollback:

```sh
npm run deploy:production:rollback
```

The controller writes the prior application/operations images into Compose state, runs
`docker compose up -d --no-deps web worker`, then checks PostgreSQL, Web, Worker, loopback readiness,
Cloudflare liveness, and origin liveness. It never runs reverse migration and never changes the
PostgreSQL volume.

Success explicitly states that the application rolled back while the database retained the forward
schema. If the prior image is incompatible with forward schema, repair forward; do not improvise a
destructive downgrade.
