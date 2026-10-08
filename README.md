# SchoolERP Backend

Multi-tenant school management API: NestJS 12, Prisma 7, PostgreSQL 16 (row-level security), Redis 7.
The web frontend lives in a separate repo:
[EdTech_Frontend](https://github.com/sumairaakbar8366/EdTech_Frontend).

## Layout

| Path              | What it is                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| `apps/api`        | NestJS API: tenancy, auth, RBAC, platform admin and all school modules     |
| `packages/shared` | Blueprint data shared with the frontend: roles, permissions, navigation, tiers |
| `docker/`         | Local Postgres init (creates the RLS-restricted app role)                  |

## Prerequisites

- **Node.js 22.22+ or 24 LTS.**
- **npm 11+.** npm 10 crashes on this dependency tree (`Cannot read properties of null (reading 'edgesOut')`).
  Upgrade with `npm install -g npm@11`.
- **Docker Desktop** for PostgreSQL 16 and Redis 7, or native installs (see below).

## First-time setup

```bash
cp apps/api/.env.example apps/api/.env    # first! then set JWT_ACCESS_SECRET (command in the file)
npm install                               # installs workspaces, generates the Prisma client
npm run services:up                       # Postgres + Redis in Docker
npm run build:shared
npm run db:migrate                        # applies migrations as the schema owner
npm run db:seed                           # permissions, tiers, platform admin, demo school
```

### Without Docker (native PostgreSQL + Redis on Windows)

Use a local PostgreSQL (16+; tested on 18) and Memurai Developer (Redis for Windows), both on default ports.

```bash
# once, as the postgres superuser: creates the schoolerp + schoolerp_app roles and the database
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f docker/postgres/local-setup.sql
cp apps/api/.env.example apps/api/.env    # URLs already point at localhost:5432 / :6379
npm install
npm run build:shared
npm run db:migrate
npm run db:seed
```

## Running

```bash
npm run dev         # http://localhost:3000/api (watch mode)
```

Then start the frontend (`npm run dev` in EdTech_Frontend) and open it through a `*.localhost` address:

| URL                             | Who                    | Seeded login                                             |
| ------------------------------- | ---------------------- | -------------------------------------------------------- |
| http://localhost:5173           | Public marketing site  | (none)                                                   |
| http://admin.localhost:5173     | Platform admin console | `owner@schoolerp.local` / `SEED_PLATFORM_ADMIN_PASSWORD` |
| http://demo.localhost:5173      | Demo school            | `admin@demo.school` / `SEED_PLATFORM_ADMIN_PASSWORD`     |

## Tests and checks

```bash
npm test            # shared + API unit tests (Vitest)
npm run typecheck
npm run lint
```

## How tenant isolation works

1. **Host → tenant.** `TenantMiddleware` maps `<slug>.<BASE_DOMAIN>` (or a verified custom domain) to a
   school, and `PLATFORM_HOST` to the platform console. Unknown hosts get 404; suspended schools get 403.
2. **Token ↔ tenant.** Access tokens carry the school id. A token only works on its own school's host,
   and platform tokens only work on the platform host.
3. **Postgres RLS.** The API connects as `schoolerp_app` (no superuser, no `BYPASSRLS`). Tenant queries go
   through `prisma.forSchool(id)` / `prisma.inSchoolTransaction(id, fn)`, which set
   `app.current_school_id` per transaction. Tenant tables only expose that school's rows, and with no
   school set they expose nothing.

**Convention:** every migration that adds a tenant-owned table must include `school_id` and enable +
force RLS with a `tenant_isolation` policy (copy the pattern in `20261001000100_tenant_rls`).

## Auth

- Argon2id password hashing, constant-time handling of unknown accounts, login rate limiting.
- 15-minute JWT access token, kept in memory by the web app.
- Rotating opaque refresh token in an `httpOnly`, `SameSite=Strict`, host-only cookie, stored hashed in
  Redis. Reusing a rotated token revokes the whole session.
- Cookie endpoints require `X-Requested-With: XMLHttpRequest` (CSRF defence).
