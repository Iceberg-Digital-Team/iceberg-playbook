-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 07: Soft-Delete Functions Security Elevation (SECURITY DEFINER)
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- ==============================================================================
-- Fixes RLS conflict during soft-delete operations.
-- When soft-delete functions marked records with deleted_at = NOW(), PostgreSQL
-- evaluated the SELECT RLS policy on the updated rows. Since non-admin users
-- (such as Support) are restricted from selecting soft-deleted rows, PostgreSQL
-- rejected the UPDATE with SQLSTATE 42501.
--
-- Setting SECURITY DEFINER and search_path = '' ensures the internal UPDATE and
-- audit log INSERT proceed safely while preserving authorization checks
-- performed via public.fn_get_current_actor().
-- ==============================================================================

-- 1. Soft delete Playbook
ALTER FUNCTION public.fn_soft_delete_playbook(text) SECURITY DEFINER;
ALTER FUNCTION public.fn_soft_delete_playbook(text) SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_playbook(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_playbook(text) TO authenticated, service_role;

-- 2. Soft delete Issue
ALTER FUNCTION public.fn_soft_delete_issue(text) SECURITY DEFINER;
ALTER FUNCTION public.fn_soft_delete_issue(text) SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_issue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_issue(text) TO authenticated, service_role;

-- 3. Soft delete Guide
ALTER FUNCTION public.fn_soft_delete_guide(text) SECURITY DEFINER;
ALTER FUNCTION public.fn_soft_delete_guide(text) SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_guide(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_guide(text) TO authenticated, service_role;

-- 4. Soft delete SOP
ALTER FUNCTION public.fn_soft_delete_sop(text) SECURITY DEFINER;
ALTER FUNCTION public.fn_soft_delete_sop(text) SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_sop(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_sop(text) TO authenticated, service_role;
