# Lumina Cloudflare Worker gateway

This Worker is the user-facing `crm.ewaya.com` gateway. `ORIGIN_URL` must be a distinct HTTPS
origin hostname that reaches the host Caddy gateway; using `crm.ewaya.com` as the origin is rejected
to prevent self-invocation.

Provision the non-secret variables from `wrangler.toml.example`, then set the only Worker secret:

```sh
npx wrangler secret put ORIGIN_AUTH_SECRET
```

The Worker removes client-supplied forwarding and `X-Lumina-Origin-Auth` headers, injects the secret,
forwards method/query/body/cookies/content headers, preserves origin status and `Set-Cookie`, and
forces every response to `no-store`. Detailed readiness is rejected; only `/api/health` liveness is
intended for the public route.

Run the proxy contract without deploying:

```sh
npm run cloudflare:test
```
