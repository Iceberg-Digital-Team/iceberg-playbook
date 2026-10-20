# Playbook Handover

Welcome to the **Iceberg Playbook** codebase. This repository contains the complete, production-ready frontend application alongside a validated reference backend implementation.

This document is the primary human entry point for engineers, architects, and technical leads responsible for receiving, evaluating, and deploying Playbook into Iceberg's permanent infrastructure.

---

## 1. What This Repository Contains

1. **Complete Playbook Frontend Application**:
   - Modern React 19 + TypeScript SPA built with Vite.
   - Clean, modular presentation layer decoupled from any specific backend vendor.
   - Core knowledge modules: **Playbooks**, **Issues**, **Guides** (with immutable versioning), and **SOPs** (with interactive checklists).
   - Global multi-entity search across active content.
   - Full-featured **User Management** console (`/users`) and account activation flow (`/activate`).
   - Dirty-form protection and unsaved-changes confirmation dialogs across all authoring views.

2. **Functional Reference Backend Implementation**:
   - Complete Supabase reference implementation used to develop, test, and prove all system capabilities.
   - Comprehensive PostgreSQL database schema, relational constraints, monotonic sequence generators, and atomic stored procedures (RPCs).
   - Database-level Row Level Security (RLS) policies enforcing 3-tier Role-Based Access Control (`Admin`, `Support`, `Viewer`).
   - Private object storage architecture with signed URL generation for video, PDF, and screenshot assets.
   - Reference Edge Functions for administrative user management (`admin-users`) and single-use link consumption (`auth-links`).

3. **Portable Getting Started Onboarding Package**:
   - Canonical vendor-neutral bundle in [`bootstrap/default-content.json`](file:///c:/Users/tarik/Desktop/icebergnew-git/bootstrap/default-content.json) validated against JSON Schema [`bootstrap/default-content.schema.json`](file:///c:/Users/tarik/Desktop/icebergnew-git/bootstrap/default-content.schema.json).
   - Zero hardcoded vendor IDs, zero environment-specific URLs.
   - **5 Production Onboarding Videos** fully integrated under [`bootstrap/assets/getting-started/`](file:///c:/Users/tarik/Desktop/icebergnew-git/bootstrap/assets/getting-started/):
     - `playbooks/how-to-use-playbooks-tour.mp4`
     - `issues/how-to-use-issues-tour.mp4`
     - `guides/how-to-use-guides-tour.mp4`
     - `sops/how-to-use-sops-tour.mp4`
     - `users/how-to-manage-users-tour.mp4`
   - Automated, idempotent CLI importer (`scripts/bootstrap_content.mjs`) featuring dry-run by default, explicit `--apply` flag, content-addressable SHA-256 asset storage, and collision prevention.

4. **Exhaustive Automated Verification Suite**:
   - **366 / 366 passing tests** using Node.js native test runner (`npm test`).
   - Complete static type-checking and production bundling (`npm run build`).
   - Oxlint static analysis with zero errors (`npm run lint`).

---

## 2. CRITICAL PRODUCTION STATEMENT

> [!IMPORTANT]
> **SUPABASE IS A REFERENCE IMPLEMENTATION ONLY.**
>
> The current Supabase integration (PostgreSQL, PostgREST, GoTrue Auth, Storage bucket, and Edge Functions) was developed as a high-fidelity reference environment to design, prove, and test all functional and security contracts.
>
> **Iceberg is expected to replace Supabase with its own production infrastructure.**
>
> In the final Iceberg production environment, the engineering team will replace:
> - **Authentication**: Supabase Auth → Iceberg SSO, OAuth2/OIDC, or corporate identity provider.
> - **Database & Data APIs**: Supabase PostgREST queries → Iceberg REST, GraphQL, or gRPC backend services.
> - **RPCs & Stored Procedures**: PL/pgSQL database functions → Backend application domain logic.
> - **File & Media Storage**: Supabase Storage (`support-assets`) → AWS S3, MinIO, Azure Blob, or internal object store.
> - **Media URL Resolution**: Supabase signed URLs → Authorized pre-signed URLs or streaming media gateways.
> - **Administrative Operations**: Supabase Edge Functions → Iceberg admin microservices.
>
> The frontend UI and presentation components **do not directly import or depend on Supabase SDKs**. All backend operations are encapsulated behind domain service interfaces in `src/services/` and `src/auth/`.

---

## 3. Product Behavior That Must Be Preserved

Regardless of what target infrastructure Iceberg selects, the following core product behaviors and invariants must remain intact:

1. **Role-Based Access Control (RBAC)**:
   - Three roles: `Admin`, `Support`, `Viewer`.
   - `Viewer`: Read-only access across all active knowledge.
   - `Support`: Create and edit Playbooks, Issues, Guides, and SOPs; soft-delete permissions where authorized.
   - `Admin`: Full access, soft-deletion, and exclusive access to User Management (`/users`).

2. **Invite-Only Access & Security Safeguards**:
   - Strictly **no public self-registration**. All users must be invited by an Administrator.
   - Activation links are single-use, time-limited, and exposed only once upon generation (stored only as SHA-256 token hashes).
   - **Self-action protection**: An Admin cannot disable or demote their own account.
   - **Last-admin protection**: The system strictly prevents disabling or demoting the last active Administrator.

3. **Domain Knowledge Architecture**:
   - **Playbooks**: Top-level knowledge domains with unique alphanumeric code prefixes (2–5 characters, e.g. `WA`, `CRM`). Soft-deleted Playbooks can be detected on duplicate creation and restored with their historical associations intact.
   - **Issues**: Distinct problem descriptions belonging to a Playbook, with monotonic human-readable codes (e.g. `WA-001`).
   - **Manual Jira Code**: Issues feature an optional, indexed `jira_code` text field (e.g., `SUP-1042`). **There is no direct integration, webhook, or sync with the Atlassian Jira API.** This must remain a lightweight manual reference.
   - **Guides (1:1 with Issues)**: Every Guide belongs to exactly one Issue, and an Issue can have at most one active Guide. Guides cannot exist without an Issue.
   - **Guide Versioning & Non-Destructive Restore**: Every published edit creates an immutable historical version snapshot. Restoring an older version creates a new current version snapshot forward without altering history.
   - **SOPs (Independent of Issues)**: Standalone operational procedures belonging directly to a Playbook. An SOP never requires an Issue. SOPs feature process checklists, prerequisite requirements, responsible teams, execution steps, and escalation rules.

4. **Media & Storage Security**:
   - Media (videos, PDFs, images) must remain strictly private. Direct unauthenticated public access is prohibited.
   - Authorized media delivery must use secure, short-lived signed URLs.
   - Historical Guide versions must retain their media links even if newer versions replace them.
   - Orphan media cleanup must enforce a safety grace period (default 24h) and treat content references in active and historical entities as authoritative.

5. **Soft Deletion Everywhere**:
   - Deletion of Playbooks, Issues, Guides, and SOPs is always non-destructive (soft deletion via timestamps/metadata). Soft-deleted records are filtered out from active navigation and search.
   - Deleting an Issue with an active linked Guide is prohibited until the Guide is deleted or unlinked.

---

## 4. Recommended Handover Workflow

When handing this repository over to an engineering team or pairing with an AI coding agent:

1. **Clone the Repository**:
   Ensure you have Node.js (v20+) and npm (v10+) installed.
2. **Review Handover Documentation**:
   - [`HANDOVER.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/HANDOVER.md) (this document)
   - [`AGENT_SETUP_PROMPT.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/AGENT_SETUP_PROMPT.md) (copy/paste prompt for incoming AI agents)
   - [`docs/BACKEND_REPLACEMENT_CONTRACT.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/docs/BACKEND_REPLACEMENT_CONTRACT.md) (vendor-neutral functional contract)
   - [`docs/FIRST_DEPLOYMENT.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/docs/FIRST_DEPLOYMENT.md) (step-by-step first deployment checklist)
   - [`docs/INFRASTRUCTURE_MIGRATION.md`](file:///c:/Users/tarik/Desktop/icebergnew-git/docs/INFRASTRUCTURE_MIGRATION.md) (detailed architectural replacement guide)
3. **Declare Target Infrastructure**:
   Define Iceberg's target production stack (e.g., PostgreSQL/Node API/AWS S3/Auth0 or custom internal services).
4. **Produce a Concrete Replacement Map**:
   Map every Supabase dependency to its target Iceberg equivalent before altering code.
5. **Implement Adapters Behind Existing Service Boundaries**:
   Replace internal service implementations in `src/services/` and `src/auth/` without modifying React presentation components.
6. **Provision First Admin in the New Backend**:
   Directly provision the initial Administrator account in the target identity provider and backend database.
7. **Adapt and Execute the Bootstrap Importer**:
   Update `scripts/lib/bootstrap/` to interface with Iceberg's target backend, run dry-run, inspect the plan, and apply canonical Getting Started content.
8. **Execute End-to-End Verification**:
   Run tests, build, lint, and verify all core product flows manually in the portal.
9. **Deploy**:
   Deploy the static Vite bundle and backend services according to Iceberg's production hosting standards.

---

## 5. Fresh Deployment Caveat: The First Admin

Because Playbook enforces strict invite-only access with no public self-registration:

> [!CAUTION]
> **A completely fresh deployment must provision the FIRST Admin through the target backend or authentication infrastructure directly.**
>
> Do not attempt to add public self-registration to solve initial bootstrapping. Once the initial Administrator account is created and verified, all subsequent team members should be invited through the in-app User Management console (`/users`).

---

## 6. Containerization & Docker Note

**Docker is not a requirement of this reference implementation.**

The application is structured as a standard static React client (built using `npm run build`) and an API backend. If Iceberg's production environment utilizes Docker, Kubernetes, or containerized serverless tasks:
- Introduce container definitions (e.g. `Dockerfile`, `docker-compose.yml`, or Helm charts) **after** the target infrastructure and hosting model are finalized.
- Do not assume or require Docker to build or test the current repository locally.

---

## 7. Important Reference Supabase Migration Warning

> [!WARNING]
> **DO NOT RUN `supabase db push` OR ATTEMPT AUTOMATED MIGRATION REPAIR AGAINST THE EXISTING REFERENCE SUPABASE INSTANCE.**
>
> The remote reference Supabase database (`xwqqngkjlsgwsvacmjmf`) contains timestamp-based versions in its internal `schema_migrations` table from earlier development phases. As a result, its remote migration history is not 1:1 normalized with the local sequential filenames (`01_` through `17_`).
>
> - **Do not run `supabase db push`** against the reference project.
> - **Do not attempt to normalize or repair** remote migration history on that instance.
> - Treat the local SQL migration files in [`supabase/migrations/`](file:///c:/Users/tarik/Desktop/icebergnew-git/supabase/migrations/) as the **authoritative, sequential reference specification** for schema, security rules, and business logic when creating migrations for Iceberg's target database.

---

## 8. Updating Playbook After Handover

This section provides recommended strategies for managing updates, bug fixes, and feature releases from upstream Playbook after handover.

### CASE 1 — Iceberg Has Not Yet Customized or Replaced the Backend

If your working copy still closely matches the delivered reference repository (for instance, during evaluation, early staging, or while still using the reference architecture), updates may normally be reviewed and pulled directly from the stable `main` branch.

Example concept:
```bash
git fetch upstream
git pull upstream main
```

*(Note: This is an example workflow concept; it is not mandatory if Iceberg uses a different Git workflow or branch promotion model).*

### CASE 2 — Iceberg Has Replaced Supabase with Its Own Production Backend

Once Iceberg introduces its own Authentication, Database, Storage, API, deployment configuration, or infrastructure-specific adapters, **incoming upstream changes must NOT be blindly pulled or assumed conflict-free.**

Running an automated `git pull` against a customized codebase risks overwriting Iceberg-specific backend adapters or introducing conflicting service signatures.

Instead, we recommend maintaining two Git remotes:
- **`origin`**: Iceberg's internal production repository.
- **`upstream`**: The delivered/reference Playbook repository.

For future Playbook updates and releases:
1. **Fetch upstream changes**: `git fetch upstream`.
2. **Inspect the diff/release**: Review incoming changes between upstream and your current branch.
3. **Preserve Iceberg adaptations**: Ensure Iceberg-specific backend and infrastructure adapters (`src/services/`, `src/auth/`, deployment configs) are preserved.
4. **Merge or cherry-pick compatible product/frontend fixes**: Integrate general UI, bugfix, or feature improvements selectively.
5. **Resolve conflicts deliberately**: Explicitly review any overlapping files to ensure service contracts and adapter boundaries remain intact.
6. **Run the full validation suite before deployment**: Execute `npm test`, `npm run build`, `npm run lint`, and dry-run bootstrap before shipping.

#### Instructing an AI Coding Agent on Upstream Updates
When working with an AI coding agent to incorporate future upstream changes, provide a targeted instruction such as:

> *"Review the changes between the current Iceberg production branch and upstream/main. Integrate the compatible Playbook changes while preserving Iceberg-specific backend, authentication, storage, deployment, and infrastructure adaptations."*

### Release Version Tags

To ensure clear provenance and traceability, we recommend maintaining release tags such as:
- **`v1.0.0-handover`**: Identifies the exact source version originally delivered to Iceberg.
- **`v1.0.1`**, **`v1.1.0`**, etc.: Subsequent maintenance and feature releases.

The handover tag establishes an immutable reference baseline for three-way merges, diffs, and future upstream integrations.

