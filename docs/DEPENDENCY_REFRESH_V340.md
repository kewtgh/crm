# Stable dependency refresh for v3.40

Verified on 2026-10-23 against official Node releases and npm package metadata.
Node 24.22.1 is the selected LTS; Node 26 remains Current. npm is pinned to 12.2.1.
All three application/worker/planning manifests and lockfiles are included.

| Project | Dependency | Previous | Stable target |
| --- | --- | --- | --- |
| Application | @aws-sdk/client-s3 | 3.1146.0 | 3.1156.0 |
| Application | @aws-sdk/s3-request-presigner | 3.1146.0 | 3.1156.0 |
| Application | @fontsource/noto-sans-sc | 5.3.0 | 5.3.1 |
| Application | altcha | 3.2.4 | 3.5.0 |
| Application | altcha-lib | 2.5.0 | 2.7.0 |
| Application | kysely | 0.29.6 | 0.29.7 |
| Application | lucide-react | 1.50.0 | 1.61.0 |
| Application | next | 16.3.8 | 16.4.2 |
| Application | react | 19.3.0 | 19.3.1 |
| Application | react-dom | 19.3.0 | 19.3.1 |
| Application | read-excel-file | 9.3.10 | 9.3.12 |
| Application | vinext | 1.0.1 | 1.3.0 |
| Application | zod | 4.6.5 | 4.6.7 |
| Application | @vitejs/plugin-react | 6.1.1 | 6.1.2 |
| Application | @vitejs/plugin-rsc | 0.5.35 | 0.5.38 |
| Application | eslint | 10.12.0 | 10.13.0 |
| Application | eslint-config-next | 16.3.8 | 16.4.2 |
| Application | playwright-core | 1.64.0 | 1.64.1 |
| Application | react-server-dom-webpack | 19.3.0 | 19.3.1 |
| Email worker | wrangler | 4.147.0 | 4.152.0 |
| Planning reference | @prisma/client | 7.10.0 | 7.10.1 |
| Planning reference | dotenv | 18.0.5 | 18.0.9 |
| Planning reference | prisma | 7.10.0 | 7.10.1 |

Prisma latest-tag 8.0.0-rc.27 was explicitly rejected; both Prisma packages use stable 7.10.1.
Node type definitions remain on the latest Node 24 line. The official TypeScript 6 API
compatibility package and stable TypeScript 7 compiler alias retain their distinct roles.
Local bounded braces/legacy brace-expansion adapters remain security controls, not upstream
prerelease selections. Existing stable packages that are already current retain their pins.
Chromium revision 1248 remains required; the Playwright patch must declare that same revision.

Sources: [Node LTS release](https://nodejs.org/en/blog/release/v24.22.1),
[npm registry](https://registry.npmjs.org/), [Vinext release notes](https://vinext.dev/blog).
Exact discovery metadata and installation logs remain private under ignored `work/v340/`.

All three npm audits finish with zero vulnerabilities. The application production build,
fresh typecheck, changed-file lint, 124 worker tests, ALTCHA regressions and planning schema
validation pass on the selected LTS runtime; see [verification](V340_VERIFICATION.md).

Transitive security pins also advance: baseline-browser-mapping 2.11.31, browserslist 4.29.4,
fast-uri 4.2.3, js-yaml 5.5.0, nanoid 6.0.2, PostCSS 8.5.31 and planning mysql2 3.24.6.
The known ESLint 10 versus Next-plugin peer declaration warning remains covered by the existing
official compatibility wrappers; verification must run actual lint, without weakening policy.

Build configuration advances to BuildKit 0.34.1 and Dockerfile frontend 1.28.0. Host provisioning
guidance now lists Docker Engine 29.9.2, Compose 5.6.1, Buildx 0.38.1, Caddy 2.11.7 and
cloudflared 2026.10.3, verified from their official release metadata. PostgreSQL 18.6 remains
the latest stable PostgreSQL major/minor; PostgreSQL 19 RC is excluded. This repository change
does not install host-managed packages or replace an existing builder container.
