# Supabase & Database Architecture

This document serves as the technical reference for the PostgreSQL database, Row Level Security (RLS) policies, database stored functions, object storage, and migration sequence powering the **Iceberg Playbook** backend.

It is structured to guide engineering teams in understanding, provisioning, maintaining, and safely reproducing or migrating the backend infrastructure.

---

## 1. Overview

In the current reference implementation, **Supabase** provides the core backend capabilities:

- **PostgreSQL Database**: Relational schema hosting operational Playbooks, Issues, Guides, Guide Versions, SOPs, Profiles, and Media records.
- **Authentication Integration**: Native identity management via Supabase Auth (`auth.users`), linked 1:1 to application user profiles.
- **Row Level Security (RLS)**: Fine-grained access control enforced at the database engine level according to user roles (`Admin`, `Support`, `Viewer`).
- **Database Functions & RPCs**: PL/pgSQL stored procedures managing atomic operations, such as multi-row Guide version snapshots, safe soft-deletions, and monotonic human-readable code generation.
- **Media & Attachment Storage**: Supabase Storage private S3-compatible bucket (`support-assets`) with signed URL resolution.
- **Application Persistence**: Durable source of truth for all active client interactions.

This architecture serves as the functional reference implementation. Iceberg may elect to retain Supabase or adapt these components to internal infrastructure during handover.

---

## 2. Migration Files

All database schema definitions, security rules, routines, and seed datasets are versioned in `supabase/migrations/`:

| Migration File | Description |
| :--- | :--- |
| **`01_schema_and_types.sql`** | Declares required extensions (`uuid-ossp`, `pgcrypto`), custom ENUM types (`playbook_visibility`, `content_status`, `content_difficulty`, `app_role`), base relational tables (`profiles`, `playbooks`, `issues`, `guides`, `guide_versions`, `sops`, `media_files`, `audit_logs`), and provisions the private `support-assets` storage bucket. |
| **`02_constraints_and_indexes.sql`** | Defines foreign key relationships, format check constraints (e.g. playbook code `^[A-Z0-9]{2,5}$`, issue code `^[A-Z0-9]+-[0-9]{3,}$`), partial indexes for active records (`deleted_at IS NULL`), and the composite foreign key ensuring a Guide's `current_version_id` strictly belongs to the same Guide (`fk_guides_current_version_composite`). |
| **`03_business_functions.sql`** | Declares core business logic functions and stored procedures: `fn_get_current_actor`, initial code generators, `fn_create_guide` (atomic Guide + v1 snapshot creation), `fn_publish_guide_version` (atomic version increment), `fn_restore_guide_version` (restores older snapshot to a new version without rewriting history), and initial soft-delete handlers (`fn_soft_delete_playbook`, `fn_soft_delete_issue`, `fn_soft_delete_guide`, `fn_soft_delete_sop`). |
| **`04_security_and_rls.sql`** | Enables Row Level Security across all tables, creates security helper functions (`fn_user_role`, `fn_is_admin`, `fn_is_support_or_admin`), defines access policies for `Admin`, `Support`, and `Viewer` roles, and configures storage policies for `support-assets`. |
| **`05_seed_data.sql`** | Populates sample Playbooks, Issues, Guides, Guide Versions, and SOPs for development and demo environments using idempotent `ON CONFLICT (id) DO NOTHING` clauses. |
| **`06_table_privileges.sql`** | Grants explicit table-level DML privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) to the `authenticated` role and full privileges to `service_role`. Ensures queries pass table-level checks so PostgreSQL can evaluate RLS policies. |
| **`07_soft_delete_security.sql`** | Elevates soft-delete functions (`fn_soft_delete_*`) to `SECURITY DEFINER` with `SET search_path = ''`. Prevents RLS permission denial when non-admin users (such as `Support`) update records to set `deleted_at = NOW()`. |
| **`08_monotonic_code_generation.sql`** | Upgrades `fn_generate_issue_code`, `fn_generate_guide_code`, and `fn_generate_sop_code` to `SECURITY DEFINER` routines that lock the parent playbook row (`FOR UPDATE`) and compute sequence numbers across **all** historical rows (active + soft-deleted), guaranteeing non-reusable monotonic IDs. |
| **`09_issue_jira_code.sql`** | Adds the optional `jira_code TEXT DEFAULT NULL` column to `public.issues` and creates a partial index `idx_issues_jira_code` on active issues. |
| **`10_restore_playbook.sql`** | The team lead's migration (arrives from `main`). Must run before the User Management migrations 11–13. |
| **`11_user_management.sql`** | User Management data model: `profiles.status` (`Active` / `Disabled`), the `user_invitations` table (invitation and password reset links, token stored only as SHA-256 hash, activation lease columns), constraints and indexes. See `docs/USER_MANAGEMENT_API.md`. *(PROPOSED, not deployed yet.)* |
| **`12_user_invitation_security.sql`** | User Management security: RLS and privileges for `user_invitations`, role/status and no-delete triggers, `fn_admin_*` / activation (claim, release, accept) functions, rate limit table and `fn_rate_limit_hit`, and changes to `fn_user_role`, `fn_get_current_actor` and the `profiles` delete / insert policies. *(PROPOSED, not deployed yet.)* |
| **`13_auth_user_lookup.sql`** | Auth user lookup helper `public.fn_find_auth_user_by_email` restricted to `service_role` for safe account reuse during invitation activation. |
| **`14_sop_media_link.sql`** | Declares `fn_link_sop_media` to atomically associate uploaded media storage keys with active SOPs in `public.media_files`. |
| **`15_sop_media_link_fix.sql`** | Upgrades `fn_link_sop_media` to use the project-standard `public.fn_is_support_or_admin()` security helper. |
| **`16_orphan_media_audit.sql`** | Defines read-only maintenance function `public.fn_audit_orphan_media` inspecting storage objects against authoritative content references with a 24-hour grace period. |
| **`17_sop_bootstrap_key.sql`** | Adds scoped `bootstrap_key` column and partial unique index on `(playbook_id, bootstrap_key)` for deterministic canonical bundle ownership. |
| **`supabase/functions/`** (Edge Functions) | `admin-users` (admin operations; verifies the caller's JWT and active Admin role itself) and `auth-links` (link lookup + activation, deployed with `--no-verify-jwt`, with its own rate limiting), shared code in `_shared/`. Deploy steps: `docs/USER_MANAGEMENT_API.md` §14. |

---

## 3. Safe Migration Order & Handover Caveats

> [!WARNING]
> ### REFERENCE DATABASE MIGRATION HISTORY CAVEAT
> **DO NOT RUN `supabase db push` OR ATTEMPT AUTOMATED MIGRATION REPAIR AGAINST THE EXISTING REFERENCE SUPABASE INSTANCE.**
>
> The remote reference Supabase database (`xwqqngkjlsgwsvacmjmf`) contains timestamp-based versions in its internal `schema_migrations` table from earlier direct/manual setups. As a result, its remote migration history does not map 1:1 to the local sequential filenames (`01_` through `17_`).
>
> - **Do not run `supabase db push`** against the reference project.
> - **Do not attempt to normalize or repair** remote migration history on that instance.
> - For a clean new deployment, treat the local numbered migration files `01_` through `17_` as the **authoritative, sequential reference specification** for schema, security rules, and business logic when creating migrations for Iceberg's target database.

### Structural / Required Migrations (Sequential Order)

When creating or deploying a clean database environment, execute the structural migrations in sequential order:

1. `01_schema_and_types.sql`
2. `02_constraints_and_indexes.sql`
3. `03_business_functions.sql`
4. `04_security_and_rls.sql`
5. `06_table_privileges.sql`
6. `07_soft_delete_security.sql`
7. `08_monotonic_code_generation.sql`
8. `09_issue_jira_code.sql`
9. `10_restore_playbook.sql`
10. `11_user_management.sql`
11. `12_user_invitation_security.sql`
12. `13_auth_user_lookup.sql`
13. `14_sop_media_link.sql`
14. `15_sop_media_link_fix.sql`
15. `16_orphan_media_audit.sql`
16. `17_sop_bootstrap_key.sql`

> [!IMPORTANT]
> **Production Guidance for `05_seed_data.sql`**:
> - `05_seed_data.sql` contains **development and demo sample records**. It should **NOT** automatically be executed in a production environment.
> - Migrations `06` through `17` have **no schema or data dependency on `05_seed_data.sql`**. They modify permissions, function security contexts, table columns, and maintenance routines.
> - In automated CI/CD runners or local development where all numbered files run in alphanumeric order (`01` through `17`), `05_seed_data.sql` is safe to run because of its `ON CONFLICT (id) DO NOTHING` statements. For a clean production deployment, omit `05_seed_data.sql` or execute only the structural migrations.

---

## 4. Seed / Demo Data

The repository provides a structured mechanism for generating and keeping development sample data synchronized:

```text
src/sampleData.ts (TypeScript Master Data)
         │
         ▼ (node scripts/generate_seed.mjs)
scripts/generate_seed.mjs (Invariant Validator & SQL Generator)
         │
         ▼
supabase/migrations/05_seed_data.sql (Generated SQL Seed File)
```

- **`src/sampleData.ts`**: The canonical dataset containing realistic support playbooks (e.g. WhatsApp, Lifesycle, Meta Business), verified Issues, structured Guides with version history, and SOPs.
- **`scripts/generate_seed.mjs`**: Validates data invariants before generating SQL:
  - Ensures every Issue references a valid Playbook.
  - Verifies that Guide `playbookId` matches its linked Issue `playbookId`.
  - Confirms `currentVersionId` exists in `sampleGuideVersions` and belongs to the same Guide.
  - Ensures SOP related issues exist.
  - Escapes JSON payloads and generates idempotent SQL `INSERT` statements with `ON CONFLICT (id) DO NOTHING`.
- **Regenerating Seed SQL**:
  To regenerate the seed migration after editing `src/sampleData.ts`, run from the project root:
  ```bash
  node scripts/generate_seed.mjs
  ```

> [!NOTE]
> Seed data is intended strictly for development and demo testing. Production engineering teams should decide explicitly whether to load initial seed content or start with a clean database.

---

## 5. Core Data Model

The database model reflects the operational domain of Iceberg Playbook:

```text
      ┌───────────────┐
      │  auth.users   │
      └───────┬───────┘
              │ (1:1 via id)
              ▼
      ┌───────────────┐
      │   profiles    │
      └───────────────┘

      ┌───────────────┐
      │   playbooks   │
      └───┬───────┬───┘
          │       │
          ▼       ▼
      ┌────────┐ ┌────────┐
      │ issues │ │  sops  │
      └───┬────┘ └────────┘
          │ (1:1)
          ▼
      ┌────────┐
      │ guides │◀────────┐ (Composite FK ensures version
      └───┬────┘         │  belongs to same Guide)
          │ (1:N)        │
          ▼              │
┌────────────────┐       │
│ guide_versions ├───────┘
└────────────────┘

┌────────────────┐       ┌────────────────┐
│  media_files   │       │   audit_logs   │
└────────────────┘       └────────────────┘
```

### Active Entities

- **`profiles`**: Linked directly to `auth.users(id)` via UUID primary key. Stores `full_name`, `role` (`Admin`, `Support`, `Viewer`), `department`, and `avatar_url`.
- **`playbooks`**: High-level problem domains (e.g. `whatsapp`, `meta-business`). Uses string slug primary keys and a 2–5 letter uppercase `code` (`WA`, `META`).
- **`issues`**: Customer problems and failure modes. Primary key formatted as `{PLAYBOOK_CODE}-{NUMBER}` (e.g. `WA-001`). Contains title, summary, symptoms array, diagnostic context, and optional manual `jira_code`.
- **`guides`**: Solutions linked 1:1 to an Issue (`issue_id UNIQUE`). Primary key formatted as `{PLAYBOOK_CODE}-G{NUMBER}` (e.g. `WA-G01`). Points to `current_version_id`.
- **`guide_versions`**: Immutable historical snapshots of published Guide content. Primary key formatted as `{GUIDE_ID}:v{NUMBER}` (e.g. `WA-G01:v1`). Stores complete historical state (steps, common problems, videos, PDFs) and optional `restored_from_version_id`.
- **`sops`**: Standard Operating Procedures operating independently of Issues. Primary key formatted as `{PLAYBOOK_CODE}-SOP{NUMBER}` (e.g. `WA-SOP01`). Stores checklists, prerequisites, responsible teams, execution steps, and escalation rules.
- **`media_files`**: Registry of uploaded media assets in the `support-assets` storage bucket. Tracks durable `storage_key`, MIME type, file size, and links to Guides, Guide Versions, Issues, or SOPs.
- **`audit_logs`**: System audit log tracking mutations (`CREATE`, `UPDATE`, `RESTORE`, `SOFT_DELETE`) with actor identity and JSON diffs.

---

## 6. Soft Delete

Iceberg Playbook implements a comprehensive **soft-delete model** across primary entities:

- **Entities Supported**: `playbooks`, `issues`, `guides`, `sops`.
- **Columns**: Each soft-deletable table includes `deleted_at TIMESTAMPTZ DEFAULT NULL` and `deleted_by TEXT DEFAULT NULL`.
- **Integrity Checks & Stored Procedures**:
  - `fn_soft_delete_playbook(p_id)`: Verifies that a Playbook contains no active Issues, Guides, or SOPs before allowing soft-deletion. Non-empty Playbooks cannot be deleted.
  - `fn_soft_delete_issue(p_id)`: Checks for active linked Guides. An Issue cannot be soft-deleted while an active Guide is associated with it.
  - `fn_soft_delete_guide(p_id)`: Soft-deletes the Guide while preserving all historical `guide_versions` snapshots and associated `media_files`.
  - `fn_soft_delete_sop(p_id)`: Marks an SOP as soft-deleted.
- **Security Context**: Elevated to `SECURITY DEFINER` in migration `07_soft_delete_security.sql` so that authorized users (e.g. `Support`) can execute the soft-delete update without triggering RLS row-selection errors.
- **Query Filtering**: Standard queries and search endpoints filter with `WHERE deleted_at IS NULL`. Only users with the `Admin` role can view soft-deleted rows.

---

## 7. Monotonic Code Generation

Human-readable identifiers (`WA-001`, `WA-G01`, `WA-SOP01`) are generated server-side within PostgreSQL to ensure strict uniqueness and continuity:

- **Functions**: `fn_generate_issue_code`, `fn_generate_guide_code`, `fn_generate_sop_code`.
- **Concurrency Control**: Each function executes `SELECT code FROM public.playbooks WHERE id = p_playbook_id FOR UPDATE`, acquiring a row lock on the parent playbook to prevent race conditions during concurrent additions.
- **Permanent Monotonicity Across Soft-Deletions**: Migration `08_monotonic_code_generation.sql` sets `SECURITY DEFINER` and computes the next identifier using:
  ```sql
  SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::INTEGER), 0) + 1
  FROM public.issues
  WHERE id ~ ('^' || v_code || '-[0-9]+$');
  ```
  By scanning **both active and soft-deleted records**, the database guarantees that numbers are never reused, even if an earlier issue or SOP was deleted.

---

## 8. Jira Code

- **Migration**: Added in `09_issue_jira_code.sql`.
- **Field**: `jira_code TEXT DEFAULT NULL` on `public.issues`.
- **Indexing**: Partial index `idx_issues_jira_code` on `public.issues (jira_code)` where `jira_code IS NOT NULL AND deleted_at IS NULL`.
- **Scope & Boundaries**:
  - **No Jira API Integration**: There is no webhook, OAuth, synchronization service, or API communication with Atlassian Jira.
  - **Manual Reference Only**: The field is an optional reference string (e.g., `SUP-1042`, `ICE-512`) manually entered by team members to facilitate cross-referencing between Playbook Issues and internal tickets.
  - Linked Guides dynamically derive the Jira reference from their parent Issue.

---

## 9. Row Level Security and Roles

PostgreSQL Row Level Security (RLS) is enabled on all tables in `04_security_and_rls.sql`:

### Helper Functions

- `fn_user_role()`: Returns `public.app_role` for the current caller (`SELECT auth.uid()`).
- `fn_is_admin()`: Returns `true` if caller role is `Admin`.
- `fn_is_support_or_admin()`: Returns `true` if caller role is `Support` or `Admin`.

### Role Matrix

| Action | Admin | Support | Viewer |
| :--- | :---: | :---: | :---: |
| **Select Active Records** (`deleted_at IS NULL`) | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **Select Soft-Deleted Records** | ✅ Allowed | ❌ Denied | ❌ Denied |
| **Insert / Update Playbooks, Issues, Guides, SOPs** | ✅ Allowed | ✅ Allowed | ❌ Denied |
| **Upload Media to `support-assets`** | ✅ Allowed | ✅ Allowed | ❌ Denied |
| **Soft Delete Entities** | ✅ Allowed | ✅ Allowed | ❌ Denied |
| **Insert New User Profiles (`public.profiles`)** | ✅ Allowed | ❌ Denied | ❌ Denied |
| **Update User Profile Roles** | ✅ Allowed | ❌ Denied | ❌ Denied |
| **Update Own Profile (`full_name`, `avatar_url`)** | ✅ Allowed | ✅ Allowed | ✅ Allowed |

---

## 10. Authentication Dependency

The application enforces a 1:1 dependency between Supabase Auth and the application's profile system:

```text
auth.users (Managed by Supabase GoTrue Auth)
    │
    │ (id: UUID)
    ▼
public.profiles (Application Profile)
```

- When a user logs in, the client library validates credentials against `auth.users`.
- The adapter then queries `public.profiles` for `id = auth.uid()`.
- **Profile Requirement**: If no corresponding profile exists in `public.profiles`, the application immediately signs out and denies access with:
  `"Account profile not found. Please contact an administrator to provision your profile."`
- For further details on client session restoration and adapter interfaces, refer to [src/auth/README.md](file:///c:/Users/tarik/Desktop/icebergnew-git/src/auth/README.md).

---

## 11. Storage / Media Configuration

Media assets (tutorial videos, guide screenshots, PDF documentation) are handled via Supabase Storage:

- **Bucket**: `support-assets`
- **Visibility**: **Private** (`public = false`). Direct public URLs are inaccessible.
- **Size Limit**: 52,428,800 bytes (**50 MB**).
- **Supported MIME Types**:
  - `video/mp4`
  - `video/webm`
  - `application/pdf`
  - `image/png`
  - `image/jpeg`
  - `image/webp`
- **URL Delivery**: The client application stores clean storage paths (e.g. `playbooks/whatsapp/guides/WA-G01/v1/tutorial.mp4`) and requests time-limited signed URLs (`createSignedUrl`, default TTL 3,600 seconds) for rendering.
- **Metadata Persistence**: Every upload writes a record to `public.media_files`, capturing `storage_key`, `filename`, `content_type`, `file_size_bytes`, and foreign keys to associated knowledge entities.

---

## 12. Initial Admin / User Provisioning

Because the application disallows public registration, users must be provisioned administratively:

### Conceptual Flow

1. **Create Supabase Auth User**: Provision an account in `auth.users` with an email and password using the Supabase Dashboard, Supabase CLI, or the Supabase Admin API (`supabase.auth.admin.createUser`).
2. **Retrieve Auth User ID**: Note the generated UUID (`id`) of the created user.
3. **Provision Profile in `public.profiles`**: Insert a record matching the user's UUID and assign the appropriate role.

### Provisioning SQL Pattern

Using the Supabase SQL Editor or an administrative connection, create the profile entry using fake placeholders:

```sql
-- Step: Associate profile with existing auth user UUID
INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    department
) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid, -- Replace with UUID from auth.users
    'admin@example.com',                           -- User's work email
    'Admin User',                                  -- Full display name
    'Admin',                                       -- Role: 'Admin' | 'Support' | 'Viewer'
    'Support Leadership'
)
ON CONFLICT (id) DO UPDATE
SET role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    updated_at = NOW();
```

> [!CAUTION]
> Avoid raw SQL inserts directly into `auth.users` for password generation, as Supabase manages password hashing, salts, and authentication state internally. Use the Supabase Dashboard or Admin API to create auth credentials.

---

## 13. Verification Tests

A dedicated SQL verification test suite is maintained in:

`supabase/tests/verification_tests.sql`

### Characteristics

- **Transaction Isolated**: The entire test suite is enclosed within a `BEGIN; ... ROLLBACK;` block.
- **Zero Artifact Residue**: Because it rolls back at completion, it leaves **zero** test data or mock records in the database.
- **Assertions Tested**:
  1. Playbook code format constraint validation (`chk_playbook_code_format`).
  2. Atomic Issue code generator format (`fn_generate_issue_code`).
  3. Atomic Guide and v1 version snapshot creation (`fn_create_guide`).
  4. Composite foreign key enforcement (`current_version_id` must match `(id, guide_id)`).
  5. 1:1 primary Guide per Issue constraint (`uq_guides_issue_id`).
  6. Immutability of historical Guide versions.
  7. Version restoration integrity (creates new version, leaves history intact).
  8. Referential integrity on soft delete (blocks deleting non-empty playbooks or issues with active guides).
  9. Historical media retention and version snapshot preservation.

### Running Verification Tests

Run the verification test suite in the Supabase Dashboard SQL Editor or via `psql`:

```bash
psql "$DATABASE_URL" -f supabase/tests/verification_tests.sql
```

A successful execution will emit `NOTICE` statements for all 9 tests and report:
`NOTICE: === ALL 9 ISOLATED VERIFICATION TESTS PASSED (9/9) ===` followed by `ROLLBACK`.

User Management tests (after migrations 01–12): `supabase/tests/user_management_tests.sql` — 22 tests in `BEGIN … ROLLBACK`, ends with `NOTICE: === ALL 22 USER MANAGEMENT TESTS PASSED (22/22) ===`.

Auth user lookup tests (after migration 13): `supabase/tests/auth_user_lookup_tests.sql` — 4 tests in `BEGIN … ROLLBACK`, ends with `NOTICE: === ALL 4 AUTH USER LOOKUP TESTS PASSED (4/4) ===`.

---

## 14. Environment and Client Configuration

The frontend client accesses Supabase using client environment variables defined in `.env.local` (see [`.env.example`](file:///c:/Users/tarik/Desktop/icebergnew-git/.env.example)):

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

*(Or `VITE_SUPABASE_PUBLISHABLE_KEY` as an alternative to `VITE_SUPABASE_ANON_KEY`).*

> [!CAUTION]
> **Key Security**: The client application must **only** receive public client keys. Database passwords, administrative tokens, and the Supabase `service_role` key must **NEVER** be placed in `VITE_` variables or exposed to the browser.

---

## 15. Handover / Infrastructure Portability Notes

If Iceberg transitions from Supabase to in-house infrastructure, the following architectural components must be adapted:

| Supabase Component | Responsibility | Handover / Adaptation Consideration |
| :--- | :--- | :--- |
| **Supabase Auth** | User authentication & JWT issuance | Replace with Iceberg SSO, OAuth, or LDAP. Update `AuthAdapter` in `src/auth/auth.ts`. |
| **Row Level Security (RLS)** | Database access control | If retaining PostgreSQL, RLS policies can be adapted to Iceberg JWT claims. If migrating to an application backend (e.g. Node/Go/Python API), authorization logic must be implemented in API middleware. |
| **Stored Procedures / RPCs** | Code generation & atomic updates | Functions such as `fn_generate_issue_code`, `fn_create_guide`, and `fn_soft_delete_*` must be migrated to backend service transaction logic or kept in PostgreSQL. |
| **Supabase Storage** | Private asset storage & signed URLs | Replace with AWS S3, MinIO, or internal blob storage. Update `mediaService.ts` signed URL and upload routines. |
| **Data Access Layer** | Frontend direct queries | If an intermediate REST or GraphQL API is introduced, services in `src/services/` (`guideService`, `issueService`, etc.) must be updated to target the new API endpoints. |

> [!WARNING]
> Migrating away from Supabase is **not** plug-and-play. Direct Supabase client calls, signed storage URLs, and database-level RLS policies are integral to the current architecture and will require deliberate engineering adaptation.
