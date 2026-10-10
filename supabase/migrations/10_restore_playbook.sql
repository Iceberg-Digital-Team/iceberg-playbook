-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 10: Safe Playbook Restore and Conflict Detection
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- ==============================================================================
-- Problem:
-- When a Playbook is soft-deleted, its record remains in public.playbooks with
-- deleted_at set. Because playbooks.id, slug, name, and code have global UNIQUE
-- / PRIMARY KEY constraints, attempting to recreate a Playbook with the same
-- name or code prefix triggers a PostgreSQL 23505 unique violation.
--
-- Solution:
-- 1. fn_check_playbook_conflict:
--    A SECURITY DEFINER function that distinguishes between active conflicts
--    (which must be blocked) and soft-deleted conflicts (which can be offered
--    for restoration to the user).
--
-- 2. fn_restore_playbook:
--    A SECURITY DEFINER function that verifies the target Playbook is soft-deleted,
--    clears deleted_at and deleted_by, updates updated_at, logs a 'RESTORE' event
--    in public.audit_logs, and leaves all historical child records (Issues, Guides,
--    SOPs, Versions, Media) in their existing state.
-- ==============================================================================

-- 1. CONFLICT DETECTION FUNCTION (Distinguishes active vs soft-deleted conflicts)
CREATE OR REPLACE FUNCTION public.fn_check_playbook_conflict(
    p_name TEXT,
    p_slug TEXT,
    p_code TEXT
)
RETURNS TABLE (
    conflict_type TEXT,
    conflict_field TEXT,
    playbook_id TEXT,
    playbook_name TEXT,
    playbook_slug TEXT,
    playbook_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_clean_name TEXT;
    v_clean_slug TEXT;
    v_clean_code TEXT;
    v_match RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();
    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    v_clean_name := TRIM(COALESCE(p_name, ''));
    v_clean_slug := TRIM(COALESCE(p_slug, ''));
    v_clean_code := UPPER(TRIM(COALESCE(p_code, '')));

    -- 1. Check active conflicts first (deleted_at IS NULL)
    IF v_clean_code != '' THEN
        SELECT id, name, slug, code INTO v_match
        FROM public.playbooks
        WHERE code = v_clean_code AND deleted_at IS NULL
        LIMIT 1;

        IF FOUND THEN
            RETURN QUERY SELECT 'ACTIVE_CODE'::TEXT, 'code'::TEXT, v_match.id::TEXT, v_match.name::TEXT, v_match.slug::TEXT, v_match.code::TEXT;
            RETURN;
        END IF;
    END IF;

    IF v_clean_slug != '' OR v_clean_name != '' THEN
        SELECT id, name, slug, code INTO v_match
        FROM public.playbooks
        WHERE (slug = v_clean_slug OR name ILIKE v_clean_name) AND deleted_at IS NULL
        LIMIT 1;

        IF FOUND THEN
            RETURN QUERY SELECT 'ACTIVE_NAME'::TEXT, 'name'::TEXT, v_match.id::TEXT, v_match.name::TEXT, v_match.slug::TEXT, v_match.code::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 2. Check soft-deleted conflicts (deleted_at IS NOT NULL)
    SELECT id, name, slug, code INTO v_match
    FROM public.playbooks
    WHERE (
        (v_clean_code != '' AND code = v_clean_code) OR
        (v_clean_slug != '' AND slug = v_clean_slug) OR
        (v_clean_name != '' AND name ILIKE v_clean_name) OR
        (v_clean_slug != '' AND id = v_clean_slug)
    ) AND deleted_at IS NOT NULL
    ORDER BY (
        CASE
            WHEN code = v_clean_code THEN 1
            WHEN slug = v_clean_slug THEN 2
            WHEN id = v_clean_slug THEN 3
            ELSE 4
        END
    )
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT 'DELETED_CONFLICT'::TEXT,
            (CASE WHEN v_match.code = v_clean_code THEN 'code' ELSE 'name' END)::TEXT,
            v_match.id::TEXT, v_match.name::TEXT, v_match.slug::TEXT, v_match.code::TEXT;
        RETURN;
    END IF;

    RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_check_playbook_conflict(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_check_playbook_conflict(TEXT, TEXT, TEXT) TO authenticated, service_role;


-- 2. RESTORE PLAYBOOK FUNCTION (Restores soft-deleted Playbook safely)
CREATE OR REPLACE FUNCTION public.fn_restore_playbook(p_playbook_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    UPDATE public.playbooks
    SET deleted_at = NULL,
        deleted_by = NULL,
        updated_at = NOW()
    WHERE id = p_playbook_id AND deleted_at IS NOT NULL;

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.playbooks WHERE id = p_playbook_id AND deleted_at IS NULL) THEN
            RAISE EXCEPTION 'Playbook % is already active.', p_playbook_id;
        ELSE
            RAISE EXCEPTION 'Playbook % not found or not deleted.', p_playbook_id;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('playbook', p_playbook_id, 'RESTORE', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('restored_at', NOW()));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_restore_playbook(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_restore_playbook(TEXT) TO authenticated, service_role;
