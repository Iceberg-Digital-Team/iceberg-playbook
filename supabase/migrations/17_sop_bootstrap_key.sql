-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 17: Explicit SOP Bootstrap Key for Canonical Bundle Ownership
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================
-- Purpose:
-- Adds an optional, scoped bootstrap_key column to public.sops so that canonical
-- onboarding / bootstrap bundles can track record ownership deterministically
-- without relying on machine tags in user-facing fields or fragile title matching.
--
-- Invariants & Safety:
-- 1. Existing SOP rows remain valid with NULL bootstrap_key.
-- 2. No existing data is modified or overwritten.
-- 3. Format constraint: lowercase kebab-case (e.g. 'how-to-use-playbooks')
--    CHECK (bootstrap_key IS NULL OR bootstrap_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
-- 4. Scope: Partial UNIQUE index on (playbook_id, bootstrap_key) WHERE bootstrap_key IS NOT NULL.
--    Prevents duplicate bundle keys within the same Playbook while allowing different
--    playbooks to reuse standard procedure keys if needed.
-- 5. NOT globally unique across all playbooks (scoped strictly to playbook_id).
-- 6. Importer/system metadata only; not an editable UI field.
-- 7. Zero drops, truncates, deletes, or destructive DDL statements.
-- ==============================================================================

-- 1. ADD COLUMN (Nullable with NULL default for backward compatibility)
ALTER TABLE public.sops
ADD COLUMN IF NOT EXISTS bootstrap_key TEXT DEFAULT NULL;

-- 2. FORMAT CHECK CONSTRAINT (Enforces lowercase kebab-case format)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_sop_bootstrap_key_format'
          AND conrelid = 'public.sops'::regclass
    ) THEN
        ALTER TABLE public.sops
            ADD CONSTRAINT chk_sop_bootstrap_key_format
            CHECK (bootstrap_key IS NULL OR bootstrap_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
    END IF;
END $$;

-- 3. PLAYBOOK-SCOPED PARTIAL UNIQUE INDEX
-- Ensures at most one SOP per Playbook can claim a given bootstrap_key,
-- while allowing unlimited non-bootstrap / user-authored SOPs (where bootstrap_key IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sops_playbook_bootstrap_key
ON public.sops (playbook_id, bootstrap_key)
WHERE bootstrap_key IS NOT NULL;

-- 4. DOCUMENTATION
COMMENT ON COLUMN public.sops.bootstrap_key IS
'Deterministic logical key matching canonical bootstrap bundles (e.g. default-content.json). System metadata used by idempotent content importers; not user-editable.';
