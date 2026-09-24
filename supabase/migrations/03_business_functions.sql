-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 03: Business Logic Functions, Transactions and Soft Deletion
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================

-- 1. ACTOR RESOLUTION HELPER (Security Definer with empty search path)
-- Prevents privilege escalation: unauthenticated/unknown callers cannot claim 'Support' role
CREATE OR REPLACE FUNCTION public.fn_get_current_actor()
RETURNS TABLE (actor_id UUID, actor_name TEXT, actor_role public.app_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_profile RECORD;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NOT NULL THEN
        SELECT p.id, p.full_name, p.role INTO v_profile FROM public.profiles p WHERE p.id = v_uid;
        IF FOUND THEN
            RETURN QUERY SELECT v_profile.id, v_profile.full_name, v_profile.role;
            RETURN;
        END IF;
        -- Authenticated user with no profile record yet defaults to Viewer
        RETURN QUERY SELECT v_uid, 'Authenticated User'::TEXT, 'Viewer'::public.app_role;
        RETURN;
    END IF;

    -- Trusted database roles (e.g. background migrations, seed scripts, service role)
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN QUERY SELECT NULL::UUID, 'Support Team'::TEXT, 'Support'::public.app_role;
        RETURN;
    END IF;

    -- Unauthenticated callers are strictly Viewer
    RETURN QUERY SELECT NULL::UUID, 'Anonymous'::TEXT, 'Viewer'::public.app_role;
END;
$$;

-- 2. ATOMIC ISSUE CODE GENERATOR (Concurrency safe with row-level lock)
CREATE OR REPLACE FUNCTION public.fn_generate_issue_code(p_playbook_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
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

    SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::INTEGER), 0) + 1
    INTO v_next_num
    FROM public.issues
    WHERE id ~ ('^' || v_code || '-[0-9]+$');

    RETURN v_code || '-' || LPAD(v_next_num::TEXT, 3, '0');
END;
$$;

-- 3. ATOMIC GUIDE CODE GENERATOR (Concurrency safe with row-level lock)
CREATE OR REPLACE FUNCTION public.fn_generate_guide_code(p_playbook_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
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

    SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::INTEGER), 0) + 1
    INTO v_next_num
    FROM public.guides
    WHERE id ~ ('^' || v_code || '-G[0-9]+$');

    RETURN v_code || '-G' || LPAD(v_next_num::TEXT, 2, '0');
END;
$$;

-- 4. ATOMIC SOP CODE GENERATOR (Concurrency safe with row-level lock)
CREATE OR REPLACE FUNCTION public.fn_generate_sop_code(p_playbook_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
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

    SELECT COALESCE(MAX(SUBSTRING(id FROM '[0-9]+$')::INTEGER), 0) + 1
    INTO v_next_num
    FROM public.sops
    WHERE id ~ ('^' || v_code || '-SOP[0-9]+$');

    RETURN v_code || '-SOP' || LPAD(v_next_num::TEXT, 2, '0');
END;
$$;

-- 5. ATOMIC GUIDE CREATION (Creates initial Guide and immutable v1 snapshot)
CREATE OR REPLACE FUNCTION public.fn_create_guide(
    p_issue_id TEXT,
    p_playbook_id TEXT,
    p_content JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor RECORD;
    v_issue RECORD;
    v_guide_id TEXT;
    v_version_id TEXT;
    v_new_guide JSONB;
    v_before_start TEXT[];
    v_reqs TEXT[];
    v_related TEXT[];
    v_steps JSONB;
    v_problems JSONB;
    v_faq JSONB;
    v_video_key TEXT;
    v_pdf_key TEXT;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    -- Role check: Only Support or Admin can create guides
    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    -- Validate Issue existence and active status
    SELECT * INTO v_issue FROM public.issues WHERE id = p_issue_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Select an existing Related Issue.';
    END IF;

    IF v_issue.playbook_id != p_playbook_id THEN
        RAISE EXCEPTION 'The Guide must use its Issue’s Playbook.';
    END IF;

    -- Enforce 1:1 primary Guide per Issue rule
    IF EXISTS (SELECT 1 FROM public.guides WHERE issue_id = p_issue_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'This Issue already has a primary Guide. Open the existing Guide.';
    END IF;

    -- Validate required fields
    IF NULLIF(TRIM(p_content->>'title'), '') IS NULL OR NULLIF(TRIM(p_content->>'summary'), '') IS NULL THEN
        RAISE EXCEPTION 'Add a Guide title, summary, and complete solution steps.';
    END IF;

    IF jsonb_typeof(p_content->'steps') != 'array' OR jsonb_array_length(p_content->'steps') = 0 THEN
        RAISE EXCEPTION 'Add a Guide title, summary, and complete solution steps.';
    END IF;

    -- Safe JSON array extractions
    v_before_start := CASE WHEN jsonb_typeof(p_content->'beforeYouStart') = 'array'
                           THEN ARRAY(SELECT jsonb_array_elements_text(p_content->'beforeYouStart'))
                           ELSE '{}'::TEXT[] END;
    v_reqs := CASE WHEN jsonb_typeof(p_content->'requirements') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(p_content->'requirements'))
                   ELSE '{}'::TEXT[] END;
    v_related := CASE WHEN jsonb_typeof(p_content->'relatedItems') = 'array'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_content->'relatedItems'))
                      ELSE '{}'::TEXT[] END;
    v_steps := p_content->'steps';
    v_problems := CASE WHEN jsonb_typeof(p_content->'commonProblems') = 'array' THEN p_content->'commonProblems' ELSE '[]'::jsonb END;
    v_faq := CASE WHEN jsonb_typeof(p_content->'faq') = 'array' THEN p_content->'faq' ELSE '[]'::jsonb END;
    v_video_key := NULLIF(TRIM(p_content->>'videoStorageKey'), '');
    v_pdf_key := NULLIF(TRIM(p_content->>'pdfStorageKey'), '');

    v_guide_id := public.fn_generate_guide_code(p_playbook_id);
    v_version_id := v_guide_id || ':v1';

    -- 1. Insert initial Guide record with temporary NULL current_version_id
    INSERT INTO public.guides (
        id, issue_id, playbook_id, current_version_id, version_number,
        title, summary, status, difficulty, estimated_time,
        before_you_start, requirements, important_information,
        video, video_storage_key, pdf, pdf_storage_key,
        steps, common_problems, faq, related_items, internal_notes,
        revision_history, author, created_by, updated_by,
        created_at, updated_at
    ) VALUES (
        v_guide_id, p_issue_id, p_playbook_id, NULL, 1,
        p_content->>'title', p_content->>'summary',
        COALESCE((p_content->>'status')::public.content_status, 'Draft'),
        COALESCE((p_content->>'difficulty')::public.content_difficulty, 'Medium'),
        COALESCE(p_content->>'estimatedTime', '15 min'),
        v_before_start, v_reqs,
        COALESCE(p_content->>'importantInformation', ''),
        COALESCE(p_content->>'video', ''),
        v_video_key,
        COALESCE(p_content->>'pdf', ''),
        v_pdf_key,
        v_steps, v_problems, v_faq, v_related,
        COALESCE(p_content->>'internalNotes', ''),
        COALESCE(p_content->'revisionHistory', '[]'::jsonb),
        v_actor.actor_name, v_actor.actor_name, v_actor.actor_name,
        NOW(), NOW()
    );

    -- 2. Insert immutable v1 snapshot into guide_versions
    INSERT INTO public.guide_versions (
        id, guide_id, version_number, change_summary,
        title, summary, status, difficulty, estimated_time,
        before_you_start, requirements, important_information,
        video, video_storage_key, pdf, pdf_storage_key,
        steps, common_problems, faq, related_items, internal_notes,
        created_at, created_by, restored_from_version_id
    ) VALUES (
        v_version_id, v_guide_id, 1, 'Initial Guide created.',
        p_content->>'title', p_content->>'summary',
        COALESCE((p_content->>'status')::public.content_status, 'Draft'),
        COALESCE((p_content->>'difficulty')::public.content_difficulty, 'Medium'),
        COALESCE(p_content->>'estimatedTime', '15 min'),
        v_before_start, v_reqs,
        COALESCE(p_content->>'importantInformation', ''),
        COALESCE(p_content->>'video', ''),
        v_video_key,
        COALESCE(p_content->>'pdf', ''),
        v_pdf_key,
        v_steps, v_problems, v_faq, v_related,
        COALESCE(p_content->>'internalNotes', ''),
        NOW(), v_actor.actor_name, NULL
    );

    -- 3. Set current_version_id now that v1 exists
    UPDATE public.guides SET current_version_id = v_version_id WHERE id = v_guide_id;

    -- 4. Atomically link media file references if storage keys were provided
    IF v_video_key IS NOT NULL THEN
        UPDATE public.media_files
        SET guide_id = v_guide_id, guide_version_id = v_version_id
        WHERE storage_key = v_video_key;
    END IF;

    IF v_pdf_key IS NOT NULL THEN
        UPDATE public.media_files
        SET guide_id = v_guide_id, guide_version_id = v_version_id
        WHERE storage_key = v_pdf_key;
    END IF;

    -- 5. Audit Log
    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('guide', v_guide_id, 'CREATE', v_actor.actor_id, v_actor.actor_name, jsonb_build_object('version', 1));

    SELECT to_jsonb(g) INTO v_new_guide FROM public.guides g WHERE g.id = v_guide_id;
    RETURN v_new_guide;
END;
$$;

-- 6. ATOMIC GUIDE UPDATE (Creates a new immutable version with concurrency check)
CREATE OR REPLACE FUNCTION public.fn_publish_guide_version(
    p_guide_id TEXT,
    p_content JSONB,
    p_expected_version_id TEXT,
    p_change_summary TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor RECORD;
    v_guide RECORD;
    v_new_version_num INTEGER;
    v_new_version_id TEXT;
    v_result JSONB;
    v_before_start TEXT[];
    v_reqs TEXT[];
    v_related TEXT[];
    v_steps JSONB;
    v_problems JSONB;
    v_faq JSONB;
    v_video_key TEXT;
    v_pdf_key TEXT;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    -- Role check: Only Support or Admin can publish guide versions
    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    -- Lock Guide record for concurrency check
    SELECT * INTO v_guide FROM public.guides WHERE id = p_guide_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Guide not found.';
    END IF;

    IF v_guide.current_version_id != p_expected_version_id THEN
        RAISE EXCEPTION 'This Guide was updated elsewhere. Reopen the current Guide before publishing. Your changes have not been saved.';
    END IF;

    -- Validate required fields
    IF NULLIF(TRIM(p_content->>'title'), '') IS NULL OR NULLIF(TRIM(p_content->>'summary'), '') IS NULL THEN
        RAISE EXCEPTION 'Add a Guide title, summary, and complete solution steps.';
    END IF;

    IF jsonb_typeof(p_content->'steps') != 'array' OR jsonb_array_length(p_content->'steps') = 0 THEN
        RAISE EXCEPTION 'Add a Guide title, summary, and complete solution steps.';
    END IF;

    -- Safe JSON extractions
    v_before_start := CASE WHEN jsonb_typeof(p_content->'beforeYouStart') = 'array'
                           THEN ARRAY(SELECT jsonb_array_elements_text(p_content->'beforeYouStart'))
                           ELSE '{}'::TEXT[] END;
    v_reqs := CASE WHEN jsonb_typeof(p_content->'requirements') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(p_content->'requirements'))
                   ELSE '{}'::TEXT[] END;
    v_related := CASE WHEN jsonb_typeof(p_content->'relatedItems') = 'array'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_content->'relatedItems'))
                      ELSE '{}'::TEXT[] END;
    v_steps := p_content->'steps';
    v_problems := CASE WHEN jsonb_typeof(p_content->'commonProblems') = 'array' THEN p_content->'commonProblems' ELSE '[]'::jsonb END;
    v_faq := CASE WHEN jsonb_typeof(p_content->'faq') = 'array' THEN p_content->'faq' ELSE '[]'::jsonb END;
    v_video_key := NULLIF(TRIM(p_content->>'videoStorageKey'), '');
    v_pdf_key := NULLIF(TRIM(p_content->>'pdfStorageKey'), '');

    v_new_version_num := v_guide.version_number + 1;
    v_new_version_id := p_guide_id || ':v' || v_new_version_num;

    -- 1. Insert snapshot into guide_versions
    INSERT INTO public.guide_versions (
        id, guide_id, version_number, change_summary,
        title, summary, status, difficulty, estimated_time,
        before_you_start, requirements, important_information,
        video, video_storage_key, pdf, pdf_storage_key,
        steps, common_problems, faq, related_items, internal_notes,
        created_at, created_by, restored_from_version_id
    ) VALUES (
        v_new_version_id, p_guide_id, v_new_version_num,
        COALESCE(NULLIF(TRIM(p_change_summary), ''), 'Guide updated'),
        p_content->>'title', p_content->>'summary',
        COALESCE((p_content->>'status')::public.content_status, v_guide.status),
        COALESCE((p_content->>'difficulty')::public.content_difficulty, v_guide.difficulty),
        COALESCE(p_content->>'estimatedTime', v_guide.estimated_time),
        v_before_start, v_reqs,
        COALESCE(p_content->>'importantInformation', ''),
        COALESCE(p_content->>'video', ''),
        v_video_key,
        COALESCE(p_content->>'pdf', ''),
        v_pdf_key,
        v_steps, v_problems, v_faq, v_related,
        COALESCE(p_content->>'internalNotes', ''),
        NOW(), v_actor.actor_name, NULL
    );

    -- 2. Update active Guide pointer and projection
    UPDATE public.guides SET
        current_version_id = v_new_version_id,
        version_number = v_new_version_num,
        title = p_content->>'title',
        summary = p_content->>'summary',
        status = COALESCE((p_content->>'status')::public.content_status, v_guide.status),
        difficulty = COALESCE((p_content->>'difficulty')::public.content_difficulty, v_guide.difficulty),
        estimated_time = COALESCE(p_content->>'estimatedTime', v_guide.estimated_time),
        before_you_start = v_before_start,
        requirements = v_reqs,
        important_information = COALESCE(p_content->>'importantInformation', ''),
        video = COALESCE(p_content->>'video', ''),
        video_storage_key = v_video_key,
        pdf = COALESCE(p_content->>'pdf', ''),
        pdf_storage_key = v_pdf_key,
        steps = v_steps,
        common_problems = v_problems,
        faq = v_faq,
        related_items = v_related,
        internal_notes = COALESCE(p_content->>'internalNotes', ''),
        updated_by = v_actor.actor_name,
        updated_at = NOW()
    WHERE id = p_guide_id;

    -- 3. Link media files to this new immutable version
    IF v_video_key IS NOT NULL THEN
        UPDATE public.media_files
        SET guide_id = p_guide_id, guide_version_id = v_new_version_id
        WHERE storage_key = v_video_key;
    END IF;

    IF v_pdf_key IS NOT NULL THEN
        UPDATE public.media_files
        SET guide_id = p_guide_id, guide_version_id = v_new_version_id
        WHERE storage_key = v_pdf_key;
    END IF;

    -- 4. Audit Log
    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('guide', p_guide_id, 'UPDATE', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('version', v_new_version_num, 'change_summary', p_change_summary));

    SELECT to_jsonb(g) INTO v_result FROM public.guides g WHERE g.id = p_guide_id;
    RETURN v_result;
END;
$$;

-- 7. ATOMIC GUIDE RESTORE (Clones historical version into a new version; history is preserved)
CREATE OR REPLACE FUNCTION public.fn_restore_guide_version(
    p_guide_id TEXT,
    p_target_version_id TEXT,
    p_expected_version_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor RECORD;
    v_guide RECORD;
    v_target RECORD;
    v_new_version_num INTEGER;
    v_new_version_id TEXT;
    v_change_summary TEXT;
    v_result JSONB;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    -- Role check: Only Support or Admin can restore guide versions
    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    -- Lock Guide record for concurrency check
    SELECT * INTO v_guide FROM public.guides WHERE id = p_guide_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Guide not found.';
    END IF;

    IF v_guide.current_version_id != p_expected_version_id THEN
        RAISE EXCEPTION 'This Guide was updated elsewhere. Reopen the current Guide before publishing. Your changes have not been saved.';
    END IF;

    IF p_target_version_id = p_expected_version_id THEN
        RAISE EXCEPTION 'This version is already current.';
    END IF;

    -- Validate target version belongs to THIS Guide
    SELECT * INTO v_target
    FROM public.guide_versions
    WHERE id = p_target_version_id AND guide_id = p_guide_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Historical version not found.';
    END IF;

    v_new_version_num := v_guide.version_number + 1;
    v_new_version_id := p_guide_id || ':v' || v_new_version_num;
    v_change_summary := 'Restored from version 1.' || (v_target.version_number - 1);

    -- 1. Insert restored content as a brand new snapshot in guide_versions
    INSERT INTO public.guide_versions (
        id, guide_id, version_number, change_summary,
        title, summary, status, difficulty, estimated_time,
        before_you_start, requirements, important_information,
        video, video_storage_key, pdf, pdf_storage_key,
        steps, common_problems, faq, related_items, internal_notes,
        created_at, created_by, restored_from_version_id
    ) VALUES (
        v_new_version_id, p_guide_id, v_new_version_num, v_change_summary,
        v_target.title, v_target.summary, v_target.status, v_target.difficulty, v_target.estimated_time,
        v_target.before_you_start, v_target.requirements, v_target.important_information,
        v_target.video, v_target.video_storage_key, v_target.pdf, v_target.pdf_storage_key,
        v_target.steps, v_target.common_problems, v_target.faq, v_target.related_items, v_target.internal_notes,
        NOW(), v_actor.actor_name, p_target_version_id
    );

    -- 2. Update active Guide pointer and projection
    UPDATE public.guides SET
        current_version_id = v_new_version_id,
        version_number = v_new_version_num,
        title = v_target.title,
        summary = v_target.summary,
        status = v_target.status,
        difficulty = v_target.difficulty,
        estimated_time = v_target.estimated_time,
        before_you_start = v_target.before_you_start,
        requirements = v_target.requirements,
        important_information = v_target.important_information,
        video = v_target.video,
        video_storage_key = v_target.video_storage_key,
        pdf = v_target.pdf,
        pdf_storage_key = v_target.pdf_storage_key,
        steps = v_target.steps,
        common_problems = v_target.common_problems,
        faq = v_target.faq,
        related_items = v_target.related_items,
        internal_notes = v_target.internal_notes,
        updated_by = v_actor.actor_name,
        updated_at = NOW()
    WHERE id = p_guide_id;

    -- 3. Audit Log
    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('guide', p_guide_id, 'RESTORE', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('version', v_new_version_num, 'restored_from_version_id', p_target_version_id));

    SELECT to_jsonb(g) INTO v_result FROM public.guides g WHERE g.id = p_guide_id;
    RETURN v_result;
END;
$$;

-- 8. SAFE SOFT-DELETION FUNCTIONS (With domain integrity guards)

-- Soft delete Playbook: only allowed if Playbook contains NO active content (Settings.tsx rule)
CREATE OR REPLACE FUNCTION public.fn_soft_delete_playbook(p_playbook_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor RECORD;
    v_issue_count INTEGER;
    v_guide_count INTEGER;
    v_sop_count INTEGER;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    SELECT COUNT(*) INTO v_issue_count FROM public.issues WHERE playbook_id = p_playbook_id AND deleted_at IS NULL;
    SELECT COUNT(*) INTO v_guide_count FROM public.guides WHERE playbook_id = p_playbook_id AND deleted_at IS NULL;
    SELECT COUNT(*) INTO v_sop_count FROM public.sops WHERE playbook_id = p_playbook_id AND deleted_at IS NULL;

    IF (v_issue_count + v_guide_count + v_sop_count) > 0 THEN
        RAISE EXCEPTION 'This Playbook contains content and cannot be deleted.';
    END IF;

    UPDATE public.playbooks
    SET deleted_at = NOW(), deleted_by = v_actor.actor_name
    WHERE id = p_playbook_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playbook % not found or already deleted.', p_playbook_id;
    END IF;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name)
    VALUES ('playbook', p_playbook_id, 'SOFT_DELETE', v_actor.actor_id, v_actor.actor_name);
END;
$$;

-- Soft delete Issue: cannot delete Issue if an active Guide links to it
CREATE OR REPLACE FUNCTION public.fn_soft_delete_issue(p_issue_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.guides WHERE issue_id = p_issue_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Cannot delete Issue with an active linked Guide. Remove or reassign the Guide first.';
    END IF;

    UPDATE public.issues
    SET deleted_at = NOW(), deleted_by = v_actor.actor_name
    WHERE id = p_issue_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Issue % not found or already deleted.', p_issue_id;
    END IF;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name)
    VALUES ('issue', p_issue_id, 'SOFT_DELETE', v_actor.actor_id, v_actor.actor_name);
END;
$$;

-- Soft delete Guide: Guide is hidden; Guide Versions remain permanently intact
CREATE OR REPLACE FUNCTION public.fn_soft_delete_guide(p_guide_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    UPDATE public.guides
    SET deleted_at = NOW(), deleted_by = v_actor.actor_name
    WHERE id = p_guide_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Guide % not found or already deleted.', p_guide_id;
    END IF;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name)
    VALUES ('guide', p_guide_id, 'SOFT_DELETE', v_actor.actor_id, v_actor.actor_name);
END;
$$;

-- Soft delete SOP
CREATE OR REPLACE FUNCTION public.fn_soft_delete_sop(p_sop_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_get_current_actor();

    IF v_actor.actor_role NOT IN ('Support', 'Admin') THEN
        RAISE EXCEPTION 'Permission denied. Support or Admin role required.';
    END IF;

    UPDATE public.sops
    SET deleted_at = NOW(), deleted_by = v_actor.actor_name
    WHERE id = p_sop_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SOP % not found or already deleted.', p_sop_id;
    END IF;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name)
    VALUES ('sop', p_sop_id, 'SOFT_DELETE', v_actor.actor_id, v_actor.actor_name);
END;
$$;

-- 9. LEAST PRIVILEGE: REVOKE EXECUTE FROM PUBLIC AND GRANT TO EXPLICIT ROLES
-- Internal & code generator helpers
REVOKE EXECUTE ON FUNCTION public.fn_get_current_actor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_current_actor() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_generate_issue_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_issue_code(TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_generate_guide_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_guide_code(TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_generate_sop_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_sop_code(TEXT) TO authenticated, service_role;

-- Mutation RPC functions (internally enforce Support/Admin authorization)
REVOKE EXECUTE ON FUNCTION public.fn_create_guide(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_guide(TEXT, TEXT, JSONB) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_publish_guide_version(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_publish_guide_version(TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_restore_guide_version(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_restore_guide_version(TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_playbook(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_playbook(TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_issue(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_issue(TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_guide(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_guide(TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_soft_delete_sop(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_soft_delete_sop(TEXT) TO authenticated, service_role;
