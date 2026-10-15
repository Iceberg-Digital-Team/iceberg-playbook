# Canonical Default Onboarding Content Bundle

This directory contains the vendor-neutral default onboarding and bootstrap package for the **Iceberg Support Playbook** platform.

---

## Purpose and Architecture

1. **Vendor-Neutral Canonical Content**:
   - The content defined in [`default-content.json`](./default-content.json) is the single source of truth for platform onboarding.
   - It is strictly **vendor-neutral** and not tied to Supabase or any specific database implementation.
   - All relationships are defined using logical keys (for example, `"playbookKey": "getting-started"`) rather than database-generated primary keys or UUIDs.

2. **Storage and Backend Portability**:
   - The current Supabase reference implementation will import this bundle through a dedicated adapter.
   - In production or future deployments, Iceberg can replace that adapter with its own proprietary storage, backend APIs, or database without modifying this content bundle.
   - Content and media assets remain portable and unchanged across environments.

3. **Separation of Concerns**:
   - **Default Onboarding Content** (this bundle): Baseline operational procedures, getting started workflows, and core compliance SOPs required for a functioning workspace.
   - **Demo / Sample Data**: Ephemeral test data (such as dummy test issues or mock tickets) must remain strictly separate from this canonical bundle.

4. **Idempotence**:
   - Any future bootstrap importer must be strictly **idempotent**.
   - Rerunning the import process multiple times against an existing workspace must update or preserve existing records without creating duplicates or breaking existing relational references.

5. **Portable Media Assets**:
   - Screenshots, video chapters, and documentation PDFs associated with this onboarding package will be organized under [`assets/getting-started/`](./assets/getting-started/).
   - References in [`default-content.json`](./default-content.json) use portable relative paths (such as `assets/getting-started/sops/example.png`) or external HTTPS URLs.
   - Media references with `data:` or `javascript:` schemes are explicitly disallowed by [`default-content.schema.json`](./default-content.schema.json).

---

## Directory Structure

```
bootstrap/
  ├── README.md                      # Architecture and onboarding documentation
  ├── default-content.json           # Canonical vendor-neutral bundle content
  ├── default-content.schema.json    # JSON Schema validation specification
  └── assets/
      └── getting-started/
          ├── playbooks/             # Playbook headers, icons, and diagrams (.gitkeep)
          ├── issues/                # Issue diagnostic screenshots and logs (.gitkeep)
          ├── guides/                # Guide tutorial videos and attachments (.gitkeep)
          ├── sops/                  # SOP step screenshots, videos, and PDFs (.gitkeep)
          └── users/                 # Administrative user provisioning assets (.gitkeep)
```

---

## Intended Future Command

A future phase will introduce an automated idempotent importer command:

```bash
npm run bootstrap:content
```

> **Note**: This command is documented for forward compatibility and planning. The importer logic has not been implemented in this phase.
