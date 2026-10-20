# Canonical Default Onboarding Content Bundle

This directory contains the vendor-neutral default onboarding and bootstrap package for the **Iceberg Support Playbook** platform.

---

## Purpose and Architecture

1. **Vendor-Neutral Canonical Content**:
   - The content defined in [`default-content.json`](./default-content.json) is the single source of truth for platform onboarding.
   - It is strictly **vendor-neutral** and not tied to Supabase or any specific database implementation.
   - All relationships are defined using logical keys (for example, `"playbookKey": "getting-started"`) rather than database-generated primary keys or UUIDs.
   - Content adheres strictly to JSON Schema specification [`default-content.schema.json`](./default-content.schema.json) and validator `validate.mjs`.

2. **Storage and Backend Portability**:
   - The canonical bundle defines logical content and relative asset paths only.
   - The importer script [`scripts/bootstrap_content.mjs`](file:///c:/Users/tarik/Desktop/icebergnew-git/scripts/bootstrap_content.mjs) delegates mutations through an adapter interface.
   - The current adapter (`scripts/lib/bootstrap/supabase_adapter.mjs`) connects to the Supabase reference backend.
   - In production or future deployments, Iceberg can replace that adapter with an adapter targeting Iceberg's proprietary database and object storage APIs without modifying this canonical bundle.

3. **Deterministic Content-Addressed Media**:
   - Local asset paths (e.g. `assets/getting-started/playbooks/how-to-use-playbooks-tour.mp4`) are resolved from [`assets/`](./assets/).
   - The importer computes the SHA-256 hash of each binary asset and uploads it to a deterministic, content-addressable key:
     `sops/bootstrap/<playbook-key>/<sop-key>/<sha256>-<sanitized-filename>`
   - Unchanged assets already present at their deterministic key are skipped (NOOP).

4. **Deterministic Ownership & Conflict Safety (`bootstrap_key`)**:
   - Onboarding SOP records in the database are tracked via an explicit `bootstrap_key` column scoped to the parent playbook (`(playbook_id, bootstrap_key)`).
   - If an existing SOP row has the same title as a bootstrap SOP but lacks a `bootstrap_key`, the importer flags this as a `CONFLICT` and aborts mutation. It will **never** silently overwrite or adopt untagged user-authored records.

5. **Strict Idempotence**:
   - Running the import process multiple times against an existing workspace updates or preserves existing records without creating duplicates.
   - A subsequent import against an up-to-date environment produces a clean **NOOP** across all playbooks, SOPs, and media assets.

---

## Directory Structure

```text
bootstrap/
  ├── README.md                      # Architecture and onboarding documentation
  ├── default-content.json           # Canonical vendor-neutral bundle content
  ├── default-content.schema.json    # JSON Schema validation specification
  ├── validate.mjs                   # Programmatic bundle schema validator
  └── assets/
      └── getting-started/
          ├── playbooks/             # Playbooks onboarding video tour
          ├── issues/                # Issues onboarding video tour
          ├── guides/                # Guides onboarding video tour
          ├── sops/                  # SOPs onboarding video tour
          └── users/                 # User Management onboarding video tour
```

### Canonical Onboarding Tour Videos
All five core onboarding procedures include production video tours:
1. `playbooks/how-to-use-playbooks-tour.mp4` (`14,189,461` bytes) → Linked to **GS-SOP02** (*How to Use Playbooks*)
2. `issues/how-to-use-issues-tour.mp4` (`15,748,276` bytes) → Linked to **GS-SOP03** (*How to Use Issues*)
3. `guides/how-to-use-guides-tour.mp4` (`12,360,550` bytes) → Linked to **GS-SOP04** (*How to Use Guides*)
4. `sops/how-to-use-sops-tour.mp4` (`20,439,939` bytes) → Linked to **GS-SOP05** (*How to Use SOPs*)
5. `users/how-to-manage-users-tour.mp4` (`24,217,325` bytes) → Linked to **GS-SOP06** (*How to Manage Users*)

---

## Bootstrap Importer CLI Commands

The importer is located at `scripts/bootstrap_content.mjs` and is run via npm scripts:

### 1. Dry-Run Mode (Default — Zero Mutations)
```bash
npm run bootstrap:content
```
- Reads and validates `bootstrap/default-content.json`.
- Compares bundle content against the current target backend.
- Displays a detailed plan of planned creates, updates, restores, and media uploads.
- **Performs zero database mutations and uploads zero files.**

### 2. Apply Mode (Live Execution)
```bash
npm run bootstrap:content -- --apply
```
- Requires explicit `--apply` flag.
- Validates the bundle schema.
- Uploads missing media assets to deterministic content-addressed storage keys.
- Creates or synchronizes the `Getting Started` playbook and its onboarding SOPs.
- Links media records in `public.media_files` via canonical RPC `fn_link_sop_media`.
