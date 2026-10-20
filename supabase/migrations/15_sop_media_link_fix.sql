-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 15: Fix SOP Media Link Role Helper
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================
-- Purpose:
-- Uses project established public.fn_is_support_or_admin() helper in public.fn_link_sop_media.
-- Preserves all Migration 14 security, ownership, and concurrency guarantees.
--
-- Security & Hardening:
-- - Uses SECURITY DEFINER with search_path = ''.
-- - Requires authenticated caller with Support or Admin role via public.fn_is_support_or_admin().
-- - Verifies target SOP exists in public.sops and is active (deleted_at IS NULL).
-- - Validates every supplied key belongs strictly to the 'sops/' namespace.
-- - Verifies every supplied key exists in public.media_files.
-- - Rejects keys linked to a guide (guide_id IS NOT NULL).
-- - Rejects keys linked to a guide version (guide_version_id IS NOT NULL).
-- - Rejects keys linked to an issue (issue_id IS NOT NULL).
-- - Rejects keys already owned by another SOP (sop_id IS NOT NULL AND sop_id <> target_sop_id).
-- - Idempotent for keys already owned by the same target SOP.
-- - Locks matching media_files rows via FOR UPDATE OF mf to prevent concurrent race conditions.
-- - ATOMIC: Any single invalid/unsafe key aborts the transaction before any rows are updated.
-- - Zero deletes, drops, truncates, or storage deletions.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_link_sop_media(
    p_sop_id TEXT,
    p_storage_keys TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_clean_sop_id TEXT;
    v_key TEXT;
    v_rec RECORD;
    v_distinct_keys TEXT[];
    v_updated_count INTEGER := 0;
BEGIN
    -- 1. Authorization check: Support or Admin role required via public.fn_is_support_or_admin()
    IF NOT public.fn_is_support_or_admin() THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    -- 2. Validate clean target SOP ID
    v_clean_sop_id := pg_catalog.btrim(p_sop_id);
    IF v_clean_sop_id IS NULL OR v_clean_sop_id = '' THEN
        RAISE EXCEPTION 'Invalid target SOP ID.';
    END IF;

    -- 3. Verify target SOP exists and is active (not soft-deleted)
    IF NOT EXISTS (
        SELECT 1 FROM public.sops
        WHERE id = v_clean_sop_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Target SOP % not found or has been deleted.', v_clean_sop_id;
    END IF;

    -- 4. Empty key list is a safe no-op
    IF p_storage_keys IS NULL OR pg_catalog.array_length(p_storage_keys, 1) IS NULL THEN
        RETURN 0;
    END IF;

    -- Deduplicate and clean supplied keys
    SELECT pg_catalog.array_agg(DISTINCT pg_catalog.btrim(k)) INTO v_distinct_keys
    FROM pg_catalog.unnest(p_storage_keys) AS k
    WHERE pg_catalog.btrim(k) IS NOT NULL AND pg_catalog.btrim(k) <> '';

    IF v_distinct_keys IS NULL OR pg_catalog.array_length(v_distinct_keys, 1) IS NULL THEN
        RETURN 0;
    END IF;

    -- 5. Validate every key belongs to the SOP namespace (sops/)
    FOREACH v_key IN ARRAY v_distinct_keys LOOP
        IF NOT (v_key LIKE 'sops/%') THEN
            RAISE EXCEPTION 'Storage key % does not belong to the sops/ namespace.', v_key;
        END IF;
    END LOOP;

    -- 6. Concurrency lock and ownership validation:
    -- Lock matching media_files rows to prevent concurrent race conditions during attribution.
    FOR v_rec IN
        SELECT
            k.key AS supplied_key,
            mf.id AS media_id,
            mf.storage_key,
            mf.guide_id,
            mf.guide_version_id,
            mf.issue_id,
            mf.sop_id
        FROM pg_catalog.unnest(v_distinct_keys) AS k(key)
        JOIN public.media_files mf ON mf.storage_key = k.key
        FOR UPDATE OF mf
    LOOP
        -- a) Must not be linked to a guide_version
        IF v_rec.guide_version_id IS NOT NULL THEN
            RAISE EXCEPTION 'Media file % is linked to a guide version and cannot be claimed by an SOP.', v_rec.supplied_key;
        END IF;

        -- b) Must not be linked to a guide
        IF v_rec.guide_id IS NOT NULL THEN
            RAISE EXCEPTION 'Media file % is linked to a guide and cannot be claimed by an SOP.', v_rec.supplied_key;
        END IF;

        -- c) Must not be linked to an issue
        IF v_rec.issue_id IS NOT NULL THEN
            RAISE EXCEPTION 'Media file % is linked to an issue and cannot be claimed by an SOP.', v_rec.supplied_key;
        END IF;

        -- d) sop_id must either be NULL or already equal to target SOP (idempotent)
        IF v_rec.sop_id IS NOT NULL AND v_rec.sop_id <> v_clean_sop_id THEN
            RAISE EXCEPTION 'Media file % is already owned by another SOP (%) and cannot be reassigned.', v_rec.supplied_key, v_rec.sop_id;
        END IF;
    END LOOP;

    -- Verify that every requested key was found in media_files registry
    FOREACH v_key IN ARRAY v_distinct_keys LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.media_files WHERE storage_key = v_key
        ) THEN
            RAISE EXCEPTION 'Media file % not found in media_files registry.', v_key;
        END IF;
    END LOOP;

    -- 7. All validations passed atomically. Update matching rows to target SOP ID.
    UPDATE public.media_files
    SET sop_id = v_clean_sop_id
    WHERE storage_key = ANY(v_distinct_keys);

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.fn_link_sop_media(TEXT, TEXT[]) IS
    'Atomically links storage keys in public.media_files to the specified sop_id after rigorous ownership and namespace validation. Rejects any unsafe, foreign-owned, or non-existent keys without partial updates.';

REVOKE EXECUTE ON FUNCTION public.fn_link_sop_media(TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_link_sop_media(TEXT, TEXT[]) TO authenticated, service_role;
