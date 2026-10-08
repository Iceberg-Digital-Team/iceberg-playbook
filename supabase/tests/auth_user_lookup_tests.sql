-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 TEST SUITE
-- File: supabase/tests/auth_user_lookup_tests.sql
-- Covers: migration 12_auth_user_lookup.sql (fn_find_auth_user_by_email)
-- Isolation Guarantee: Wrapped in BEGIN ... ROLLBACK transaction block.
--                     Leaves ZERO test records behind in the database.
-- Run as the database owner (Supabase SQL Editor or psql), after migrations 10, 11 and 12.
-- Test rows use names starting with 'TEST - ' and emails at example.test.
-- Supabase-specific parts are marked [SUPABASE]: auth.users rows and the API roles.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
    v_pass INTEGER := 0;
    v_with_profile UUID := gen_random_uuid();
    v_orphan UUID := gen_random_uuid();
    v_row RECORD;
BEGIN
    RAISE NOTICE '=== STARTING AUTH USER LOOKUP ISOLATED TEST SUITE ===';

    INSERT INTO auth.users (id, email, aud, role) VALUES -- [SUPABASE]
        (v_with_profile, 'TEST-Lookup-Profile@Example.test', 'authenticated', 'authenticated'),
        (v_orphan, 'test-lookup-orphan@example.test', 'authenticated', 'authenticated');
    INSERT INTO public.profiles (id, email, full_name, role, status)
    VALUES (v_with_profile, 'TEST-Lookup-Profile@Example.test', 'TEST - Lookup Profile', 'Viewer', 'Active');

    -- TEST 1: account with a profile, found with a different case and spaces
    SELECT * INTO v_row FROM public.fn_find_auth_user_by_email('  test-lookup-profile@example.TEST ');
    IF NOT FOUND OR v_row.user_id <> v_with_profile OR v_row.has_profile IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST 1 FAILED: account with profile not found correctly';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 1 Passed: mixed-case / spaced email finds the account; has_profile = true.';

    -- TEST 2: account without a profile (orphan)
    SELECT * INTO v_row FROM public.fn_find_auth_user_by_email('Test-Lookup-Orphan@example.test');
    IF NOT FOUND OR v_row.user_id <> v_orphan OR v_row.has_profile IS NOT FALSE THEN
        RAISE EXCEPTION 'TEST 2 FAILED: orphan account not found correctly';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 2 Passed: account without profile found; has_profile = false.';

    -- TEST 3: unknown email -> no row
    PERFORM 1 FROM public.fn_find_auth_user_by_email('test-lookup-unknown@example.test');
    IF FOUND THEN
        RAISE EXCEPTION 'TEST 3 FAILED: unknown email returned a row';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 3 Passed: unknown email returns no row.';

    -- TEST 4: only the server role may call it
    IF has_function_privilege('anon', 'public.fn_find_auth_user_by_email(text)', 'EXECUTE') -- [SUPABASE] roles
       OR has_function_privilege('authenticated', 'public.fn_find_auth_user_by_email(text)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.fn_find_auth_user_by_email(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'TEST 4 FAILED: wrong EXECUTE privileges';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 4 Passed: anon / authenticated cannot execute; service_role can.';

    RAISE NOTICE '=== ALL 4 AUTH USER LOOKUP TESTS PASSED (%/4) ===', v_pass;
END $$;

-- Complete automatic rollback: leaves zero test artifacts in database
ROLLBACK;
