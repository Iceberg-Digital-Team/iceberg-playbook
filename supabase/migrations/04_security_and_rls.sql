-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 04: Row Level Security (RLS) & Private Storage Policies
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================

-- 1. SECURITY DEFINER ROLE HELPERS (Optimized with search_path = '')
CREATE OR REPLACE FUNCTION public.fn_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.fn_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT public.fn_user_role() = 'Admin'), false);
$$;

CREATE OR REPLACE FUNCTION public.fn_is_support_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT public.fn_user_role() IN ('Support', 'Admin')), false);
$$;

-- Explicit privilege configuration for role helper functions
REVOKE EXECUTE ON FUNCTION public.fn_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_admin() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_is_support_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_support_or_admin() TO authenticated, service_role;

-- 2. ENABLE ROW LEVEL SECURITY ON ALL TABLES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guide_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. PROFILES POLICIES
-- Anyone authenticated can view team profiles
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

-- NO PUBLIC SIGNUP: Arbitrary authenticated users cannot create profiles or assign roles.
-- Only Admins can provision profiles directly in public schema.
DROP POLICY IF EXISTS "profiles_insert_self_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin_only" ON public.profiles;
CREATE POLICY "profiles_insert_admin_only" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_admin()));

-- Users can update their own profile name and avatar, but CANNOT change their role unless they are Admin.
-- Admins can update any user profile and assign roles.
DROP POLICY IF EXISTS "profiles_update_self_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = id OR (SELECT public.fn_is_admin()))
    WITH CHECK (
        ((SELECT auth.uid()) = id OR (SELECT public.fn_is_admin())) AND (
            role = (SELECT public.fn_user_role())
            OR (SELECT public.fn_is_admin())
        )
    );

DROP POLICY IF EXISTS "profiles_delete_admin_only" ON public.profiles;
CREATE POLICY "profiles_delete_admin_only" ON public.profiles
    FOR DELETE TO authenticated
    USING ((SELECT public.fn_is_admin()));

-- 4. PLAYBOOKS POLICIES
DROP POLICY IF EXISTS "playbooks_select_active" ON public.playbooks;
CREATE POLICY "playbooks_select_active" ON public.playbooks
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL OR (SELECT public.fn_is_admin()));

DROP POLICY IF EXISTS "playbooks_insert_support_admin" ON public.playbooks;
CREATE POLICY "playbooks_insert_support_admin" ON public.playbooks
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "playbooks_update_support_admin" ON public.playbooks;
CREATE POLICY "playbooks_update_support_admin" ON public.playbooks
    FOR UPDATE TO authenticated
    USING ((SELECT public.fn_is_support_or_admin()))
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

-- Hard DELETE is blocked for all normal users (use fn_soft_delete_playbook)
DROP POLICY IF EXISTS "playbooks_delete_admin_only" ON public.playbooks;
CREATE POLICY "playbooks_delete_admin_only" ON public.playbooks
    FOR DELETE TO authenticated
    USING ((SELECT public.fn_is_admin()));

-- 5. ISSUES POLICIES
DROP POLICY IF EXISTS "issues_select_active" ON public.issues;
CREATE POLICY "issues_select_active" ON public.issues
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL OR (SELECT public.fn_is_admin()));

DROP POLICY IF EXISTS "issues_insert_support_admin" ON public.issues;
CREATE POLICY "issues_insert_support_admin" ON public.issues
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "issues_update_support_admin" ON public.issues;
CREATE POLICY "issues_update_support_admin" ON public.issues
    FOR UPDATE TO authenticated
    USING ((SELECT public.fn_is_support_or_admin()))
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "issues_delete_admin_only" ON public.issues;
CREATE POLICY "issues_delete_admin_only" ON public.issues
    FOR DELETE TO authenticated
    USING ((SELECT public.fn_is_admin()));

-- 6. GUIDES POLICIES
DROP POLICY IF EXISTS "guides_select_active" ON public.guides;
CREATE POLICY "guides_select_active" ON public.guides
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL OR (SELECT public.fn_is_admin()));

DROP POLICY IF EXISTS "guides_insert_support_admin" ON public.guides;
CREATE POLICY "guides_insert_support_admin" ON public.guides
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "guides_update_support_admin" ON public.guides;
CREATE POLICY "guides_update_support_admin" ON public.guides
    FOR UPDATE TO authenticated
    USING ((SELECT public.fn_is_support_or_admin()))
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "guides_delete_admin_only" ON public.guides;
CREATE POLICY "guides_delete_admin_only" ON public.guides
    FOR DELETE TO authenticated
    USING ((SELECT public.fn_is_admin()));

-- 7. GUIDE_VERSIONS POLICIES (Strict Immutability)
-- All historical versions of any active Guide can be read by authenticated staff
DROP POLICY IF EXISTS "guide_versions_select_authenticated" ON public.guide_versions;
CREATE POLICY "guide_versions_select_authenticated" ON public.guide_versions
    FOR SELECT TO authenticated
    USING (true);

-- Insert allowed only for Support/Admin (normally via fn_publish_guide_version / fn_restore_guide_version)
DROP POLICY IF EXISTS "guide_versions_insert_support_admin" ON public.guide_versions;
CREATE POLICY "guide_versions_insert_support_admin" ON public.guide_versions
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

-- UPDATE IS STRICTLY FORBIDDEN ON HISTORICAL VERSIONS (IMMUTABLE SNAPSHOTS)
DROP POLICY IF EXISTS "guide_versions_no_update" ON public.guide_versions;
CREATE POLICY "guide_versions_no_update" ON public.guide_versions
    FOR UPDATE TO authenticated
    USING (false);

-- DELETE IS STRICTLY FORBIDDEN ON HISTORICAL VERSIONS
DROP POLICY IF EXISTS "guide_versions_no_delete" ON public.guide_versions;
CREATE POLICY "guide_versions_no_delete" ON public.guide_versions
    FOR DELETE TO authenticated
    USING (false);

-- 8. SOPS POLICIES
DROP POLICY IF EXISTS "sops_select_active" ON public.sops;
CREATE POLICY "sops_select_active" ON public.sops
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL OR (SELECT public.fn_is_admin()));

DROP POLICY IF EXISTS "sops_insert_support_admin" ON public.sops;
CREATE POLICY "sops_insert_support_admin" ON public.sops
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "sops_update_support_admin" ON public.sops;
CREATE POLICY "sops_update_support_admin" ON public.sops
    FOR UPDATE TO authenticated
    USING ((SELECT public.fn_is_support_or_admin()))
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "sops_delete_admin_only" ON public.sops;
CREATE POLICY "sops_delete_admin_only" ON public.sops
    FOR DELETE TO authenticated
    USING ((SELECT public.fn_is_admin()));

-- 9. MEDIA_FILES POLICIES
DROP POLICY IF EXISTS "media_files_select_authenticated" ON public.media_files;
CREATE POLICY "media_files_select_authenticated" ON public.media_files
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "media_files_insert_support_admin" ON public.media_files;
CREATE POLICY "media_files_insert_support_admin" ON public.media_files
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

-- Media linked to historical guide versions (guide_version_id IS NOT NULL) can NEVER be updated or renamed
DROP POLICY IF EXISTS "media_files_update_support_admin" ON public.media_files;
CREATE POLICY "media_files_update_support_admin" ON public.media_files
    FOR UPDATE TO authenticated
    USING (
        (SELECT public.fn_is_support_or_admin())
        AND guide_version_id IS NULL
    )
    WITH CHECK (
        (SELECT public.fn_is_support_or_admin())
        AND guide_version_id IS NULL
    );

-- Media linked to historical guide versions (guide_version_id IS NOT NULL) can NEVER be deleted
DROP POLICY IF EXISTS "media_files_delete_admin_unlinked_only" ON public.media_files;
DROP POLICY IF EXISTS "media_files_no_delete" ON public.media_files;
CREATE POLICY "media_files_delete_admin_unlinked_only" ON public.media_files
    FOR DELETE TO authenticated
    USING (
        (SELECT public.fn_is_admin())
        AND guide_version_id IS NULL
    );

-- 10. AUDIT_LOGS POLICIES (Append-only security log)
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
    FOR SELECT TO authenticated
    USING ((SELECT public.fn_is_admin()));

DROP POLICY IF EXISTS "audit_logs_insert_system" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_system" ON public.audit_logs
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.fn_is_support_or_admin()));

DROP POLICY IF EXISTS "audit_logs_no_update" ON public.audit_logs;
CREATE POLICY "audit_logs_no_update" ON public.audit_logs
    FOR UPDATE TO authenticated
    USING (false);

DROP POLICY IF EXISTS "audit_logs_no_delete" ON public.audit_logs;
CREATE POLICY "audit_logs_no_delete" ON public.audit_logs
    FOR DELETE TO authenticated
    USING (false);

-- 11. SUPABASE STORAGE POLICIES (Private "support-assets" bucket)
-- Ensures uploaded files are private, accessible only by staff.
-- Objects referenced by immutable historical guide versions cannot be deleted, renamed, replaced or moved.
DO $$ BEGIN
    DROP POLICY IF EXISTS "support_assets_select_authenticated" ON storage.objects;
    CREATE POLICY "support_assets_select_authenticated" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'support-assets' AND (SELECT public.fn_is_support_or_admin()));
EXCEPTION WHEN OTHERS THEN null;
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "support_assets_insert_support_admin" ON storage.objects;
    CREATE POLICY "support_assets_insert_support_admin" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'support-assets' AND (SELECT public.fn_is_support_or_admin()));
EXCEPTION WHEN OTHERS THEN null;
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "support_assets_update_support_admin" ON storage.objects;
    CREATE POLICY "support_assets_update_support_admin" ON storage.objects
        FOR UPDATE TO authenticated
        USING (
            bucket_id = 'support-assets'
            AND (SELECT public.fn_is_support_or_admin())
            AND NOT EXISTS (
                SELECT 1 FROM public.media_files mf
                WHERE mf.storage_key = storage.objects.name
                  AND mf.guide_version_id IS NOT NULL
            )
        )
        WITH CHECK (
            bucket_id = 'support-assets'
            AND (SELECT public.fn_is_support_or_admin())
            AND NOT EXISTS (
                SELECT 1 FROM public.media_files mf
                WHERE mf.storage_key = storage.objects.name
                  AND mf.guide_version_id IS NOT NULL
            )
        );
EXCEPTION WHEN OTHERS THEN null;
END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "support_assets_delete_admin_only" ON storage.objects;
    CREATE POLICY "support_assets_delete_admin_only" ON storage.objects
        FOR DELETE TO authenticated
        USING (
            bucket_id = 'support-assets'
            AND (SELECT public.fn_is_admin())
            AND NOT EXISTS (
                SELECT 1 FROM public.media_files mf
                WHERE mf.storage_key = storage.objects.name
                  AND mf.guide_version_id IS NOT NULL
            )
        );
EXCEPTION WHEN OTHERS THEN null;
END $$;
