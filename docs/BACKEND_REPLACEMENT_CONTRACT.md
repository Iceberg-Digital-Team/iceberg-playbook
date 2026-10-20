# Backend Replacement Contract

This document specifies the **functional and architectural contracts** required by the Playbook application. It serves as the definitive specification for any engineering team replacing the Supabase reference implementation with Iceberg's permanent backend infrastructure.

> [!IMPORTANT]
> **Contract Philosophy**:
> This document distinguishes between:
> 1. **Required Product Behavior**: Invariants, data structures, and workflows that must be preserved regardless of the underlying infrastructure.
> 2. **Supabase Reference Implementation**: The existing implementation provided in this repository to demonstrate and validate the contract.

---

## 1. Authentication & Session Contract

### Required Product Behavior
- **Authentication**: Live authentication mechanism with persistent user sessions and secure sign-out.
- **Identity & Profile**: Every authenticated identity must resolve to an internal User Profile record containing:
  - `id`: Unique user identifier.
  - `email`: Normalized lowercase user email address.
  - `fullName`: Display name for the user.
  - `role`: One of exactly three roles: `Admin`, `Support`, or `Viewer`.
  - `status`: Account state, either `Active` or `Disabled`.
- **Authorization Enforcement**:
  - `Viewer`: Read-only access across all active knowledge.
  - `Support`: Read access + write access to create and edit Playbooks, Issues, Guides, and SOPs.
  - `Admin`: Full access, including soft-deletion and access to the User Management console.
- **Disabled Account Lockout**: If an account's status is set to `Disabled`, active sessions must be invalidated or rejected at the API gateway / middleware immediately.

### Supabase Reference Implementation
- Backed by Supabase GoTrue Auth (`auth.users`), linked 1:1 to `public.profiles`.
- Session lifecycle handled via `src/auth/supabaseAuth.ts` implementing the [`AuthAdapter`](file:///c:/Users/tarik/Desktop/icebergnew-git/src/auth/auth.ts) interface.
- Role and account state cached in profile and enforced at the database level via Postgres RLS functions (`fn_user_role()`, `fn_is_admin()`, `fn_is_support_or_admin()`).

---

## 2. Admin & User Management Contract

### Required Product Behavior
- **Strict Invite-Only Model**: Public self-registration is strictly forbidden. All accounts are created via Admin invitation.
- **Invitation Token Security**:
  - Plaintext tokens are delivered only once to the issuing Administrator as a copyable activation URL.
  - The backend stores only the cryptographic SHA-256 hash of the token.
  - Plaintext tokens are never stored, logged, or queryable.
- **Invitation Lifespan**:
  - Invitations must support configurable expiration (e.g. 24h, 3d, 7d).
  - Unclaimed invitations past their expiration timestamp must transition to `Invite Expired` status.
- **Activation Lease & Rate Limiting**:
  - To prevent token hijacking or concurrent redemption race conditions, activation requests must acquire a short-lived atomic lease (e.g. 60 seconds).
  - Failed activation attempts must enforce rate limits.
- **Account Actions**:
  - `resend_invitation`: Generates a new invitation token and URL while invalidating the previous one.
  - `revoke_invitation`: Permanently revokes a pending invitation.
  - `change_role`: Promotes or demotes an active user between `Admin`, `Support`, and `Viewer`.
  - `disable_user` / `enable_user`: Toggles account access without deleting historical attribution or audit logs.
  - `create_password_link`: Generates a single-use password reset link for an active user.
- **Critical Administrative Safeguards**:
  - **Self-Action Guard**: An Admin cannot disable their own account or demote their own role.
  - **Last-Admin Guard**: The system must prevent disabling or demoting the last active Administrator in the workspace.

### Supabase Reference Implementation
- Implemented via migrations `11_user_management.sql`, `12_user_invitation_security.sql`, and `13_auth_user_lookup.sql`.
- Domain rules encapsulated in `src/services/adminUserRules.ts` and `src/services/adminUserService.ts`.
- Reference implementation uses Edge Functions: `admin-users` (authenticated admin operations) and `auth-links` (unauthenticated link inspection and redemption).

---

## 3. Playbooks Contract

### Required Product Behavior
- **Grouping**: Top-level knowledge container for a product, platform, or operational domain.
- **Code Prefix**: Unique uppercase alphanumeric prefix of 2 to 5 characters (e.g. `WA`, `CRM`, `ENG`).
- **Slug**: Unique URL-friendly slug (Turkish/non-ASCII characters transliterated to standard Latin).
- **Soft Deletion & Conflict Restoration**:
  - Playbook deletion must be a non-destructive soft-delete (`deleted_at` timestamp recorded).
  - Creating a Playbook whose name, slug, or code matches an active Playbook must return an active conflict error.
  - Creating a Playbook whose name, slug, or code matches a **soft-deleted** Playbook must return a deleted conflict response and allow the user to restore the deleted Playbook with its historical items intact.

### Supabase Reference Implementation
- Managed in `public.playbooks` with format constraint `chk_playbooks_code_format`.
- Conflict checking and restoration implemented in `src/services/playbookService.ts` via RPC `fn_restore_playbook`.

---

## 4. Issues Contract

### Required Product Behavior
- **Scope**: Problem diagnostic description belonging strictly to a Playbook. An Issue documents a problem, not the resolution.
- **Monotonic Code Generation**: Sequential, human-readable codes (e.g. `WA-001`, `WA-002`) generated atomically. Codes must never be reused, even if previous issues were soft-deleted.
- **Manual Jira Code**:
  - Optional text field (`jira_code`, e.g. `SUP-1042`).
  - Active issues with Jira codes must be indexed for search.
  - **No external Jira API sync or automated webhook dependency exists.**
- **Structured Fields**: Title, Summary, Symptoms (string array), Error Message, Context, Affected Area, Information to Collect (string array), Attachments (array of objects), Internal Notes, Status (`Verified` / `Draft`), Difficulty (`Easy` / `Medium` / `Advanced`), Estimated Time.
- **Soft Deletion & Protection**:
  - Non-destructive soft-deletion.
  - **Critical Rule**: An Issue cannot be deleted if it has an active linked Solution Guide. The user must delete or unlink the Guide first.

### Supabase Reference Implementation
- Table `public.issues` with `fn_generate_issue_code` (locking parent playbook row with `FOR UPDATE`) and `fn_soft_delete_issue` enforcing guide linkage checks.

---

## 5. Solution Guides Contract

### Required Product Behavior
- **Issue Association (Strict 1:1)**:
  - Every Guide belongs to exactly one Issue (`issue_id`).
  - An Issue can have at most **one active Guide**.
  - A Guide inherits the parent Playbook context from its linked Issue.
  - Guides cannot exist independently without an Issue.
- **Immutable Snapshot Versioning**:
  - Every published update creates an immutable historical version snapshot.
  - Previous versions retain full historical fidelity (title, summary, steps, screenshots, videos, attachments).
- **Non-Destructive Version Restore**:
  - Users can inspect historical versions and restore an older snapshot.
  - Restoring a version copies historical content into a **new current version** increment; it never overwrites, truncates, or deletes past version history.
- **Structured Content**: Steps (numbered with title, description, and optional screenshot/video/PDF media), Common Problems (problem/cause/solution triplets), FAQs, Requirements, Important Information, Internal Notes.
- **Soft Deletion**: Non-destructive soft-delete excluding the Guide from active views and search.

### Supabase Reference Implementation
- Tables `public.guides` and `public.guide_versions`.
- Managed via `src/services/guideService.ts` and atomic RPCs:
  - `fn_create_guide`: Creates Guide and v1 snapshot atomically.
  - `fn_publish_guide_version`: Creates new version snapshot, updates guide pointer, and prevents concurrent update conflicts via optimistic locking (`p_expected_version_id`).
  - `fn_restore_guide_version`: Restores older snapshot forward into a new version.
  - `fn_soft_delete_guide`: Sets `deleted_at`.

---

## 6. Standard Operating Procedures (SOPs) Contract

### Required Product Behavior
- **Independence**: Belongs directly to a Playbook (`playbook_id`). **Does not require or depend on an Issue.**
- **Monotonic Code Generation**: Sequential codes (e.g. `WA-SOP01`) generated atomically across active and soft-deleted rows.
- **Interactive Checklists**:
  - Dedicated interactive checklist items allowing operators to track execution progress.
- **Process Steps**:
  - Numbered execution steps with title, description, estimated time, important note, success indicator, inline screenshots, video link, and PDF references.
- **Operational Guidelines**:
  - Purpose, When to Use, Responsible Team, Prerequisite Requirements, Escalation Rules, Completion Criteria, and Revision History.
- **Atomic Media Attribution**:
  - Storage keys for uploaded videos or screenshots must be atomically associated with the SOP row upon save.
- **Soft Deletion**: Non-destructive soft-delete via timestamp.

### Supabase Reference Implementation
- Table `public.sops` with `fn_generate_sop_code`, `fn_soft_delete_sop`, and `fn_link_sop_media` (migration `15_sop_media_link_fix.sql`).

---

## 7. Global Search Contract

### Required Product Behavior
- **Unified Aggregation**: Global search query matching across all active items:
  - Playbooks (name, description, code)
  - Issues (code, title, summary, symptoms, error message, Jira code)
  - Guides (title, summary, steps)
  - SOPs (id, title, purpose, when to use, checklist, steps)
- **Exclusion of Soft-Deleted Items**: Items where `deleted_at IS NOT NULL` must be strictly omitted.
- **Exclusion of Troubleshooting**: Obsolete troubleshooting entities must never appear.
- **Direct Navigation**: Search results must provide deep links directly routing to the respective entity view.

### Supabase Reference Implementation
- Implemented in `src/search/searchService.ts` consuming `src/search/dataSource.ts`, which loads active records via service queries and performs client-side rank filtering.

---

## 8. Media & Storage Contract

### Required Product Behavior
- **Private Storage**: Direct unauthenticated public access to stored media (video, PDF, images) is prohibited.
- **Signed URL Delivery**: Client rendering requires short-lived, authorized URLs (e.g. 1-hour expiration).
- **Metadata Attribution**: File metadata (storage key, bucket, file size, content type, entity association) must be recorded upon upload.
- **Historical Guide Media Protection**: Media associated with older Guide version snapshots must remain accessible when viewing version history and must never be deleted merely because a newer version was published.
- **Orphan Media Audit & Grace Period**:
  - Content references in active and historical records (`guides`, `guide_versions`, `sops`, `issues`) are **authoritative**. A metadata row alone never justifies deleting an asset.
  - A minimum **24-hour grace period** must protect newly uploaded assets during in-flight authoring sessions from being flagged as orphans.
  - Deleting an orphan asset must delete the physical storage object first before deleting database metadata.

### Supabase Reference Implementation
- Private bucket `support-assets` in Supabase Storage with signed URL resolution via `src/services/mediaService.ts`.
- Maintenance script `scripts/prune_orphan_media.mjs` and read-only audit RPC `fn_audit_orphan_media` (migration `16_orphan_media_audit.sql`).

---

## 9. Portable Bootstrap & Onboarding Contract

### Required Product Behavior
- **Vendor-Neutral Canonical Bundle**:
  - The content in `bootstrap/default-content.json` defines canonical onboarding playbooks and SOPs using logical keys (zero database IDs or vendor endpoints).
- **Stable Bootstrap Ownership (`bootstrap_key`)**:
  - Default SOP records are tracked via an explicit `bootstrap_key` column scoped to the parent playbook (`(playbook_id, bootstrap_key)`).
  - Same-title untagged SOPs must produce `CONFLICT` and must never be adopted or overwritten silently.
- **Deterministic Storage Addressing**:
  - Media assets are converted from relative paths (`assets/getting-started/...`) to deterministic, content-addressable storage keys using SHA-256 hashes.
- **Dry-Run by Default**:
  - Running the bootstrap importer without explicit arguments performs a **dry run** that computes and displays planned mutations without writing to the database or storage.
  - Mutation requires an explicit `--apply` flag.
- **Idempotence**:
  - Running the import against an already populated database must produce a clean **NOOP** (0 creates, 0 updates, 0 uploads, 0 conflicts).

### Supabase Reference Implementation
- Bundled in `bootstrap/default-content.json`, validated by `bootstrap/validate.mjs`.
- Importer orchestrator `scripts/bootstrap_content.mjs` consumes `scripts/lib/bootstrap/supabase_adapter.mjs`.
- Scoped unique index and format check in migration `17_sop_bootstrap_key.sql`.
