# Docker + PostgreSQL + Railway deployment

The app runs as **one container**: a Node server (`server/`) that serves the built React app
and the API, on top of a **plain PostgreSQL** database. Supabase is not required.

```text
Browser ──HTTPS──▶ Railway service (Docker)               ┌──────────────┐
                    ├─ /            built React app       │ Railway      │
                    ├─ /auth/v1     email + password, JWT │ PostgreSQL   │
                    ├─ /rest/v1     table queries + RPC ──┼─▶ RLS + fn_* │
                    ├─ /storage/v1  uploads, signed URLs  │ (all 17      │
                    ├─ /functions/v1  admin-users,        │ migrations)  │
                    │                 auth-links          └──────────────┘
                    └─ Volume /data/storage  (uploaded files)
```

## How it works

- `server/db/00_compat.sql` adds the few Supabase objects the migrations expect (roles `anon` /
  `authenticated` / `service_role`, `auth.users`, `auth.uid()`, `storage.buckets/objects`). Then
  `supabase/migrations/*.sql` run **unchanged**, once each (tracked in `public.app_schema_migrations`).
- Every API request runs in one transaction as the database role `authenticated` with the caller's
  JWT claims set. Row Level Security and the `SECURITY DEFINER` functions therefore enforce the
  Admin / Support / Viewer rules exactly as before. The API never builds SQL from client input:
  tables, columns and functions are checked against the database catalog and the role's grants.
- `supabase/functions/*/handler.ts` (user management) run inside the Node server. Passwords are
  bcrypt-hashed in `auth.users`; disabling a user takes effect immediately.
- Uploaded files are stored on a volume; metadata and access rules stay in `storage.objects`
  (same RLS policies as migration 04). Downloads use short-lived signed URLs with Range support.
- `05_seed_data.sql` (demo content) is applied only when `SEED_DEMO_DATA=true`.

## Run locally

```bash
docker compose up --build        # http://localhost:3000, first Admin: admin@example.com / change-me-please-123
SEED_DEMO_DATA=true docker compose up --build   # with demo content
```

## Deploy on Railway

1. `railway login`, then in the repo: `railway init` (or link an existing project).
2. Add **PostgreSQL**: `railway add --database postgres` (or Dashboard → New → Database → PostgreSQL).
3. Add the app service from this repo (Dashboard → New → GitHub repo, or `railway up`).
   `railway.json` selects the `Dockerfile` and the `/healthz` health check.
4. Add a **Volume** to the app service, mount path `/data/storage`.
5. App service variables:

   | Variable | Value |
   | :--- | :--- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Postgres service) |
   | `JWT_SECRET` | `openssl rand -hex 32` |
   | `STORAGE_DIR` | `/data/storage` |
   | `RAILWAY_RUN_UID` | `0` (lets the container write to the mounted volume) |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | first Admin (password 12+ chars) |
   | `SEED_DEMO_DATA` | `false` for production |

6. Generate a public domain (Settings → Networking). It is allowed automatically
   (`RAILWAY_PUBLIC_DOMAIN`); set `PUBLIC_URL` if you use a custom domain.
7. Open the domain and sign in with the Admin credentials. Remove `ADMIN_PASSWORD` afterwards
   (it is only used while no Admin exists) and invite the rest of the team from **Users**.

## Onboarding content ("Getting Started" playbook, 5 SOPs, 5 tour videos)

Run from your own machine against the deployed app (about 83 MB of videos are uploaded):

```bash
export BOOTSTRAP_API_URL=https://your-app.up.railway.app
export BOOTSTRAP_ADMIN_EMAIL=you@example.com
export BOOTSTRAP_ADMIN_PASSWORD='...'
npm run bootstrap:content             # dry run, changes nothing
npm run bootstrap:content -- --apply  # import (safe to re-run)
```

The importer signs in as an Admin and only uses the same API and rules as the app.

## Removing demo data

If the app was first started with `SEED_DEMO_DATA=true`, the demo playbooks / issues / guides
from `05_seed_data.sql` are in the database. Set `SEED_DEMO_DATA=false`, then add the variable
`PURGE_DEMO_DATA=true` and redeploy: on start the server runs
[`server/db/remove_demo_data.sql`](../server/db/remove_demo_data.sql) and logs `[purge] done`.
**Remove `PURGE_DEMO_DATA` afterwards.** Only those exact demo ids are deleted; content people
created is kept. (Railway's Data → Query box accepts a single `SELECT` only, so the script cannot
be pasted there; with psql you can also run `psql "$DATABASE_URL" -f server/db/remove_demo_data.sql`.)

## Operations notes

- **Backups:** back up the Postgres service *and* the volume; they belong together.
- **Scaling:** the volume ties the service to one instance. For several instances move uploads
  to S3-compatible storage (only `server/src/storage.ts` changes).
- **Rotating `JWT_SECRET`** signs everyone out and invalidates outstanding download links.
- `npm run storage:audit-orphans` still targets a Supabase project and is not ported.
- Sign-in attempts are throttled per IP+email in memory (per instance).
