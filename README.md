# Iceberg Playbook

Internal operational knowledge and problem-solving platform developed for **Iceberg Digital**.

Iceberg Playbook enables the Support Team to systematically document recurring problems, connect them with verified step-by-step solutions, maintain standard operating procedures, and rapidly resolve customer inquiries by reusing institutional knowledge.

This repository contains a fully functional, Supabase-backed implementation prepared for engineering handover.

---

## 1. Project Overview

Iceberg Playbook is designed to eliminate redundant troubleshooting and preserve technical and operational knowledge across Iceberg Digital products and platforms.

The system is built on four core domain concepts:

- **Playbook**: A product, platform, or operational domain (e.g., WhatsApp, Lifesycle, Meta Business, CRM, Website).
- **Issue**: A recurring problem encountered by the Support Team (e.g., `WA-001 — Phone Number Already Registered`). An Issue documents the *problem*, not the resolution.
- **Guide**: The documented, verified resolution to a specific Issue. Every Guide is linked directly to an existing Issue.
- **SOP (Standard Operating Procedure)**: Standardized operational workflows and procedures (e.g., onboarding, system maintenance, audits) that operate independently of specific Issues.

The repository provides a complete, working client-and-database implementation backed by Supabase (PostgreSQL, Supabase Auth, Row Level Security, and Supabase Storage). It is prepared for handover, infrastructure review, and integration into Iceberg's operational environment.

---

## 2. Current Features

- **Authentication**: Live authentication via Supabase Auth adapter (`supabaseAuthAdapter`) with session persistence, automatic token refresh, and secure sign-out.
- **User Profiles & Roles**: User profile data linked to Supabase Auth (`public.profiles`) supporting three role tiers:
  - `Admin` — Full access, administrative configuration, and soft-delete capabilities.
  - `Support` — Create and edit Playbooks, Issues, Guides, and SOPs.
  - `Viewer` — Read-only access across the knowledge base.
- **Playbooks**: Hierarchical organization by domain/service, automatic Latin slug generation (including Turkish character transliteration), and domain-specific item listing.
- **Issues**: Problem tracking with playbook linkage, severity/impact definitions, manual Jira Code references, and relationship to resolution Guides.
- **Manual Jira Code Field on Issues**: Dedicated field (`jira_code`) on Issues for referencing related internal Jira tickets. Active rows are indexed for search.
- **Guides**: Comprehensive resolution documentation with structured sections (Summary, Before You Start, Important Information, Step-by-Step, Media/Tutorials, Common Problems, Internal Notes).
- **Guide Versioning**: Immutable historical version snapshots. Every published update produces a traceable version. Older versions can be inspected and restored without overwriting historical version records.
- **SOPs (Standard Operating Procedures)**: Standalone operational workflows featuring checklists, prerequisites, responsible teams, execution steps, and escalation guidelines.
- **Database-Backed Content**: All active application data is persisted directly in PostgreSQL tables via Supabase with Row Level Security (RLS) enforcement.
- **Unified Search**: Live search aggregating active Playbooks, Issues, Guides, and SOPs, with type filtering and playbook-specific filtering.
- **Media & Attachment Handling**: File upload and signed URL delivery backed by Supabase Storage (`support-assets` private bucket), with MIME type and size validation (up to 50 MB) and tracking in `public.media_files`.
- **Soft Delete**: Application-wide soft-delete mechanism utilizing `deleted_at` timestamps and dedicated database functions (`fn_soft_delete_*`). Soft-deleted records are excluded from active user views and search results.
- **Monotonic Code Generation**: Guaranteed unique, sequential human-readable codes (`WA-001`, `WA-G01`, `WA-SOP01`) generated atomically via `SECURITY DEFINER` database functions (`fn_generate_issue_code`, `fn_generate_guide_code`, `fn_generate_sop_code`), ensuring codes are never reused even across soft-deleted rows.
- **Unsaved-Changes Protection**: Navigation blocking and dirty-state detection across all create and edit forms, prompting users with confirmation dialogs prior to discarding uncommitted edits.
- **Quick Access on Home**: Real-time aggregation of recently updated active Issues, Guides, and SOPs directly from the database.

> [!IMPORTANT]
> **Key Distinctions & Removed Features:**
> - **Troubleshooting has been removed**: Legacy troubleshooting entities and modules have been completely purged from the codebase, search index, and database schema.
> - **NO Jira API Integration**: There is no direct integration, webhook, or API sync with Atlassian Jira. The `jira_code` field is strictly a manually entered reference string.

---

## 3. Technology Stack

The repository utilizes the following technologies:

- **Frontend Framework**: React 19 (`react`, `react-dom`)
- **Language**: TypeScript (strict configuration)
- **Build Tooling & Dev Server**: Vite
- **Icons**: Lucide React (`lucide-react`)
- **Linter**: Oxlint (`oxlint`)
- **Test Runner**: Node.js native test runner (`node --test`)
- **Backend / BaaS**: Supabase (`@supabase/supabase-js`)
- **Database**: PostgreSQL (with Row Level Security and PL/pgSQL functions)
- **Auth Provider**: Supabase Auth
- **Object Storage**: Supabase Storage (private bucket)

---

## 4. Current Architecture

The application is structured into three primary architectural layers:

```text
React / TypeScript UI (Views, Forms, Router)
              ↓
Services & Data-Access Layer (src/services/, src/auth/, src/search/)
              ↓
Supabase Backend (PostgreSQL, Auth, RLS, Storage, RPCs)
```

1. **Client UI Layer (`src/pages/`, `src/components/`)**:
   - Hash-based SPA routing with form-dirty guards and unsaved-changes protection.
   - Clean separation of presentation components and domain-specific knowledge views.
2. **Data-Access & Service Layer (`src/services/`, `src/lib/`, `src/auth/`)**:
   - Centralized Supabase client abstraction (`src/lib/supabase.ts`).
   - Domain services (`playbookService`, `issueService`, `guideService`, `sopService`, `homeService`, `mediaService`) encapsulate database queries, payload mapping, validation, and RPC invocations.
   - Decoupled auth adapter pattern (`AuthAdapter` interface) implemented by `supabaseAuthAdapter`.
3. **Supabase Infrastructure Layer**:
   - **PostgreSQL Database**: Relational schema storing playbooks, issues, guides, guide versions, sops, profiles, and media files.
   - **Row Level Security (RLS)**: Enforces access policies based on user session roles (`Admin`, `Support`, `Viewer`).
   - **Database Functions & RPCs**: Atomic operations including monotonic ID generation and soft-deletion routines.
   - **Supabase Storage**: Secure private object storage bucket with signed URL retrieval.

*Note for Handover*: Supabase currently satisfies authentication, database, authorization, and object storage requirements. Iceberg engineers may later replace or adapt these infrastructure dependencies to Iceberg's in-house infrastructure.

---

## 5. Repository Structure

The core directories in this project are organized as follows:

- **`src/`**: Primary application source code (components, pages, services, router, and styles).
- **`src/auth/`**: Authentication interfaces, `AuthProvider`, profile definitions, and the Supabase Auth adapter.
- **`src/components/`**: Reusable UI components organized by domain (`layout`, `article`, `knowledge`, `auth`).
- **`src/pages/`**: Route-level views (Home, Playbooks, Issues, Guides, SOPs, Search, Settings, Login).
- **`src/services/`**: Data-access services handling communication with Supabase tables and RPC functions.
- **`src/lib/`**: Client configurations and environment validation utilities (`supabase.ts`).
- **`supabase/migrations/`**: Authoritative PostgreSQL migrations defining schemas, tables, RLS policies, functions, and seed data.
- **`supabase/tests/`**: Database verification scripts and schema/policy test routines.
- **`scripts/`**: Tooling and maintenance scripts (e.g., `generate_seed.mjs` for validating and generating seed migrations).
- **`public/`**: Static assets, favicon, icons, and web manifest.

---

## 6. Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [npm](https://www.npmjs.com/) (v10+ recommended)
- Access to a Supabase project (hosted or local instance)

### Setup Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nottrixx/iceberg-playbook.git
   cd iceberg-playbook
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy the example environment configuration file to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Open `.env.local` and specify your Supabase connection settings:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```
   *(Alternatively, `VITE_SUPABASE_PUBLISHABLE_KEY` can be used instead of `VITE_SUPABASE_ANON_KEY`).*

4. **Start the local development server:**
   ```bash
   npm run dev
   ```
   The development server will launch at `http://localhost:5173/`.

---

## 7. Environment Variables

Client configuration is read at startup via Vite environment variables defined in `.env.local`:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `VITE_SUPABASE_URL` | **Yes** | The HTTPS URL of the Supabase project (e.g., `https://xyzproject.supabase.co`). |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Alternative | Supabase client publishable API key. |
| `VITE_SUPABASE_ANON_KEY` | Alternative | Supabase client anonymous API key. |

> [!NOTE]
> Either `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` must be provided. If both are present, `VITE_SUPABASE_PUBLISHABLE_KEY` takes precedence.

> [!CAUTION]
> **Secret Isolation**: Supabase `service_role` keys, database passwords, and private service credentials must **NEVER** be exposed through `VITE_` variables or committed to version control. Client variables are compiled directly into public browser bundles.

---

## 8. Validation Commands

The repository provides the following npm scripts for validation and testing:

```bash
# Start Vite development server with Hot Module Replacement (HMR)
npm run dev

# Run TypeScript type check and compile production bundle
npm run build

# Run automated unit and integration tests using Node.js native test runner
npm test

# Run Oxlint static analysis across TypeScript and JavaScript source files
npm run lint

# Preview the local production build generated by npm run build
npm run preview
```

---

## 9. Supabase / Database Overview

The database layer runs on PostgreSQL managed through Supabase. All schemas, tables, constraints, security policies, and stored functions are managed through migrations located in:

`supabase/migrations/`

Key migrations include:
- `01_schema_and_types.sql`: Base tables (`playbooks`, `issues`, `guides`, `guide_versions`, `sops`, `profiles`, `media_files`) and enums.
- `02_constraints_and_indexes.sql`: Foreign keys, integrity checks, and search indexes.
- `03_business_functions.sql`: Stored functions and operational procedures.
- `04_security_and_rls.sql`: Row Level Security policies and role-based permissions (`Admin`, `Support`, `Viewer`).
- `05_seed_data.sql`: Development and demo seed dataset.
- `06_table_privileges.sql`: Table-level schema grants for authenticated and service roles.
- `07_soft_delete_security.sql`: Soft-delete policies and audit routines.
- `08_monotonic_code_generation.sql`: Monotonic code generator functions operating across active and soft-deleted rows.
- `09_issue_jira_code.sql`: Jira code reference column and active index on issues.

> [!NOTE]
> Detailed migration deployment instructions, setup procedures, and database configuration guidance will live in `supabase/README.md`.

> [!IMPORTANT]
> The seed data defined in `05_seed_data.sql` is provided for development and demo environments. It must not automatically be treated as production data.

---

## 10. Authentication Overview

Authentication in Iceberg Playbook is live and backed by Supabase Auth:
- **Runtime Adapter**: `AuthProvider` (`src/auth/AuthProvider.tsx`) uses `supabaseAuthAdapter` (`src/auth/supabaseAuth.ts`) by default.
- **Session Lifecycle**: Supports email/password authentication, persistent sessions via browser storage, automatic token renewal, and sign-out.
- **Authorization & Profiles**: User access is governed by the `public.profiles` table, associating each authenticated user ID with their name, department, and role (`Admin`, `Support`, `Viewer`).
- **Row Level Security**: Access to database records is restricted according to authenticated session tokens and profile roles.

Detailed authentication architecture, session management details, and backend integration guidance live in:
`src/auth/README.md`

---

## 11. Media / Storage

Media attachments, screenshots, and PDF documents are managed via Supabase Storage:
- **Bucket**: Stored in a private Supabase Storage bucket named `support-assets`.
- **Access Control**: Governed by Storage RLS policies, restricting read and upload access to authenticated users with appropriate roles.
- **URL Resolution**: The application stores persistent storage paths and generates short-lived signed URLs on demand for secure rendering in the browser.
- **Metadata**: File metadata (name, size, MIME type, storage path) is tracked in the `public.media_files` database table.

---

## 12. Jira Code

Iceberg Playbook **does not** integrate with the Atlassian Jira API:
- Issues include an optional `jira_code` field (e.g., `SUP-1042`, `ICE-482`) entered manually by team members during issue creation or editing.
- The field serves as a human-readable cross-reference between an Iceberg Playbook Issue and external tracking systems.
- Active issues with Jira codes are indexed in PostgreSQL for fast lookup during search.
- **No Jira credentials, API tokens, or webhooks are required by the current application.**

---

## 13. Demo / Sample Data

The repository includes a curated set of development and demonstration data:
- Pre-populated Playbooks, Issues, Guides, and SOPs are maintained in `src/sampleData.ts`.
- The synchronization script `scripts/generate_seed.mjs` validates data invariants (e.g., referential integrity, matching playbook IDs, valid version snapshots) and generates the SQL migration `supabase/migrations/05_seed_data.sql`.
- Demo data provides immediate context for testing workflows, search functionality, and rendering, but should be replaced or cleaned prior to production deployment.

---

## 14. Infrastructure Portability / Handover

While the current implementation uses Supabase, the application architecture separates presentation from data access to facilitate future infrastructure migration by Iceberg engineers.

### Current Implementation vs. Iceberg Infrastructure Mapping

| Component | Current Implementation | Possible Iceberg Replacement |
| :--- | :--- | :--- |
| **Authentication** | Supabase Auth (`supabaseAuthAdapter`) | Iceberg SSO / Internal OAuth / LDAP / Auth0 |
| **Database** | Supabase Managed PostgreSQL | Iceberg PostgreSQL / Internal Relational Database |
| **Authorization** | Supabase RLS + `public.profiles` | Backend API Middleware / Application RBAC |
| **Object Storage** | Supabase Storage (`support-assets`) | AWS S3 / MinIO / Internal Blob Storage |
| **Business Logic** | PostgreSQL Stored Functions / RPCs | Backend API Services (Node.js, Go, Python) |

> [!WARNING]
> Infrastructure migration is **not** plug-and-play. Supabase-specific integrations—such as PostgreSQL Row Level Security policies, database RPC functions (`fn_soft_delete_*`, `fn_generate_*_code`), Supabase Storage client calls, and Supabase Auth session handling—will need to be replaced or adapted by the engineering team.

---

## 15. Security Notes

- **Never Commit Secrets**: Do not commit `.env`, `.env.local`, or any files containing private keys, access tokens, or connection strings.
- **Client Key Isolation**: Only public client keys (`VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`) may be placed in client environment files.
- **No Service Role Keys in Client**: The Supabase `service_role` key bypasses all Row Level Security policies and must **NEVER** be present in the frontend client application or Vite configuration.
- **Template Placeholders Only**: `.env.example` contains only placeholder variable keys and no sensitive connection values.
- **Strict Input Validation**: Forms and upload handlers enforce MIME type checks, payload size limits, and dirty-state protection.

---

## 16. Current Handover Status

The core application implementation is complete. All primary capabilities—including database persistence, authentication, role-based access, Guide versioning, SOP management, unified search, media handling, and soft delete—are implemented, validated, and functioning.

The repository is currently in the **Handover / QA / Documentation Preparation** phase, focusing on:
- Ensuring comprehensive documentation for engineering handover.
- Preparing migration and database guides in `supabase/README.md`.
- Supporting final QA and architectural review by the incoming development team.

---

**Internal Project — Iceberg Digital**
