-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 02: Constraints, Foreign Keys and Performance Indexes
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================

-- 1. COMPOSITE UNIQUE CONSTRAINTS FOR INTEGRITY
-- Required so that composite foreign keys can reference (id, guide_id)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_guide_version_composite') THEN
        ALTER TABLE public.guide_versions
            ADD CONSTRAINT uq_guide_version_composite UNIQUE (id, guide_id);
    END IF;
END $$;

-- 2. COMPOSITE FOREIGN KEY: CURRENT VERSION MUST BELONG TO THE SAME GUIDE
-- Mathematically prevents current_version_id from pointing to another Guide's version
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_guides_current_version_composite') THEN
        ALTER TABLE public.guides
            ADD CONSTRAINT fk_guides_current_version_composite
            FOREIGN KEY (current_version_id, id)
            REFERENCES public.guide_versions(id, guide_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- 3. RESTORED_FROM FOREIGN KEY
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_guide_versions_restored_from') THEN
        ALTER TABLE public.guide_versions
            ADD CONSTRAINT fk_guide_versions_restored_from
            FOREIGN KEY (restored_from_version_id)
            REFERENCES public.guide_versions(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- 4. CHECK CONSTRAINTS ENFORCING FRONTEND FORMATS
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_playbook_code_format') THEN
        ALTER TABLE public.playbooks
            ADD CONSTRAINT chk_playbook_code_format
            CHECK (code ~ '^[A-Z0-9]{2,5}$');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_issue_id_format') THEN
        ALTER TABLE public.issues
            ADD CONSTRAINT chk_issue_id_format
            CHECK (id ~ '^[A-Z0-9]+-[0-9]{3,}$');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_guide_id_format') THEN
        ALTER TABLE public.guides
            ADD CONSTRAINT chk_guide_id_format
            CHECK (id ~ '^[A-Z0-9]+-G[0-9]{2,}$');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sop_id_format') THEN
        ALTER TABLE public.sops
            ADD CONSTRAINT chk_sop_id_format
            CHECK (id ~ '^[A-Z0-9]+-SOP[0-9]{2,}$');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_guide_version_positive') THEN
        ALTER TABLE public.guides
            ADD CONSTRAINT chk_guide_version_positive
            CHECK (version_number >= 1);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_guide_version_num_positive') THEN
        ALTER TABLE public.guide_versions
            ADD CONSTRAINT chk_guide_version_num_positive
            CHECK (version_number >= 1);
    END IF;
END $$;

-- 5. FOREIGN KEY INDEXES (Crucial for JOIN performance & cascade checks)
CREATE INDEX IF NOT EXISTS idx_issues_playbook_id ON public.issues(playbook_id);
CREATE INDEX IF NOT EXISTS idx_guides_playbook_id ON public.guides(playbook_id);
CREATE INDEX IF NOT EXISTS idx_guides_issue_id ON public.guides(issue_id);
CREATE INDEX IF NOT EXISTS idx_guide_versions_guide_id ON public.guide_versions(guide_id);
CREATE INDEX IF NOT EXISTS idx_guide_versions_restored_from ON public.guide_versions(restored_from_version_id);
CREATE INDEX IF NOT EXISTS idx_sops_playbook_id ON public.sops(playbook_id);

CREATE INDEX IF NOT EXISTS idx_media_files_guide_id ON public.media_files(guide_id);
CREATE INDEX IF NOT EXISTS idx_media_files_guide_version_id ON public.media_files(guide_version_id);
CREATE INDEX IF NOT EXISTS idx_media_files_issue_id ON public.media_files(issue_id);
CREATE INDEX IF NOT EXISTS idx_media_files_sop_id ON public.media_files(sop_id);

-- 6. PARTIAL INDEXES FOR ACTIVE (NON-DELETED) RECORDS
CREATE INDEX IF NOT EXISTS idx_playbooks_active ON public.playbooks(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issues_active ON public.issues(id, playbook_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guides_active ON public.guides(id, issue_id, playbook_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sops_active ON public.sops(id, playbook_id) WHERE deleted_at IS NULL;

-- 7. AUDIT LOG INDEX
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
