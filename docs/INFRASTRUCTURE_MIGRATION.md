# Infrastructure Migration Guide: Supabase to Iceberg Infrastructure

This guide is an architectural blueprint for Iceberg engineers (and AI coding agents working on their behalf) who will replace the current Supabase backend with Iceberg's in-house infrastructure.

---

## 1. Purpose

The current Supabase backend in this repository serves as a **fully functional, verified reference implementation**. It provides a working database schema, security model, authentication flow, file storage, and data-access layer that demonstrate all operational requirements of the application.

> [!IMPORTANT]
> **Key Objective**:
> Iceberg is expected to replace Supabase with its own infrastructure (authentication, APIs, database, and file storage).
> When executing this migration, the existing React/TypeScript frontend, routing, presentation layer, and domain boundaries should be preserved where practical.

Supabase is **not** intended to be Iceberg's final production infrastructure. This document provides a safe, phased roadmap for replacing it without destabilizing the working frontend.

---

## 2. Current Architecture

The application is structured into strict architectural layers:

```text
┌─────────────────────────────────────────────────────────────┐
│                 React / TypeScript UI Layer                 │
│      (src/pages/*, src/components/*, src/router.ts)         │
└──────────────────────────────┬──────────────────────────────┘
                               │ Consumes domain types & functions
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            Domain Services & AuthAdapter Layer              │
│       (src/services/*, src/auth/*, src/search/*)            │
└──────────────────────────────┬──────────────────────────────┘
                               │ PostgREST, Auth SDK, Storage SDK
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Supabase Backend                       │
│    (PostgreSQL, RLS Policies, PL/pgSQL RPCs, Storage)       │
└─────────────────────────────────────────────────────────────┘
```

### Critical Architectural Finding
As confirmed by the Supabase Portability Audit, **no React page or component directly performs Supabase database, auth, or storage calls**:
- Page components call domain functions (e.g. `listPlaybooks()`, `getIssueById()`, `createGuide()`).
- Form controls call generic handlers (e.g. `uploadMedia()`, `validateMediaFile()`).
- Auth components consume the standard React hook `useAuth()`.
- The UI layer has **zero direct imports** of `@supabase/supabase-js` or `src/lib/supabase.ts`.

---

## 3. Target Architecture

The target architecture replaces Supabase with Iceberg's internal services while keeping the UI layer untouched:

```text
┌─────────────────────────────────────────────────────────────┐
│                 React / TypeScript UI Layer                 │
│                 (PRESERVED WITHOUT CHANGES)                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Consumes existing domain contracts
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Existing Domain Service Interfaces                 │
│      (Functions return clean domain types: Playbook,        │
│          Issue, Guide, GuideVersion, SOP, etc.)             │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / Fetch / Internal Client
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Iceberg API / Backend Tier                  │
│       (REST, GraphQL, gRPC, Node.js, Go, .NET, Python)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ Internal protocols
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            Iceberg Core Infrastructure Components           │
│   ┌───────────────────┐  ┌────────────────┐  ┌───────────┐  │
│   │ Iceberg SSO / Auth│  │ Iceberg DB     │  │ S3 / Blob │  │
│   └───────────────────┘  └────────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
```

This guide makes no assumptions about whether Iceberg uses REST, GraphQL, gRPC, PostgreSQL, SQL Server, MySQL, AWS S3, or Azure Blob Storage. The migration strategy accommodates any standard backend architecture.

---

## 4. Replacement Map

The following table maps every Supabase-dependent file in the repository to its planned replacement:

| File Path | Current Dependency | Replacement Strategy |
| :--- | :--- | :--- |
| **`src/auth/supabaseAuth.ts`** | Supabase GoTrue Auth + `public.profiles` query | Replace with `icebergAuthAdapter.ts` implementing the [`AuthAdapter`](../src/auth/auth.ts) interface via Iceberg SSO, OAuth, or LDAP. |
| **`src/services/playbookService.ts`** | Supabase PostgREST queries + `fn_soft_delete_playbook` RPC | Replace internal query calls with Iceberg Playbook API endpoints (e.g. `GET /api/playbooks`, `POST /api/playbooks`). |
| **`src/services/issueService.ts`** | Supabase PostgREST queries + `fn_generate_issue_code` & `fn_soft_delete_issue` RPCs | Replace with Iceberg Issue API endpoints (e.g. `GET /api/issues`, `POST /api/issues`). Code generation moves to backend. |
| **`src/services/guideService.ts`** | Supabase PostgREST queries + Guide creation, publish, restore, & soft-delete RPCs | Replace with Iceberg Guide API endpoints (e.g. `GET /api/guides`, `POST /api/guides`, `POST /api/guides/:id/versions`). |
| **`src/services/sopService.ts`** | Supabase PostgREST queries + `fn_generate_sop_code` & `fn_soft_delete_sop` RPCs | Replace with Iceberg SOP API endpoints (e.g. `GET /api/sops`, `POST /api/sops`). |
| **`src/services/homeService.ts`** | Multi-table Supabase aggregation for active recent content | Replace with an Iceberg aggregation endpoint (e.g. `GET /api/home/recent`). |
| **`src/search/dataSource.ts`** | Multi-table Supabase queries loading active records for client search | Replace with backend search endpoint or an API batch-fetch endpoint. |
| **`src/search/searchService.ts`** | Calls `getSearchData` using Supabase client | Adapt to call Iceberg search backend or API data source. |
| **`src/services/mediaService.ts`** | Supabase Storage SDK (`support-assets`) + `public.media_files` insert | Replace with Iceberg file upload API (e.g. presigned S3 URLs, direct backend upload endpoint). |
| **`src/lib/supabase.ts`** | Supabase client instantiation & env checks | Deprecate and remove once all services are migrated. Replace with an Iceberg API HTTP client (e.g. `apiClient.ts`). |

---

## 5. Authentication Migration

### The `AuthAdapter` Boundary
The application uses an adapter pattern in [`src/auth/auth.ts`](../src/auth/auth.ts) that decouples the UI from any specific auth vendor:

```typescript
export interface AuthAdapter {
  signIn(input: SignInInput): Promise<AuthSession>;
  signOut(): Promise<void>;
  getSession?(): Promise<AuthSession | null>;
}
```

The React tree connects via [`AuthProvider`](../src/auth/AuthProvider.tsx):
```tsx
<AuthProvider adapter={customAuthAdapter}>
  <App />
</AuthProvider>
```

### Steps to Replace Authentication
1. **Create Adapter**: Implement `src/auth/icebergAuthAdapter.ts` conforming to `AuthAdapter`.
2. **Handle Session Lifecycle**:
   - `signIn`: Authenticate credentials against Iceberg identity provider (SSO, OAuth2, OpenID Connect).
   - `getSession`: Check session cookie or restore token on application load.
   - `signOut`: Terminate session and invalidate tokens.
3. **Map Profile & Roles**: Return an `AuthSession` containing:
   - `user`: `{ id: string, email: string }`
   - `profile`: `{ user_id: string, full_name: string, role: 'Admin' | 'Support' | 'Viewer', department: string, avatar_url: string | null }`
4. **Backend Authorization**: Replacing the frontend adapter alone is **not sufficient**. The current backend relies on PostgreSQL Row Level Security (RLS) policies driven by `auth.uid()`. When migrating to an Iceberg backend, the API layer must validate identity tokens and enforce `Admin`, `Support`, and `Viewer` permissions on all endpoints.

---

## 6. Database / Service Migration

### Preserving Service Contracts
The UI components depend on the domain signatures exported by the service modules, **not** the underlying database transport.

To migrate a service:
1. Retain exported function names, parameter shapes, and return types in each service file:
   - Example: `createPlaybook(input: CreatePlaybookInput): Promise<Playbook>`
   - Example: `getGuideById(id: string): Promise<Guide | null>`
2. Replace the internal implementation (e.g. `client.from('playbooks').select(...)`) with standard HTTP calls (e.g. `fetch('/api/playbooks')` or Axios).
3. Ensure server responses are transformed into clean domain models ([`Playbook`](../src/data.ts), [`Issue`](../src/data.ts), [`Guide`](../src/data.ts), [`SOP`](../src/data.ts)).
4. Handle errors by throwing standard JavaScript `Error` objects so existing UI error banners display error messages as expected.

---

## 7. Business Logic That Must Be Preserved

The current implementation enforces critical business rules inside 9 PostgreSQL stored procedures (RPCs). When replacing Supabase, **these exact behaviors must be re-implemented in Iceberg's backend services**:

### 1. Monotonic Code Generation (`fn_generate_issue_code`, `fn_generate_sop_code`)
- **Behavior**: Generates human-readable IDs formatted as `{PLAYBOOK_CODE}-{NUMBER}` (e.g. `WA-001`, `WA-SOP01`).
- **Critical Requirement**: Must use database row locks or serial transactions to prevent race conditions during concurrent creation.
- **Non-Reuse Guarantee**: The generator **must scan both active and soft-deleted rows** (`deleted_at IS NOT NULL`). Deleted codes must never be recycled.

### 2. Transactional Guide Creation (`fn_create_guide`)
- **Behavior**: In a single atomic transaction:
  1. Generates the guide code (e.g. `WA-G01`).
  2. Inserts the active row into `guides`.
  3. Creates the initial immutable `guide_versions` v1 snapshot (`WA-G01:v1`).
  4. Sets `current_version_id` to the new version ID.
  5. Records an entry in `audit_logs`.
- **Constraint**: If any step fails, the entire transaction rolls back.

### 3. Immutable Guide Version Publishing (`fn_publish_guide_version`)
- **Behavior**: When updating a published Guide:
  1. Calculates the next version number (v2, v3, etc.).
  2. Inserts a new, immutable snapshot row into `guide_versions`.
  3. Updates the active pointer (`current_version_id` and `version_number`) on the `guides` table.
  4. Logs the change in `audit_logs`.
- **Constraint**: Previous version snapshot rows in `guide_versions` must **never** be updated or overwritten.

### 4. Non-Destructive Version Restoration (`fn_restore_guide_version`)
- **Behavior**: When restoring an older version (e.g. restoring v1.2 while currently on v1.5):
  1. The target historical snapshot is fetched.
  2. A **brand new version** (e.g. v1.6) is generated containing the restored content.
  3. `restored_from_version_id` is recorded on the new snapshot pointing to the source version.
  4. Intermediate versions (v1.3, v1.4, v1.5) remain in history completely intact.

### 5. Safe Soft Deletion (`fn_soft_delete_*`)
- **`fn_soft_delete_playbook`**: Must verify that the Playbook contains **zero active Issues, Guides, or SOPs**. Non-empty Playbooks must be rejected with an error.
- **`fn_soft_delete_issue`**: Must verify that the Issue has **no active linked Guide**. Issues with active guides cannot be soft-deleted.
- **`fn_soft_delete_guide`**: Sets `deleted_at = NOW()` on the Guide while preserving all historical snapshots and media records.
- **`fn_soft_delete_sop`**: Marks the SOP as soft-deleted.

---

## 8. Authorization / Row Level Security (RLS) Replacement

In the current architecture, data isolation and permission boundaries are enforced by PostgreSQL Row Level Security. When moving to Iceberg infrastructure, this security layer must be replicated in the backend API middleware:

| Role | Permitted Actions | Prohibited Actions |
| :--- | :--- | :--- |
| **`Admin`** | Full CRUD on all entities; view soft-deleted records; restore deleted items; manage user profiles and assign roles. | N/A |
| **`Support`** | Create and update Playbooks, Issues, Guides, and SOPs; upload media; soft-delete items; view active records. | View soft-deleted records; assign user roles; hard-delete data. |
| **`Viewer`** | Read-only access to active records across Playbooks, Issues, Guides, and SOPs. | Any create, update, delete, or media upload operation. |

### API Middleware Requirement
Iceberg backend endpoints must inspect caller session tokens, verify roles, and block unauthorized operations before reaching the database layer.

---

## 9. Storage Migration

### Current Media Architecture
- **Bucket**: `support-assets` (Private).
- **Size Limit**: 50 MB (52,428,800 bytes).
- **MIME Types**: `video/mp4`, `video/webm`, `application/pdf`, `image/png`, `image/jpeg`, `image/webp`.
- **Storage Keys**: Portable domain paths (e.g. `playbooks/{playbookId}/guides/{guideId}/v{version}/{filename}`).
- **Signed URLs**: Temporary signed URLs generated on demand (3,600s TTL). Guide documents persist the clean storage key, not transient signed URLs.

### Replacement Strategy
1. **Target Options**: AWS S3, Azure Blob Storage, MinIO, or an internal media service.
2. **Presigned Upload Flow**:
   - Client requests presigned upload URL from Iceberg API.
   - Client uploads binary directly to object store.
   - Storage path is returned and registered in database.
3. **Download / Preview Flow**:
   - Iceberg API generates signed view URLs with time-to-live expiration.
4. **Boundary Isolation**: All changes are confined to [`src/services/mediaService.ts`](../src/services/mediaService.ts). UI components like `MediaUploadField.tsx` require zero changes.

---

## 10. Search Migration

### Current Search Flow
1. [`src/search/dataSource.ts`](../src/search/dataSource.ts): Fetches active records from `playbooks`, `issues`, `guides`, and `sops` via Supabase client.
2. [`src/search/searchCore.ts`](../src/search/searchCore.ts): Performs in-memory tokenization, field weighting, and filtering across entities.
3. [`src/search/searchService.ts`](../src/search/searchService.ts): Connects data source to search core.
4. [`src/pages/Search.tsx`](../src/pages/Search.tsx): Presentation UI consuming `executeSearch()`.

### Migration Options
- **Option A (Lightweight)**: Replace `getSearchData` in `dataSource.ts` with a single API call (e.g. `GET /api/search/data`) and retain the existing client search core.
- **Option B (Server-Side Search)**: Implement full-text search on Iceberg's backend (Elasticsearch, PostgreSQL Full-Text, OpenSearch), and adapt `executeSearch` in `searchService.ts` to call `GET /api/search?q=...`. The Search UI component remains unchanged.

---

## 11. Data Model Considerations

If Iceberg's target database is not PostgreSQL, the following structures will require schema translation:

- **Composite Foreign Keys**: PostgreSQL constraint `fk_guides_current_version_composite` ensures `(current_version_id, id)` references `guide_versions(id, guide_id)`. If using an engine without composite FKs, enforce this via database triggers or application transaction logic.
- **JSONB Columns**: Extensive use of JSONB for `steps`, `common_problems`, `attachments`, and `revision_history`. Non-PostgreSQL engines must support document/JSON column types or use normalized relational child tables.
- **Text Arrays (`TEXT[]`)**: Used for `symptoms`, `checklist`, `before_you_start`. In engines without native arrays (e.g. MySQL, SQL Server), convert to JSON arrays or join tables.
- **Regex Check Constraints**: Format constraints (e.g. `chk_playbook_code_format`) must be supported or enforced in application validation.
- **UUIDs**: Relies on standard UUID format for profiles and media files.

---

## 12. Recommended Migration Order

To minimize risk and maintain a working build throughout the handover transition, execute the migration in sequential phases:

```text
Phase 1: Preserve Frontend & Establish Baseline
    │
    ▼
Phase 2: Implement Iceberg AuthAdapter & Test Sign-In
    │
    ▼
Phase 3: Develop Iceberg Backend APIs (CRUD + RPC Behaviors)
    │
    ▼
Phase 4: Migrate Playbook, Issue, and SOP Services
    │
    ▼
Phase 5: Migrate Guide & Guide Versioning Logic
    │
    ▼
Phase 6: Migrate Media Storage & Signed URL Services
    │
    ▼
Phase 7: Migrate Search Data Source / Backend Endpoint
    │
    ▼
Phase 8: Remove Supabase Client, Config & Dependencies
    │
    ▼
Phase 9: Comprehensive End-to-End Regression Validation
```

### Detailed Phase Breakdown

1. **Phase 1: Baseline Preservation**:
   - Clone repository, run `npm test` and `npm run build` to establish baseline verification.
   - Do not delete any existing Supabase code yet.
2. **Phase 2: Auth Adapter**:
   - Create `src/auth/icebergAuthAdapter.ts`.
   - Wire into `src/auth/AuthProvider.tsx`.
   - Validate login, session persistence, and sign-out against Iceberg SSO.
3. **Phase 3: Backend API Development**:
   - Build backend API endpoints matching existing domain service contracts.
   - Implement the 9 critical business rules (monotonic codes, Guide transactions, soft-deletion validations).
4. **Phase 4: Domain Service Cutover (Phase 1)**:
   - Convert `playbookService.ts`, `issueService.ts`, and `sopService.ts` to call Iceberg API endpoints.
   - Validate Issue and SOP creation, updates, and soft deletes.
5. **Phase 5: Guide Service Cutover**:
   - Convert `guideService.ts` to call Iceberg Guide API endpoints.
   - Verify Guide versioning snapshots and historical version restore workflows.
6. **Phase 6: Storage Service Cutover**:
   - Update `mediaService.ts` to upload to Iceberg storage and request signed URLs.
   - Validate tutorial video and PDF uploads.
7. **Phase 7: Search Service Cutover**:
   - Update `dataSource.ts` or `searchService.ts` to use Iceberg search endpoints.
8. **Phase 8: Clean Decommissioning**:
   - Remove `src/lib/supabase.ts`.
   - Remove `@supabase/supabase-js` from `package.json`.
   - Remove Supabase variables from `.env.local` and `.env.example`.
9. **Phase 9: Regression Testing**:
   - Run unit and integration tests.
   - Validate full application workflows end-to-end.

---

## 13. What Should NOT Be Changed Initially

To prevent regressions and maintain product stability, avoid altering:

- **React Views & Layout**: Do not modify `src/pages/*`, `src/components/layout/*`, or `src/router.ts`.
- **Domain Interfaces**: Keep types in `src/data.ts` (`Playbook`, `Issue`, `Guide`, `GuideVersion`, `SOP`) intact.
- **Service Signatures**: Retain existing function names and parameter structures in `src/services/*`.
- **Unsaved Changes Protection**: Preserve form dirty-state detection and navigation guards.
- **Version Snapshot Semantics**: Do not replace Guide version snapshots with simple mutable rows; historical traceability is a core product requirement.
- **Soft Delete Semantics**: Do not convert soft deletes into destructive hard deletes.

---

## 14. Completion Checklist

Before declaring the Supabase migration complete, verify each item:

- [ ] `@supabase/supabase-js` has been removed from `package.json` dependencies.
- [ ] No files import `src/lib/supabase.ts` or `@supabase/supabase-js`.
- [ ] `src/lib/supabase.ts` has been removed or replaced with an internal API client.
- [ ] Authentication is powered by Iceberg SSO/Auth via `AuthAdapter`.
- [ ] All 6 domain services (`playbookService`, `issueService`, `guideService`, `sopService`, `homeService`, `mediaService`) connect to Iceberg APIs.
- [ ] All 9 RPC behaviors are preserved in backend logic:
  - [ ] Monotonic issue codes (no reuse across deleted records).
  - [ ] Monotonic SOP codes.
  - [ ] Transactional Guide + v1 snapshot creation.
  - [ ] Immutable Guide version increments.
  - [ ] Non-destructive version restoration to a new version.
  - [ ] Playbook soft delete blocked if non-empty.
  - [ ] Issue soft delete blocked if linked to an active Guide.
  - [ ] Guide soft delete preserves historical versions and media.
  - [ ] SOP soft delete functioning.
- [ ] Backend authorization middleware enforces `Admin`, `Support`, and `Viewer` permissions.
- [ ] File uploads and signed URL previews work via Iceberg storage provider.
- [ ] Multi-domain search functions accurately across all entities.
- [ ] Client environment variables in `.env.local` reflect Iceberg infrastructure.
- [ ] All automated tests pass (`npm test`).
- [ ] TypeScript compiles cleanly with zero errors (`npm run build`).
- [ ] Oxlint passes with zero errors (`npm run lint`).
- [ ] Manual QA verifies create, edit, restore, upload, and search workflows.

---

## 15. Important Warning

> [!CAUTION]
> **Do Not Remove Supabase Code Preemptively**:
> - Never delete Supabase integration code before equivalent Iceberg backend functionality is deployed and verified.
> - Migrate one domain at a time (e.g. Authentication first, then Playbooks, then Issues, etc.) while keeping automated tests green.
> - The reference Supabase implementation and database migrations in `supabase/migrations/` should be kept as a functional and behavioral reference during migration development.
