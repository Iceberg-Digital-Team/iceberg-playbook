-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 16: Safe Read-Only Orphan Media Audit Function
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================
-- Purpose:
-- Provides a strictly READ-ONLY maintenance audit function that inspects storage
-- objects in the 'support-assets' bucket and identifies candidate orphan media.
--
-- Authoritative Invariant:
-- Actual content references in public.guides, public.guide_versions,
-- public.sops, and public.issues are AUTHORITATIVE.
-- A public.media_files row is metadata only and must NEVER be the sole reason
-- to classify a Storage object as used or unused.
--
-- Protected Reference Sources:
-- 1. public.guides (active and soft-deleted records):
--    - video_storage_key
--    - pdf_storage_key
--    - steps[].screenshot
--    - steps[].videoLink
--    - steps[].pdfReference
-- 2. public.guide_versions (all historical snapshots, permanently protected):
--    - video_storage_key
--    - pdf_storage_key
--    - steps[].screenshot
--    - steps[].videoLink
--    - steps[].pdfReference
-- 3. public.sops (active and soft-deleted records):
--    - steps[].screenshot
--    - steps[].videoLink
--    - steps[].pdfReference
-- 4. public.issues (active and soft-deleted records):
--    - attachments[].url
--    - attachments[].storage_key
--    - attachments[].key
--    - attachments[].path
--    - attachments[] string elements
--
-- Grace Period Rule:
-- Default grace period is 24 hours. Any Storage object created within the
-- grace period (age <= p_grace_hours) is NOT an orphan candidate, even if
-- currently unreferenced (protects active authoring sessions and drafts).
--
-- Security:
-- - Read-only STABLE function: zero INSERT, UPDATE, DELETE, or DROP.
-- - SECURITY DEFINER with search_path = ''.
-- - REVOKE from PUBLIC, anon, and authenticated.
-- - GRANT EXECUTE to service_role only (server-side maintenance).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_audit_orphan_media(
    p_grace_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    storage_key TEXT,
    created_at TIMESTAMPTZ,
    size_bytes BIGINT,
    content_type TEXT,
    age_hours NUMERIC,
    has_media_files_row BOOLEAN,
    media_file_id UUID,
    sop_id TEXT,
    guide_id TEXT,
    guide_version_id TEXT,
    issue_id TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_grace_hours INTEGER;
    v_cutoff TIMESTAMPTZ;
BEGIN
    v_grace_hours := COALESCE(p_grace_hours, 24);
    IF v_grace_hours < 0 THEN
        v_grace_hours := 0;
    END IF;
    v_cutoff := pg_catalog.now() - (v_grace_hours || ' hours')::interval;

    RETURN QUERY
    WITH protected_keys AS (
        -- 1. Guides (active & soft-deleted)
        SELECT g.video_storage_key AS p_key
        FROM public.guides g
        WHERE g.video_storage_key IS NOT NULL AND g.video_storage_key <> ''

        UNION

        SELECT g.pdf_storage_key AS p_key
        FROM public.guides g
        WHERE g.pdf_storage_key IS NOT NULL AND g.pdf_storage_key <> ''

        UNION

        SELECT s->>'screenshot' AS p_key
        FROM public.guides g,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(g.steps) = 'array' THEN g.steps ELSE '[]'::jsonb END) s
        WHERE s->>'screenshot' IS NOT NULL AND s->>'screenshot' <> ''

        UNION

        SELECT s->>'videoLink' AS p_key
        FROM public.guides g,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(g.steps) = 'array' THEN g.steps ELSE '[]'::jsonb END) s
        WHERE s->>'videoLink' IS NOT NULL AND s->>'videoLink' <> ''

        UNION

        SELECT s->>'pdfReference' AS p_key
        FROM public.guides g,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(g.steps) = 'array' THEN g.steps ELSE '[]'::jsonb END) s
        WHERE s->>'pdfReference' IS NOT NULL AND s->>'pdfReference' <> ''

        -- 2. Guide Versions (historical snapshots, permanently protected)
        UNION

        SELECT gv.video_storage_key AS p_key
        FROM public.guide_versions gv
        WHERE gv.video_storage_key IS NOT NULL AND gv.video_storage_key <> ''

        UNION

        SELECT gv.pdf_storage_key AS p_key
        FROM public.guide_versions gv
        WHERE gv.pdf_storage_key IS NOT NULL AND gv.pdf_storage_key <> ''

        UNION

        SELECT s->>'screenshot' AS p_key
        FROM public.guide_versions gv,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(gv.steps) = 'array' THEN gv.steps ELSE '[]'::jsonb END) s
        WHERE s->>'screenshot' IS NOT NULL AND s->>'screenshot' <> ''

        UNION

        SELECT s->>'videoLink' AS p_key
        FROM public.guide_versions gv,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(gv.steps) = 'array' THEN gv.steps ELSE '[]'::jsonb END) s
        WHERE s->>'videoLink' IS NOT NULL AND s->>'videoLink' <> ''

        UNION

        SELECT s->>'pdfReference' AS p_key
        FROM public.guide_versions gv,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(gv.steps) = 'array' THEN gv.steps ELSE '[]'::jsonb END) s
        WHERE s->>'pdfReference' IS NOT NULL AND s->>'pdfReference' <> ''

        -- 3. SOPs (active & soft-deleted)
        UNION

        SELECT s->>'screenshot' AS p_key
        FROM public.sops sop,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(sop.steps) = 'array' THEN sop.steps ELSE '[]'::jsonb END) s
        WHERE s->>'screenshot' IS NOT NULL AND s->>'screenshot' <> ''

        UNION

        SELECT s->>'videoLink' AS p_key
        FROM public.sops sop,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(sop.steps) = 'array' THEN sop.steps ELSE '[]'::jsonb END) s
        WHERE s->>'videoLink' IS NOT NULL AND s->>'videoLink' <> ''

        UNION

        SELECT s->>'pdfReference' AS p_key
        FROM public.sops sop,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(sop.steps) = 'array' THEN sop.steps ELSE '[]'::jsonb END) s
        WHERE s->>'pdfReference' IS NOT NULL AND s->>'pdfReference' <> ''

        -- 4. Issues (active & soft-deleted)
        UNION

        SELECT att_sub.att_key AS p_key
        FROM public.issues iss,
        LATERAL pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(iss.attachments) = 'array' THEN iss.attachments ELSE '[]'::jsonb END) a,
        LATERAL (
            SELECT a->>'storage_key' AS att_key WHERE a->>'storage_key' IS NOT NULL AND a->>'storage_key' <> ''
            UNION ALL
            SELECT a->>'url' AS att_key WHERE a->>'url' IS NOT NULL AND a->>'url' <> '' AND a->>'url' NOT LIKE 'http://%' AND a->>'url' NOT LIKE 'https://%' AND a->>'url' NOT LIKE 'blob:%' AND a->>'url' NOT LIKE 'data:%'
            UNION ALL
            SELECT a->>'key' AS att_key WHERE a->>'key' IS NOT NULL AND a->>'key' <> ''
            UNION ALL
            SELECT a->>'path' AS att_key WHERE a->>'path' IS NOT NULL AND a->>'path' <> ''
            UNION ALL
            SELECT a #>> '{}' AS att_key WHERE pg_catalog.jsonb_typeof(a) = 'string' AND (a #>> '{}') NOT LIKE 'http://%' AND (a #>> '{}') NOT LIKE 'https://%' AND (a #>> '{}') NOT LIKE 'blob:%' AND (a #>> '{}') NOT LIKE 'data:%' AND (a #>> '{}') <> ''
        ) att_sub
    )
    SELECT
        so.name AS storage_key,
        so.created_at,
        (so.metadata->>'size')::BIGINT AS size_bytes,
        so.metadata->>'mimetype' AS content_type,
        pg_catalog.round((EXTRACT(epoch FROM (pg_catalog.now() - so.created_at)) / 3600.0)::numeric, 2) AS age_hours,
        (mf.id IS NOT NULL) AS has_media_files_row,
        mf.id AS media_file_id,
        mf.sop_id,
        mf.guide_id,
        mf.guide_version_id,
        mf.issue_id
    FROM storage.objects so
    LEFT JOIN public.media_files mf ON mf.storage_key = so.name
    LEFT JOIN protected_keys pk ON pk.p_key = so.name
    WHERE so.bucket_id = 'support-assets'
      AND pk.p_key IS NULL
      AND so.created_at <= v_cutoff
    ORDER BY so.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_audit_orphan_media(INTEGER) IS
'Read-only maintenance audit function. Compares support-assets storage objects against authoritative content references in guides, guide_versions, sops, and issues. Strictly read-only; service_role maintenance access only.';

-- Lock down execution privileges:
REVOKE ALL ON FUNCTION public.fn_audit_orphan_media(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_audit_orphan_media(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.fn_audit_orphan_media(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_orphan_media(INTEGER) TO service_role;
