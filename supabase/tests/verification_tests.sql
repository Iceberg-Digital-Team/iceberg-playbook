-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 TEST SUITE
-- File: supabase/tests/verification_tests.sql
-- Note: MOVED OUT OF DEPLOYMENT MIGRATIONS SEQUENCE
-- Isolation Guarantee: Wrapped in BEGIN ... ROLLBACK transaction block.
--                     Leaves ZERO test records behind in the database.
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- ==============================================================================

BEGIN;

DO $$
DECLARE
    v_test_pass_count INTEGER := 0;
    v_temp_id TEXT;
    v_guide_res JSONB;
    v_err_msg TEXT;
    v_test_code TEXT;
    v_test_pb_id TEXT;
    v_test_issue_id TEXT;
    v_test_guide_id TEXT;
BEGIN
    RAISE NOTICE '=== STARTING ICEBERG PLAYBOOK V2 ISOLATED VERIFICATION TEST SUITE ===';

    -- --------------------------------------------------------------------------
    -- PREPARATION: Create Dedicated Isolated Test Playbook & Issue
    -- --------------------------------------------------------------------------
    -- Runtime-generated isolated test code (e.g. T1000 - T9999) to prevent collision with existing data
    LOOP
        v_test_code := 'T' || (1000 + FLOOR(RANDOM() * 9000)::INTEGER)::TEXT;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.playbooks
            WHERE code = v_test_code OR slug = 'test-pb-' || lower(v_test_code) OR id = 'test-pb-' || lower(v_test_code)
        );
    END LOOP;
    v_test_pb_id := 'test-pb-' || lower(v_test_code);
    v_test_issue_id := v_test_code || '-001';

    INSERT INTO public.playbooks (id, slug, name, code, description, owner, visibility)
    VALUES (v_test_pb_id, v_test_pb_id, 'Isolation Test Playbook ' || v_test_code, v_test_code, 'Test playbook for isolated verification', 'Support Team', 'Internal');

    INSERT INTO public.issues (id, playbook_id, title, summary, status, difficulty, estimated_time, author)
    VALUES (v_test_issue_id, v_test_pb_id, 'Test Issue for Verification', 'Isolated issue description', 'Verified', 'Medium', '10 min', 'Test Runner');

    -- --------------------------------------------------------------------------
    -- TEST 1: Check Constraints and Format Validation
    -- --------------------------------------------------------------------------
    BEGIN
        INSERT INTO public.playbooks (id, slug, name, code, description)
        VALUES ('bad-pb-' || lower(v_test_code), 'bad-pb-' || lower(v_test_code), 'Bad PB ' || v_test_code, 'A-1', 'Desc');
        RAISE EXCEPTION 'TEST 1 FAILED: Invalid playbook code was accepted!';
    EXCEPTION WHEN check_violation THEN
        v_test_pass_count := v_test_pass_count + 1;
        RAISE NOTICE 'Test 1 Passed: Playbook code format constraint enforced.';
    END;

    -- --------------------------------------------------------------------------
    -- TEST 2: Atomic Code Generation
    -- --------------------------------------------------------------------------
    v_temp_id := public.fn_generate_issue_code(v_test_pb_id);
    IF v_temp_id ~ ('^' || v_test_code || '-[0-9]{3}$') THEN
        v_test_pass_count := v_test_pass_count + 1;
        RAISE NOTICE 'Test 2 Passed: Issue code generation matches format (generated: %)', v_temp_id;
    ELSE
        RAISE EXCEPTION 'TEST 2 FAILED: Issue code format invalid: %', v_temp_id;
    END IF;

    -- --------------------------------------------------------------------------
    -- TEST 3: Atomic Guide Creation (fn_create_guide)
    -- --------------------------------------------------------------------------
    v_guide_res := public.fn_create_guide(
        v_test_issue_id,
        v_test_pb_id,
        jsonb_build_object(
            'title', 'Isolated Guide Title',
            'summary', 'Isolated Guide Summary',
            'status', 'Verified',
            'difficulty', 'Medium',
            'estimatedTime', '15 min',
            'steps', jsonb_build_array(
                jsonb_build_object('number', 1, 'title', 'Step 1', 'description', 'Description 1')
            )
        )
    );

    v_test_guide_id := v_guide_res->>'id';
    IF v_test_guide_id ~ ('^' || v_test_code || '-G[0-9]{2}$') AND v_guide_res->>'current_version_id' = (v_test_guide_id || ':v1') THEN
        v_test_pass_count := v_test_pass_count + 1;
        RAISE NOTICE 'Test 3 Passed: Guide created atomically with v1 snapshot (id: %)', v_test_guide_id;
    ELSE
        RAISE EXCEPTION 'TEST 3 FAILED: Guide creation result invalid: %', v_guide_res;
    END IF;

    -- --------------------------------------------------------------------------
    -- TEST 4: Composite Foreign Key - current_version_id must belong to SAME Guide
    -- --------------------------------------------------------------------------
    BEGIN
        -- Attempt to point test guide's current_version_id to a version belonging to WA-G01
        UPDATE public.guides
        SET current_version_id = 'WA-G01:v1'
        WHERE id = v_test_guide_id;
        RAISE EXCEPTION 'TEST 4 FAILED: Guide current_version_id accepted a foreign Guide version!';
    EXCEPTION WHEN foreign_key_violation THEN
        v_test_pass_count := v_test_pass_count + 1;
        RAISE NOTICE 'Test 4 Passed: Composite FK prevented cross-Guide version assignment.';
    END;

    -- --------------------------------------------------------------------------
    -- TEST 5: 1:1 Primary Guide per Issue Rule
    -- --------------------------------------------------------------------------
    BEGIN
        PERFORM public.fn_create_guide(
            v_test_issue_id,
            v_test_pb_id,
            jsonb_build_object(
                'title', 'Duplicate Guide Test',
                'summary', 'Should fail',
                'steps', jsonb_build_array(jsonb_build_object('title', 'Step 1', 'description', 'Desc 1'))
            )
        );
        RAISE EXCEPTION 'TEST 5 FAILED: Duplicate primary Guide allowed for Issue %!', v_test_issue_id;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
        IF v_err_msg ~ 'already has a primary Guide' THEN
            v_test_pass_count := v_test_pass_count + 1;
            RAISE NOTICE 'Test 5 Passed: 1:1 primary Guide per Issue rule enforced.';
        ELSE
            RAISE EXCEPTION 'TEST 5 FAILED with unexpected error: %', v_err_msg;
        END IF;
    END;

    -- --------------------------------------------------------------------------
    -- TEST 6: Guide Version Creation and Optimistic Concurrency Guard
    -- --------------------------------------------------------------------------
    -- 6a: Publish valid update (expected version is :v1)
    v_guide_res := public.fn_publish_guide_version(
        v_test_guide_id,
        jsonb_build_object(
            'title', 'Updated Isolated Guide',
            'summary', 'Updated summary for testing',
            'status', 'Verified',
            'difficulty', 'Medium',
            'estimatedTime', '25 min',
            'steps', jsonb_build_array(jsonb_build_object('number', 1, 'title', 'Step 1', 'description', 'Updated instruction'))
        ),
        v_test_guide_id || ':v1',
        'Updated via isolated automated test'
    );

    IF (v_guide_res->>'version_number')::INT = 2 AND v_guide_res->>'current_version_id' = (v_test_guide_id || ':v2') THEN
        v_test_pass_count := v_test_pass_count + 1;
        RAISE NOTICE 'Test 6a Passed: Guide updated to v2 successfully.';
    ELSE
        RAISE EXCEPTION 'TEST 6a FAILED: Guide version did not bump to 2: %', v_guide_res;
    END IF;

    -- 6b: Stale editor concurrency check (calling again with stale expected version v1)
    BEGIN
        PERFORM public.fn_publish_guide_version(
            v_test_guide_id,
            jsonb_build_object(
                'title', 'Stale Edit',
                'summary', 'Should fail',
                'steps', jsonb_build_array(jsonb_build_object('title', 'Step 1', 'description', 'Desc'))
            ),
            v_test_guide_id || ':v1', -- Stale! Active is now v2
            'Should fail concurrency check'
        );
        RAISE EXCEPTION 'TEST 6b FAILED: Stale edit was accepted!';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
        IF v_err_msg ~ 'updated elsewhere' THEN
            v_test_pass_count := v_test_pass_count + 1;
            RAISE NOTICE 'Test 6b Passed: Stale concurrency check prevented overwrite.';
        ELSE
            RAISE EXCEPTION 'TEST 6b FAILED with unexpected error: %', v_err_msg;
        END IF;
    END;

    -- --------------------------------------------------------------------------
    -- TEST 7: Guide Version Restore
    -- --------------------------------------------------------------------------
    -- Restoring v1 after v2 should create v3 with v1 content, keeping v1 & v2 intact
    v_guide_res := public.fn_restore_guide_version(
        v_test_guide_id,
        v_test_guide_id || ':v1', -- Target
        v_test_guide_id || ':v2'  -- Current expected
    );

    IF (v_guide_res->>'version_number')::INT = 3 AND v_guide_res->>'current_version_id' = (v_test_guide_id || ':v3') THEN
        IF EXISTS (SELECT 1 FROM public.guide_versions WHERE id = (v_test_guide_id || ':v1')) AND
           EXISTS (SELECT 1 FROM public.guide_versions WHERE id = (v_test_guide_id || ':v2')) AND
           EXISTS (SELECT 1 FROM public.guide_versions WHERE id = (v_test_guide_id || ':v3')) THEN
            v_test_pass_count := v_test_pass_count + 1;
            RAISE NOTICE 'Test 7 Passed: Historical restore created v3 while preserving v1 and v2 snapshots.';
        ELSE
            RAISE EXCEPTION 'TEST 7 FAILED: Historical versions missing after restore!';
        END IF;
    ELSE
        RAISE EXCEPTION 'TEST 7 FAILED: Restore result invalid: %', v_guide_res;
    END IF;

    -- --------------------------------------------------------------------------
    -- TEST 8: Domain Soft Deletion Guards
    -- --------------------------------------------------------------------------
    -- 8a: Cannot soft-delete Playbook with content
    BEGIN
        PERFORM public.fn_soft_delete_playbook(v_test_pb_id);
        RAISE EXCEPTION 'TEST 8a FAILED: Non-empty Playbook was soft-deleted!';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
        IF v_err_msg ~ 'contains content and cannot be deleted' THEN
            v_test_pass_count := v_test_pass_count + 1;
            RAISE NOTICE 'Test 8a Passed: Non-empty Playbook deletion blocked.';
        ELSE
            RAISE EXCEPTION 'TEST 8a FAILED with unexpected error: %', v_err_msg;
        END IF;
    END;

    -- 8b: Cannot soft-delete Issue with active linked Guide
    BEGIN
        PERFORM public.fn_soft_delete_issue(v_test_issue_id);
        RAISE EXCEPTION 'TEST 8b FAILED: Issue with active Guide was soft-deleted!';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
        IF v_err_msg ~ 'Cannot delete Issue with an active linked Guide' THEN
            v_test_pass_count := v_test_pass_count + 1;
            RAISE NOTICE 'Test 8b Passed: Issue deletion with active Guide blocked.';
        ELSE
            RAISE EXCEPTION 'TEST 8b FAILED with unexpected error: %', v_err_msg;
        END IF;
    END;

    -- --------------------------------------------------------------------------
    -- TEST 9: Historical Media Retention & Accidental Deletion Protection
    -- --------------------------------------------------------------------------
    INSERT INTO public.media_files (
        storage_key, filename, content_type, file_size_bytes, media_type,
        guide_id, guide_version_id, created_by
    ) VALUES (
        'playbooks/' || v_test_pb_id || '/guides/' || v_test_guide_id || '/v1/video/tutorial.mp4',
        'tutorial.mp4', 'video/mp4', 10485760, 'video',
        v_test_guide_id, v_test_guide_id || ':v1', 'Support Team'
    );

    -- Soft delete Guide
    PERFORM public.fn_soft_delete_guide(v_test_guide_id);

    -- Verify media file and v1 snapshot STILL exist
    IF EXISTS (SELECT 1 FROM public.media_files WHERE storage_key = 'playbooks/' || v_test_pb_id || '/guides/' || v_test_guide_id || '/v1/video/tutorial.mp4') AND
       EXISTS (SELECT 1 FROM public.guide_versions WHERE id = (v_test_guide_id || ':v1')) THEN
        v_test_pass_count := v_test_pass_count + 1;
        RAISE NOTICE 'Test 9 Passed: Historical media and version snapshots preserved after Guide soft-delete.';
    ELSE
        RAISE EXCEPTION 'TEST 9 FAILED: Media reference or version lost!';
    END IF;

    RAISE NOTICE '=== ALL 9 ISOLATED VERIFICATION TESTS PASSED (%/9) ===', v_test_pass_count;
END $$;

-- Complete automatic rollback: leaves zero test artifacts in database
ROLLBACK;
