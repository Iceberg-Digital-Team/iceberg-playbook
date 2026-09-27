-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 08: Monotonic Code Generation Across Historical Soft-Deleted Rows
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- ==============================================================================
-- Problem:
-- The code generator functions (fn_generate_issue_code, fn_generate_guide_code,
-- fn_generate_sop_code) were declared as SECURITY INVOKER without SECURITY DEFINER.
-- Under the table SELECT RLS policies (e.g. issues_select_active), non-admin users
-- (such as Support) only see rows where deleted_at IS NULL.
--
-- Consequently, when an entity was soft-deleted, the SELECT MAX(...) query could not
-- see the soft-deleted row, causing the generator to calculate and return an
-- already-used code (e.g. ISS-001 again). Subsequent INSERTs failed with unique
-- primary key violations (issues_pkey).
--
-- Solution:
-- Elevate the code generator functions to SECURITY DEFINER with search_path = ''.
-- This ensures the MAX calculation scans all historical rows (both active and
-- soft-deleted) regardless of caller RLS filters, guaranteeing strictly monotonic,
-- permanent human-readable codes that are never reused.
-- ==============================================================================

-- 1. ATOMIC ISSUE CODE GENERATOR (Monotonic across all historical issues)
CREATE OR REPLACE FUNCTION public.fn_generate_issue_code(p_playbook_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code TEXT;
    v_next_num INTEGER;
BEGIN
    SELECT code INTO v_code
    FROM public.playbooks
    WHERE id = p_playbook_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playbook % not found or is inactive', p_playbook_id;
    END IF;

    -- Include all historical rows (active + soft-deleted) to prevent ID reuse
    SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::INTEGER), 0) + 1
    INTO v_next_num
    FROM public.issues
    WHERE id ~ ('^' || v_code || '-[0-9]+$');

    RETURN v_code || '-' || LPAD(v_next_num::TEXT, 3, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_generate_issue_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_issue_code(TEXT) TO authenticated, service_role;

-- 2. ATOMIC GUIDE CODE GENERATOR (Monotonic across all historical guides)
CREATE OR REPLACE FUNCTION public.fn_generate_guide_code(p_playbook_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code TEXT;
    v_next_num INTEGER;
BEGIN
    SELECT code INTO v_code
    FROM public.playbooks
    WHERE id = p_playbook_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playbook % not found or is inactive', p_playbook_id;
    END IF;

    -- Include all historical rows (active + soft-deleted) to prevent ID reuse
    SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::INTEGER), 0) + 1
    INTO v_next_num
    FROM public.guides
    WHERE id ~ ('^' || v_code || '-G[0-9]+$');

    RETURN v_code || '-G' || LPAD(v_next_num::TEXT, 2, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_generate_guide_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_guide_code(TEXT) TO authenticated, service_role;

-- 3. ATOMIC SOP CODE GENERATOR (Monotonic across all historical SOPs)
CREATE OR REPLACE FUNCTION public.fn_generate_sop_code(p_playbook_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_code TEXT;
    v_next_num INTEGER;
BEGIN
    SELECT code INTO v_code
    FROM public.playbooks
    WHERE id = p_playbook_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playbook % not found or is inactive', p_playbook_id;
    END IF;

    -- Include all historical rows (active + soft-deleted) to prevent ID reuse
    SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::INTEGER), 0) + 1
    INTO v_next_num
    FROM public.sops
    WHERE id ~ ('^' || v_code || '-SOP[0-9]+$');

    RETURN v_code || '-SOP' || LPAD(v_next_num::TEXT, 2, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_generate_sop_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_sop_code(TEXT) TO authenticated, service_role;
