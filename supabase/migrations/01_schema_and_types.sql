-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 01: Core Schemas, Enums, Extensions and Tables
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CUSTOM ENUMS
DO $$ BEGIN
    CREATE TYPE public.playbook_visibility AS ENUM ('Internal', 'Public');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.content_status AS ENUM ('Draft', 'Verified');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.content_difficulty AS ENUM ('Easy', 'Medium', 'Advanced');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.app_role AS ENUM ('Admin', 'Support', 'Viewer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. PROFILES TABLE (Mirrors auth.users with Support Team role attributes)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role public.app_role NOT NULL DEFAULT 'Support',
    department TEXT NOT NULL DEFAULT 'Support Team',
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. PLAYBOOKS TABLE
CREATE TABLE IF NOT EXISTS public.playbooks (
    id TEXT PRIMARY KEY, -- Slug matching frontend URL segment (e.g. 'whatsapp')
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    code VARCHAR(5) NOT NULL UNIQUE, -- 2-5 uppercase characters (e.g. 'WA', 'META')
    description TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'MessageSquare',
    owner TEXT NOT NULL DEFAULT 'Support Team',
    visibility public.playbook_visibility NOT NULL DEFAULT 'Internal',
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    deleted_by TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. ISSUES TABLE
CREATE TABLE IF NOT EXISTS public.issues (
    id TEXT PRIMARY KEY, -- Human-readable code (e.g. 'WA-001')
    playbook_id TEXT NOT NULL REFERENCES public.playbooks(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    symptoms TEXT[] NOT NULL DEFAULT '{}',
    error_message TEXT DEFAULT '',
    context TEXT DEFAULT '',
    affected_area TEXT DEFAULT '',
    information_to_collect TEXT[] NOT NULL DEFAULT '{}',
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{name: string, url: string, storage_key?: string}]
    internal_notes TEXT DEFAULT '',
    status public.content_status NOT NULL DEFAULT 'Draft',
    difficulty public.content_difficulty NOT NULL DEFAULT 'Medium',
    estimated_time TEXT DEFAULT '',
    author TEXT NOT NULL DEFAULT 'Support Team',
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    deleted_by TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. GUIDES TABLE (Stable Identity and Active Version Pointer)
CREATE TABLE IF NOT EXISTS public.guides (
    id TEXT PRIMARY KEY, -- Human-readable code (e.g. 'WA-G01')
    issue_id TEXT NOT NULL UNIQUE REFERENCES public.issues(id) ON DELETE RESTRICT,
    playbook_id TEXT NOT NULL REFERENCES public.playbooks(id) ON DELETE RESTRICT,
    current_version_id TEXT, -- Foreign key to guide_versions(id) added in migration 02
    version_number INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    status public.content_status NOT NULL DEFAULT 'Draft',
    difficulty public.content_difficulty NOT NULL DEFAULT 'Medium',
    estimated_time TEXT NOT NULL DEFAULT '15 min',
    before_you_start TEXT[] NOT NULL DEFAULT '{}',
    requirements TEXT[] NOT NULL DEFAULT '{}', -- Legacy backward compatibility
    important_information TEXT DEFAULT '',
    video TEXT DEFAULT '',
    video_storage_key TEXT,
    pdf TEXT DEFAULT '',
    pdf_storage_key TEXT,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    common_problems JSONB NOT NULL DEFAULT '[]'::jsonb,
    faq JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_items TEXT[] NOT NULL DEFAULT '{}',
    internal_notes TEXT DEFAULT '',
    revision_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    author TEXT NOT NULL DEFAULT 'Support Team',
    created_by TEXT NOT NULL DEFAULT 'Support Team',
    updated_by TEXT NOT NULL DEFAULT 'Support Team',
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    deleted_by TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. GUIDE_VERSIONS TABLE (Immutable Historical Snapshots)
-- Note: ON DELETE RESTRICT protects versions from being dropped if a Guide is deleted.
CREATE TABLE IF NOT EXISTS public.guide_versions (
    id TEXT PRIMARY KEY, -- Composite key format: e.g. 'WA-G01:v1'
    guide_id TEXT NOT NULL REFERENCES public.guides(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL,
    change_summary TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    status public.content_status NOT NULL,
    difficulty public.content_difficulty NOT NULL,
    estimated_time TEXT NOT NULL,
    before_you_start TEXT[] NOT NULL DEFAULT '{}',
    requirements TEXT[] NOT NULL DEFAULT '{}',
    important_information TEXT DEFAULT '',
    video TEXT DEFAULT '',
    video_storage_key TEXT,
    pdf TEXT DEFAULT '',
    pdf_storage_key TEXT,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    common_problems JSONB NOT NULL DEFAULT '[]'::jsonb,
    faq JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_items TEXT[] NOT NULL DEFAULT '{}',
    internal_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    restored_from_version_id TEXT,
    CONSTRAINT uq_guide_version UNIQUE (guide_id, version_number)
);

-- 8. SOPS TABLE (Standard Operating Procedures)
CREATE TABLE IF NOT EXISTS public.sops (
    id TEXT PRIMARY KEY, -- Human-readable code (e.g. 'WA-SOP01')
    playbook_id TEXT NOT NULL REFERENCES public.playbooks(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT 'Support Team',
    status public.content_status NOT NULL DEFAULT 'Draft',
    estimated_time TEXT NOT NULL DEFAULT '30 min',
    purpose TEXT NOT NULL,
    when_to_use TEXT NOT NULL,
    requirements TEXT[] NOT NULL DEFAULT '{}',
    responsible_team TEXT NOT NULL DEFAULT 'Support & Onboarding Team',
    checklist TEXT[] NOT NULL DEFAULT '{}',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    escalation_rules TEXT DEFAULT '',
    completion_criteria TEXT DEFAULT '',
    related_issues TEXT[] NOT NULL DEFAULT '{}',
    related_guides TEXT[] NOT NULL DEFAULT '{}',
    internal_notes TEXT DEFAULT '',
    revision_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    deleted_by TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. MEDIA_FILES TABLE (Tracks Durable Storage Keys & Retention)
CREATE TABLE IF NOT EXISTS public.media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key TEXT NOT NULL UNIQUE,
    bucket TEXT NOT NULL DEFAULT 'support-assets',
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('video', 'pdf', 'image', 'attachment')),
    guide_id TEXT REFERENCES public.guides(id) ON DELETE RESTRICT,
    guide_version_id TEXT REFERENCES public.guide_versions(id) ON DELETE RESTRICT,
    issue_id TEXT REFERENCES public.issues(id) ON DELETE RESTRICT,
    sop_id TEXT REFERENCES public.sops(id) ON DELETE RESTRICT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. AUDIT_LOGS TABLE (Security & Compliance Tracking)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL, -- 'playbook', 'issue', 'guide', 'guide_version', 'sop'
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'RESTORE', 'SOFT_DELETE'
    actor_id UUID,
    actor_name TEXT NOT NULL,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. STORAGE BUCKET PROVISIONING (Private "support-assets" bucket)
DO $$ BEGIN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
        'support-assets',
        'support-assets',
        false, -- Private bucket: access guarded by storage RLS policies
        52428800, -- 50 MB
        ARRAY['video/mp4', 'video/webm', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    )
    ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN null;
END $$;

