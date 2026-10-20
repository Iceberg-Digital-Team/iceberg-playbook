# First Deployment Guide

This guide is a target-backend-neutral operational checklist for engineering teams executing the **first clean deployment** of Playbook into Iceberg's production environment.

---

## Phase 1: Clone & Repository Inspection

1. **Clone the repository**:
   ```bash
   git clone <iceberg-playbook-repo-url>
   cd iceberg-playbook
   ```
2. **Install local dependencies**:
   ```bash
   npm install
   ```
3. **Review Handover Documents**:
   - [`HANDOVER.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/HANDOVER.md) — Core principles and system inventory.
   - [`AGENT_SETUP_PROMPT.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/AGENT_SETUP_PROMPT.md) — Master prompt for AI coding agents.
   - [`docs/BACKEND_REPLACEMENT_CONTRACT.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/docs/BACKEND_REPLACEMENT_CONTRACT.md) — Required functional contracts.
   - [`docs/INFRASTRUCTURE_MIGRATION.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/docs/INFRASTRUCTURE_MIGRATION.md) — Component replacement blueprint.
   - [`bootstrap/README.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/bootstrap/README.md) — Onboarding bundle specifications.

---

## Phase 2: Declare Target Production Infrastructure

Before making code modifications, the incoming engineering team must declare Iceberg's selected production architecture:

| Infrastructure Area | Iceberg Target Selection |
| :--- | :--- |
| **Authentication & Identity** | *(e.g., Iceberg SSO, OAuth2/OIDC, Auth0, Active Directory)* |
| **Database Engine** | *(e.g., PostgreSQL, Amazon Aurora, Google Cloud SQL)* |
| **API & Backend Layer** | *(e.g., Node.js / Express / NestJS, Go, .NET, Python FastAPI)* |
| **Object / Media Storage** | *(e.g., AWS S3, MinIO, Azure Blob Storage, Cloud Storage)* |
| **Hosting Platform** | *(e.g., AWS ECS/S3/CloudFront, Kubernetes, Vercel, Internal VMs)* |

---

## Phase 3: Backend Implementation & Adapter Replacement

1. **Database Schema Creation**:
   - Reference [`supabase/migrations/`](file:///c:/Users/tarik/Desktop/icebergnew-git/supabase/migrations/) (01 through 17) for authoritative schemas, indexes, and constraints.
   - Deploy clean migrations directly onto the target database engine.
   - **Do not run `supabase db push` against the reference instance.**
2. **Implement Authentication Adapter**:
   - Create a production adapter implementing [`AuthAdapter`](file:///c:/Users/tarik/Desktop/icebergnew-git/src/auth/auth.ts) in `src/auth/`.
   - Update `src/auth/AuthProvider.tsx` to mount your new adapter.
3. **Implement Service Data Layers**:
   - Replace internal PostgREST query calls in `src/services/` with requests to Iceberg's API endpoints.
   - Ensure domain return types (`Playbook`, `Issue`, `VersionedGuide`, `SOP`, `AdminUser`) remain unchanged.
4. **Implement Private Storage & Signed URLs**:
   - Adapt `src/services/mediaService.ts` to upload files to Iceberg's private object storage.
   - Provide temporary, authorized signed URLs for browser video/PDF/screenshot rendering.
5. **Implement Server-Side Authorization**:
   - Ensure the backend API validates user session tokens and enforces role restrictions (`Admin`, `Support`, `Viewer`) on all write, update, and soft-delete endpoints.

---

## Phase 4: First Administrator Provisioning

Because Playbook strictly enforces **invite-only access** and prohibits public self-registration:

> [!CAUTION]
> **The initial Administrator account cannot register through the portal UI.**
> You must provision the first Admin account directly through your target identity provider and database before launching the portal.

1. **Create Identity in Target Auth System**:
   - Provision an account with email address: `admin@yourdomain.com`.
2. **Create User Profile Record in Database**:
   - Insert the corresponding user profile row with:
     - `role`: `'Admin'`
     - `status`: `'Active'`
3. **Verify Admin Access**:
   - Launch the local frontend dev server (`npm run dev`) or test deployment.
   - Sign in as the newly provisioned Administrator.
   - Confirm access to the top-level navigation, including the Admin-only **Users** console (`/users`).

---

## Phase 5: Bootstrap Canonical Onboarding Content

The repository includes a canonical, vendor-neutral onboarding package under `bootstrap/`:
- [`bootstrap/default-content.json`](file:///c:/Users/tarik/Desktop/icebergnew-git/bootstrap/default-content.json)
- Canonical tour videos under [`bootstrap/assets/getting-started/`](file:///c:/Users/tarik/Desktop/icebergnew-git/bootstrap/assets/getting-started/)

### Steps to Ingest:

1. **Adapt the Bootstrap Importer**:
   - The importer script [`scripts/bootstrap_content.mjs`](file:///c:/Users/tarik/Desktop/icebergnew-git/scripts/bootstrap_content.mjs) delegates mutations through an adapter contract.
   - Create an adapter targeting your production database and storage APIs (similar to `scripts/lib/bootstrap/supabase_adapter.mjs`).
2. **Execute Dry-Run**:
   ```bash
   npm run bootstrap:content
   ```
   Confirm the output plan schedules:
   - 1 Playbook creation: `Getting Started` (`GS`)
   - 5 SOP creations:
     - `GS-SOP02` — *How to Use Playbooks*
     - `GS-SOP03` — *How to Use Issues*
     - `GS-SOP04` — *How to Use Guides*
     - `GS-SOP05` — *How to Use SOPs*
     - `GS-SOP06` — *How to Manage Users*
   - 5 Media asset uploads targeting your private storage bucket.
3. **Execute Mutation Import**:
   ```bash
   npm run bootstrap:content -- --apply
   ```
4. **Confirm Idempotence (Second Run)**:
   ```bash
   npm run bootstrap:content
   ```
   Verify the second run produces a clean **NOOP** (0 creates, 0 updates, 0 uploads, 0 conflicts).

---

## Phase 6: User Onboarding via Admin Console

Once the First Admin is authenticated and onboarding content is active:

1. Navigate to **Users** in the sidebar navigation (`/users`).
2. Select **Invite user**.
3. Enter team member email, full name, link expiry (e.g., 24h, 3d, 7d), and assigned role (`Viewer`, `Support`, or `Admin`).
4. Copy the generated single-use activation link and securely share it with the team member.
5. Have the team member open the link, set their password, and verify sign-in.

---

## Phase 7: Critical-Flow Verification Checklist

Prior to opening the system to general operational use, verify each flow manually:

- [ ] **Authentication**: Sign in, sign out, persistent session on browser reload.
- [ ] **Playbooks**: Browse playbooks, open workspace tabs (Issues, Guides, SOPs), create a new Playbook.
- [ ] **Issues**: Create an issue, enter a manual `jira_code`, view diagnostic sections, soft-delete an issue.
- [ ] **Guides**: Create a Guide linked to an Issue, publish an update, verify version snapshot in history, perform non-destructive restore of an older version.
- [ ] **SOPs**: Open *How to Use SOPs*, toggle checklist items, verify step tour video playback.
- [ ] **Search**: Trigger global search, search by keyword, verify deep linking to result entities.
- [ ] **User Management**: Change a user's role, toggle disable/enable, generate a password reset link.
- [ ] **Safeguards**: Attempting to disable the current Admin or last active Admin is blocked with clear error messaging.

---

## Phase 8: Production Deployment

Because deployment architecture depends on Iceberg's hosting platform:

- **Static Client**: The frontend is a standard single-page application built via `npm run build`. The generated `dist/` directory can be deployed to AWS S3/CloudFront, Cloudflare Pages, Nginx, or an internal static web server.
- **Backend Services**: Deploy your backend API services and private storage buckets according to your organization's containerization, CI/CD, and security policies.
