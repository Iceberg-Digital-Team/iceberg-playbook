-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 TEST SUITE
-- File: supabase/tests/user_management_tests.sql
-- Covers: migrations 11_user_management.sql and 12_user_invitation_security.sql
-- Isolation Guarantee: Wrapped in BEGIN ... ROLLBACK transaction block.
--                     Leaves ZERO test records behind in the database.
-- Run as the database owner (Supabase SQL Editor or psql), after migrations 01-12
-- (10 = the team lead's 10_restore_playbook.sql; 11 and 12 are User Management).
-- Test rows use names starting with 'TEST - ' and emails at example.test.
-- Supabase-specific parts are marked [SUPABASE]: auth.users rows, request.jwt.claims,
-- and SET ROLE authenticated.
-- The token hashes below are hashes of fake test strings, not real tokens.
-- ==============================================================================

BEGIN;

-- Temporary helpers (pg_temp, gone after the session; the transaction rolls back anyway)

-- Fake token hash: lower-case hex SHA-256 of a test seed.
CREATE FUNCTION pg_temp.um_hash(p_seed TEXT) RETURNS TEXT
LANGUAGE sql AS $$
    SELECT encode(sha256(convert_to('test-um-token-' || p_seed, 'UTF8')), 'hex');
$$;

-- Simulates the JWT of a signed-in user (NULL = no JWT). [SUPABASE] auth.uid() reads these settings.
CREATE FUNCTION pg_temp.um_as(p_user_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user_id::TEXT, ''), true);
    PERFORM set_config('request.jwt.claims',
        CASE WHEN p_user_id IS NULL THEN '' ELSE json_build_object('sub', p_user_id, 'role', 'authenticated')::TEXT END,
        true);
END;
$$;

-- Runs a statement that must fail with the given error code (MESSAGE of our
-- convention, or a SQLSTATE such as 23514). Returns the HINT (suggestion JSON) or ''.
CREATE FUNCTION pg_temp.um_expect(p_sql TEXT, p_code TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_msg TEXT;
    v_state TEXT;
    v_hint TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
        IF v_msg = p_code OR v_state = p_code THEN
            RETURN COALESCE(v_hint, '');
        END IF;
        RAISE EXCEPTION 'Expected error "%", got "%" (SQLSTATE %)', p_code, v_msg, v_state;
    END;
    RAISE EXCEPTION 'Expected error "%", but the statement succeeded: %', p_code, p_sql;
END;
$$;

DO $$
DECLARE
    v_pass INTEGER := 0;
    v_admin UUID := gen_random_uuid();
    v_admin2 UUID := gen_random_uuid();
    v_support UUID := gen_random_uuid();
    v_disabled UUID := gen_random_uuid();
    v_mixed UUID := gen_random_uuid();
    v_new UUID := gen_random_uuid();
    v_res JSONB;
    v_hint TEXT;
    v_inv UUID;
    v_inv_expired UUID;
    v_reset1 UUID;
    v_reset2 UUID;
    v_text TEXT;
    v_role public.app_role;
    v_soon TIMESTAMPTZ := NOW() + INTERVAL '1 day';
    v_claim UUID;
    v_claim2 UUID;
    v_claim3 UUID;
    v_ins UUID := gen_random_uuid();
    v_lease UUID := gen_random_uuid();
    v_key TEXT;
    v_row RECORD;
    i INTEGER;
BEGIN
    RAISE NOTICE '=== STARTING USER MANAGEMENT ISOLATED TEST SUITE ===';

    -- --------------------------------------------------------------------------
    -- PREPARATION: test accounts ([SUPABASE] auth.users rows are needed for profiles FK)
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(NULL);
    INSERT INTO auth.users (id, email, aud, role) VALUES -- [SUPABASE]
        (v_admin, 'test-um-admin@example.test', 'authenticated', 'authenticated'),
        (v_admin2, 'test-um-admin2@example.test', 'authenticated', 'authenticated'),
        (v_support, 'test-um-support@example.test', 'authenticated', 'authenticated'),
        (v_disabled, 'test-um-disabled@example.test', 'authenticated', 'authenticated'),
        (v_mixed, 'TEST-Mixed@Example.test', 'authenticated', 'authenticated'),
        (v_new, 'test-um-new@example.test', 'authenticated', 'authenticated');

    INSERT INTO public.profiles (id, email, full_name, role, status) VALUES
        (v_admin, 'test-um-admin@example.test', 'TEST - Admin', 'Admin', 'Active'),
        (v_admin2, 'test-um-admin2@example.test', 'TEST - Admin Two', 'Admin', 'Active'),
        (v_support, 'test-um-support@example.test', 'TEST - Support', 'Support', 'Active'),
        (v_disabled, 'test-um-disabled@example.test', 'TEST - Disabled', 'Viewer', 'Disabled'),
        (v_mixed, 'TEST-Mixed@Example.test', 'TEST - Mixed Case', 'Viewer', 'Active');

    -- --------------------------------------------------------------------------
    -- TEST 1: profiles.status values and default
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_expect(format('UPDATE public.profiles SET status = %L WHERE id = %L', 'Paused', v_support), '23514');
    IF EXISTS (SELECT 1 FROM public.profiles WHERE status IS NULL OR status NOT IN ('Active', 'Disabled')) THEN
        RAISE EXCEPTION 'TEST 1 FAILED: profile with an invalid status found';
    END IF;
    IF (SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'status') NOT LIKE '%Active%' THEN
        RAISE EXCEPTION 'TEST 1 FAILED: profiles.status default is not Active';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 1 Passed: profiles.status only allows Active / Disabled and defaults to Active.';

    -- --------------------------------------------------------------------------
    -- TEST 2: only an active Admin may call admin functions
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(NULL);
    PERFORM pg_temp.um_expect('SELECT public.fn_admin_list_users()', 'unauthenticated');
    PERFORM pg_temp.um_as(v_support);
    PERFORM pg_temp.um_expect('SELECT public.fn_admin_list_users()', 'forbidden');
    PERFORM pg_temp.um_as(v_disabled);
    PERFORM pg_temp.um_expect('SELECT public.fn_admin_list_users()', 'forbidden');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 2 Passed: no JWT -> unauthenticated; non-Admin / disabled user -> forbidden.';

    -- --------------------------------------------------------------------------
    -- TEST 3: create invitation (normalized email, Pending, listed without hash)
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_create_invitation('  Test-UM-New@Example.TEST ', '  TEST - New Person ', 'Viewer', v_soon, pg_temp.um_hash('new-1'));
    v_inv := (v_res->>'invitation_id')::UUID;
    IF v_res->>'email' <> 'test-um-new@example.test'
       OR (SELECT status FROM public.user_invitations WHERE id = v_inv) <> 'Pending'
       OR (SELECT full_name FROM public.user_invitations WHERE id = v_inv) <> 'TEST - New Person' THEN
        RAISE EXCEPTION 'TEST 3 FAILED: invitation not created as expected: %', v_res;
    END IF;
    v_res := public.fn_admin_list_users();
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'invitations') e WHERE e->>'id' = v_inv::TEXT AND e->>'status' = 'Pending')
       OR v_res::TEXT LIKE '%token_hash%'
       OR v_res::TEXT LIKE '%' || pg_temp.um_hash('new-1') || '%' THEN
        RAISE EXCEPTION 'TEST 3 FAILED: list output wrong or contains a token hash';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 3 Passed: invitation created with normalized email; list shows it without token hash.';

    -- --------------------------------------------------------------------------
    -- TEST 4: conflicts (email_in_use / invitation_exists with suggestions)
    -- --------------------------------------------------------------------------
    v_hint := pg_temp.um_expect(format('SELECT public.fn_admin_create_invitation(%L, %L, %L, %L, %L)',
        'test-um-support@example.test', 'TEST - X', 'Viewer', v_soon, pg_temp.um_hash('c-1')), 'email_in_use');
    IF v_hint::JSONB->>'action' <> 'create_password_link' OR v_hint::JSONB->>'userId' <> v_support::TEXT THEN
        RAISE EXCEPTION 'TEST 4 FAILED: wrong suggestion for an Active user: %', v_hint;
    END IF;
    v_hint := pg_temp.um_expect(format('SELECT public.fn_admin_create_invitation(%L, %L, %L, %L, %L)',
        'test-um-disabled@example.test', 'TEST - X', 'Viewer', v_soon, pg_temp.um_hash('c-2')), 'email_in_use');
    IF v_hint::JSONB->>'action' <> 'enable_user' THEN
        RAISE EXCEPTION 'TEST 4 FAILED: wrong suggestion for a Disabled user: %', v_hint;
    END IF;
    v_hint := pg_temp.um_expect(format('SELECT public.fn_admin_create_invitation(%L, %L, %L, %L, %L)',
        'test-um-new@example.test', 'TEST - X', 'Viewer', v_soon, pg_temp.um_hash('c-3')), 'invitation_exists');
    IF v_hint::JSONB->>'action' <> 'resend_invitation' OR v_hint::JSONB->>'invitationId' <> v_inv::TEXT THEN
        RAISE EXCEPTION 'TEST 4 FAILED: wrong suggestion for an open invitation: %', v_hint;
    END IF;
    -- Existing profile with a mixed-case email (not normalized) must still be found.
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_create_invitation(%L, %L, %L, %L, %L)',
        'test-mixed@example.test', 'TEST - X', 'Viewer', v_soon, pg_temp.um_hash('c-4')), 'email_in_use');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 4 Passed: email_in_use (Active -> password link, Disabled -> enable, mixed case) and invitation_exists -> resend.';

    -- --------------------------------------------------------------------------
    -- TEST 5: expiry window (future, max 7 days) in function and CHECK
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_create_invitation(%L, %L, %L, %L, %L)',
        'test-um-e1@example.test', 'TEST - E', 'Viewer', NOW() - INTERVAL '1 hour', pg_temp.um_hash('e-1')), 'invalid_input');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_create_invitation(%L, %L, %L, %L, %L)',
        'test-um-e2@example.test', 'TEST - E', 'Viewer', NOW() + INTERVAL '8 days', pg_temp.um_hash('e-2')), 'invalid_input');
    PERFORM pg_temp.um_expect(format(
        'INSERT INTO public.user_invitations (purpose, email, full_name, role, token_hash, expires_at) VALUES (%L, %L, %L, %L, %L, %L)',
        'invitation', 'test-um-e3@example.test', 'TEST - E', 'Viewer', pg_temp.um_hash('e-3'), NOW() + INTERVAL '8 days'), '23514');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 5 Passed: past and > 7 day expiry rejected by the function and by the CHECK.';

    -- --------------------------------------------------------------------------
    -- TEST 6: token hash format and uniqueness
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_create_invitation(%L, %L, %L, %L, %L)',
        'test-um-h1@example.test', 'TEST - H', 'Viewer', v_soon, upper(pg_temp.um_hash('h-1'))), 'invalid_input');
    PERFORM pg_temp.um_expect(format(
        'INSERT INTO public.user_invitations (purpose, email, full_name, role, token_hash, expires_at) VALUES (%L, %L, %L, %L, %L, %L)',
        'invitation', 'test-um-h2@example.test', 'TEST - H', 'Viewer', 'plain-token-value', v_soon), '23514');
    PERFORM pg_temp.um_expect(format(
        'INSERT INTO public.user_invitations (purpose, email, full_name, role, token_hash, expires_at) VALUES (%L, %L, %L, %L, %L, %L)',
        'invitation', 'test-um-h3@example.test', 'TEST - H', 'Viewer', pg_temp.um_hash('new-1'), v_soon), '23505');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 6 Passed: only lower-case hex SHA-256 accepted; duplicate hash rejected.';

    -- --------------------------------------------------------------------------
    -- TEST 7: link lookup (contract fields only; dead links -> token_*)
    -- --------------------------------------------------------------------------
    v_res := public.fn_get_activation_link(pg_temp.um_hash('new-1'));
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_res) k)
        <> ARRAY['email', 'expires_at', 'full_name', 'purpose', 'role', 'status']
       OR v_res->>'status' <> 'Pending' THEN
        RAISE EXCEPTION 'TEST 7 FAILED: lookup returned unexpected fields: %', v_res;
    END IF;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_get_activation_link(%L)', pg_temp.um_hash('unknown')), 'token_invalid');
    PERFORM pg_temp.um_expect('SELECT public.fn_get_activation_link(''not-a-hash'')', 'token_invalid');

    -- Expired (stored Pending, past expires_at) invitation, inserted directly.
    INSERT INTO public.user_invitations (purpose, email, full_name, role, token_hash, expires_at, issued_at, created_at, invited_by)
    VALUES ('invitation', 'test-um-expired@example.test', 'TEST - Expired', 'Viewer', pg_temp.um_hash('exp-1'),
            NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', v_admin)
    RETURNING id INTO v_inv_expired;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_get_activation_link(%L)', pg_temp.um_hash('exp-1')), 'token_expired');
    v_res := public.fn_admin_list_users();
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'invitations') e WHERE e->>'id' = v_inv_expired::TEXT AND e->>'status' = 'Expired') THEN
        RAISE EXCEPTION 'TEST 7 FAILED: expired invitation not listed as Expired';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 7 Passed: lookup returns only contract fields; unknown -> token_invalid; expired -> token_expired.';

    -- --------------------------------------------------------------------------
    -- TEST 8: resend (same id, new hash, old link dead; expired can be resent)
    -- --------------------------------------------------------------------------
    v_res := public.fn_admin_resend_invitation(v_inv_expired, v_soon, pg_temp.um_hash('exp-2'));
    IF (v_res->>'invitation_id')::UUID <> v_inv_expired THEN
        RAISE EXCEPTION 'TEST 8 FAILED: resend changed the invitation id';
    END IF;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_get_activation_link(%L)', pg_temp.um_hash('exp-1')), 'token_invalid');
    PERFORM public.fn_get_activation_link(pg_temp.um_hash('exp-2'));
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 8 Passed: resend keeps the id, old link is dead, expired invitation can be resent.';

    -- --------------------------------------------------------------------------
    -- TEST 9: revoke (Pending only, final)
    -- --------------------------------------------------------------------------
    PERFORM public.fn_admin_revoke_invitation(v_inv_expired);
    PERFORM pg_temp.um_expect(format('SELECT public.fn_get_activation_link(%L)', pg_temp.um_hash('exp-2')), 'token_revoked');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_revoke_invitation(%L)', v_inv_expired), 'invalid_status');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_resend_invitation(%L, %L, %L)', v_inv_expired, v_soon, pg_temp.um_hash('exp-3')), 'invalid_status');
    PERFORM pg_temp.um_as(NULL);
    PERFORM pg_temp.um_expect(format('UPDATE public.user_invitations SET status = %L, revoked_at = NULL WHERE id = %L', 'Pending', v_inv_expired), 'invalid_status');
    -- Revoking an expired invitation is not allowed (only Pending Invite).
    INSERT INTO public.user_invitations (purpose, email, full_name, role, token_hash, expires_at, issued_at, created_at)
    VALUES ('invitation', 'test-um-expired2@example.test', 'TEST - Expired 2', 'Viewer', pg_temp.um_hash('exp-4'),
            NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
    RETURNING id INTO v_inv_expired;
    PERFORM pg_temp.um_as(v_admin);
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_revoke_invitation(%L)', v_inv_expired), 'invalid_status');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 9 Passed: revoke works once, Revoked is final, expired cannot be revoked.';

    -- --------------------------------------------------------------------------
    -- TEST 10: accept invitation (claim, then accept with the claim id; profile
    -- created in the same transaction; single use)
    -- --------------------------------------------------------------------------
    v_res := public.fn_claim_activation_link(pg_temp.um_hash('new-1'));
    v_claim := (v_res->>'claim_id')::UUID;
    IF v_claim IS NULL OR v_res->>'purpose' <> 'invitation' OR v_res->>'email' <> 'test-um-new@example.test' THEN
        RAISE EXCEPTION 'TEST 10 FAILED: claim returned unexpected data: %', v_res;
    END IF;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_accept_invitation(%L, %L)', v_claim, v_support), 'invalid_input');
    v_res := public.fn_accept_invitation(v_claim, v_new);
    IF v_res->>'email' <> 'test-um-new@example.test'
       OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_new AND full_name = 'TEST - New Person' AND role = 'Viewer' AND status = 'Active')
       OR (SELECT status FROM public.user_invitations WHERE id = v_inv) <> 'Accepted'
       OR (SELECT claim_id FROM public.user_invitations WHERE id = v_inv) IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 10 FAILED: accept did not create the profile / mark the link: %', v_res;
    END IF;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_claim_activation_link(%L)', pg_temp.um_hash('new-1')), 'token_used');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_accept_invitation(%L, %L)', v_claim, v_new), 'link_busy');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_get_activation_link(%L)', pg_temp.um_hash('new-1')), 'token_used');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 10 Passed: claim + accept creates the Active profile and marks the link Accepted; second use -> token_used.';

    -- --------------------------------------------------------------------------
    -- TEST 11: self actions
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(v_admin);
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_disable_user(%L)', v_admin), 'self_action');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_change_user_role(%L, %L)', v_admin, 'Support'), 'self_action');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 11 Passed: an Admin cannot disable themselves or change their own role.';

    -- --------------------------------------------------------------------------
    -- TEST 12: last active Admin
    -- --------------------------------------------------------------------------
    -- Leave only the two test Admins active (rolled back at the end).
    PERFORM pg_temp.um_as(NULL);
    UPDATE public.profiles SET status = 'Disabled'
    WHERE role = 'Admin' AND status = 'Active' AND id NOT IN (v_admin, v_admin2);
    -- With two active Admins, demoting / disabling one is allowed.
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_change_user_role(v_admin2, 'Support');
    IF v_res->>'role' <> 'Support' THEN
        RAISE EXCEPTION 'TEST 12 FAILED: role change with two Admins failed: %', v_res;
    END IF;
    -- Now v_admin is the only active Admin. Any path that removes it must fail.
    -- (Through the functions this is already blocked by self_action, so the
    -- trigger is tested with direct owner updates.)
    PERFORM pg_temp.um_as(NULL);
    PERFORM pg_temp.um_expect(format('UPDATE public.profiles SET status = %L WHERE id = %L', 'Disabled', v_admin), 'last_admin');
    PERFORM pg_temp.um_expect(format('UPDATE public.profiles SET role = %L WHERE id = %L', 'Viewer', v_admin), 'last_admin');
    -- Restore v_admin2 as Admin for the next tests.
    PERFORM pg_temp.um_as(v_admin);
    PERFORM public.fn_admin_change_user_role(v_admin2, 'Admin');
    PERFORM public.fn_admin_disable_user(v_admin2);
    PERFORM public.fn_admin_enable_user(v_admin2);
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 12 Passed: last active Admin cannot be disabled or demoted; with two Admins it is allowed.';

    -- --------------------------------------------------------------------------
    -- TEST 13: direct API updates of role / status are blocked ([SUPABASE] SET ROLE authenticated)
    -- --------------------------------------------------------------------------
    -- While running as authenticated, errors are caught inline (no pg_temp helper calls).
    PERFORM pg_temp.um_as(v_support);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        UPDATE public.profiles SET status = 'Disabled' WHERE id = v_support;
        v_text := 'no error';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    END;
    UPDATE public.profiles SET full_name = 'TEST - Support Renamed' WHERE id = v_support;
    EXECUTE 'RESET ROLE';
    IF v_text <> 'forbidden' THEN
        RAISE EXCEPTION 'TEST 13 FAILED: own status update gave "%"', v_text;
    END IF;

    PERFORM pg_temp.um_as(v_admin);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        UPDATE public.profiles SET role = 'Admin' WHERE id = v_support;
        v_text := 'no error';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    IF v_text <> 'forbidden' THEN
        RAISE EXCEPTION 'TEST 13 FAILED: Admin direct role update gave "%"', v_text;
    END IF;

    IF (SELECT full_name FROM public.profiles WHERE id = v_support) <> 'TEST - Support Renamed'
       OR (SELECT role FROM public.profiles WHERE id = v_support) <> 'Support' THEN
        RAISE EXCEPTION 'TEST 13 FAILED: name update blocked or role changed';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 13 Passed: direct role/status updates are forbidden; own name update still works.';

    -- --------------------------------------------------------------------------
    -- TEST 14: disable / enable; disabled user has no role
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_create_password_reset_link(v_support, v_soon, pg_temp.um_hash('r-0'));
    v_res := public.fn_admin_disable_user(v_support);
    IF v_res->>'status' <> 'Disabled'
       OR EXISTS (SELECT 1 FROM public.user_invitations WHERE user_id = v_support AND status = 'Pending') THEN
        RAISE EXCEPTION 'TEST 14 FAILED: disable did not revoke open reset links: %', v_res;
    END IF;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_disable_user(%L)', v_support), 'invalid_status');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_change_user_role(%L, %L)', v_support, 'Viewer'), 'invalid_status');
    PERFORM pg_temp.um_as(v_support);
    IF public.fn_user_role() IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 14 FAILED: disabled user still has a role';
    END IF;
    SELECT actor_role INTO v_role FROM public.fn_get_current_actor();
    IF v_role <> 'Viewer' THEN
        RAISE EXCEPTION 'TEST 14 FAILED: disabled user resolves to %', v_role;
    END IF;
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_enable_user(v_support);
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_enable_user(%L)', v_support), 'invalid_status');
    PERFORM pg_temp.um_as(v_support);
    IF public.fn_user_role() IS DISTINCT FROM 'Support' THEN
        RAISE EXCEPTION 'TEST 14 FAILED: enabled user did not get the role back';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 14 Passed: disable revokes reset links and removes the role; enable restores it.';

    -- --------------------------------------------------------------------------
    -- TEST 15: password reset link
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_create_password_reset_link(v_support, v_soon, pg_temp.um_hash('r-1'));
    v_reset1 := (v_res->>'invitation_id')::UUID;
    v_res := public.fn_admin_create_password_reset_link(v_support, v_soon, pg_temp.um_hash('r-2'));
    v_reset2 := (v_res->>'invitation_id')::UUID;
    IF (SELECT status FROM public.user_invitations WHERE id = v_reset1) <> 'Revoked'
       OR (SELECT status FROM public.user_invitations WHERE id = v_reset2) <> 'Pending' THEN
        RAISE EXCEPTION 'TEST 15 FAILED: new reset link did not revoke the older one';
    END IF;
    v_res := public.fn_claim_activation_link(pg_temp.um_hash('r-2'));
    v_claim := (v_res->>'claim_id')::UUID;
    IF (v_res->>'user_id')::UUID <> v_support OR v_res->>'purpose' <> 'password_reset' THEN
        RAISE EXCEPTION 'TEST 15 FAILED: claim password reset wrong: %', v_res;
    END IF;
    v_res := public.fn_accept_password_reset(v_claim);
    IF v_res->>'purpose' <> 'password_reset' OR v_res ? 'user_id'
       OR (SELECT status FROM public.user_invitations WHERE id = v_reset2) <> 'Accepted' THEN
        RAISE EXCEPTION 'TEST 15 FAILED: accept password reset wrong: %', v_res;
    END IF;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_claim_activation_link(%L)', pg_temp.um_hash('r-2')), 'token_used');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_claim_activation_link(%L)', pg_temp.um_hash('r-1')), 'token_revoked');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_admin_create_password_reset_link(%L, %L, %L)', v_disabled, v_soon, pg_temp.um_hash('r-3')), 'invalid_status');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 15 Passed: new reset link revokes older ones; single use; not for disabled users.';

    -- --------------------------------------------------------------------------
    -- TEST 16: no hard delete
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(NULL);
    PERFORM pg_temp.um_expect(format('DELETE FROM public.user_invitations WHERE id = %L', v_reset1), 'forbidden');
    IF has_table_privilege('authenticated', 'public.profiles', 'DELETE') -- [SUPABASE] role
       OR has_table_privilege('authenticated', 'public.user_invitations', 'DELETE')
       OR has_table_privilege('service_role', 'public.user_invitations', 'DELETE')
       OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_delete_admin_only') THEN
        RAISE EXCEPTION 'TEST 16 FAILED: a delete path still exists';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 16 Passed: links cannot be deleted; API roles have no DELETE; delete policy removed.';

    -- --------------------------------------------------------------------------
    -- TEST 17: audit written, never with a token hash
    -- --------------------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'invitation' AND entity_id = v_inv::TEXT AND action = 'INVITE')
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'invitation' AND entity_id = v_inv::TEXT AND action = 'ACCEPT')
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'invitation' AND action = 'RESEND' AND actor_id = v_admin)
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'invitation' AND action = 'REVOKE' AND actor_id = v_admin)
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'user' AND entity_id = v_admin2::TEXT AND action = 'ROLE_CHANGE')
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'user' AND entity_id = v_support::TEXT AND action = 'DISABLE')
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'user' AND entity_id = v_support::TEXT AND action = 'ENABLE')
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'invitation' AND entity_id = v_reset2::TEXT AND action = 'PASSWORD_LINK')
       OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_type = 'invitation' AND entity_id = v_reset2::TEXT AND action = 'PASSWORD_RESET') THEN
        RAISE EXCEPTION 'TEST 17 FAILED: an expected audit row is missing';
    END IF;
    FOREACH v_text IN ARRAY ARRAY['new-1', 'exp-1', 'exp-2', 'r-0', 'r-1', 'r-2'] LOOP
        IF EXISTS (SELECT 1 FROM public.audit_logs WHERE changes::TEXT LIKE '%' || pg_temp.um_hash(v_text) || '%') THEN
            RAISE EXCEPTION 'TEST 17 FAILED: a token hash was written to audit_logs';
        END IF;
    END LOOP;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 17 Passed: admin actions are audited; no token hash in audit_logs.';

    -- --------------------------------------------------------------------------
    -- TEST 18: no direct profile insert ([SUPABASE] SET ROLE authenticated);
    -- activation still creates the profile
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(NULL);
    INSERT INTO auth.users (id, email, aud, role) VALUES -- [SUPABASE]
        (v_ins, 'test-um-insert@example.test', 'authenticated', 'authenticated'),
        (v_lease, 'test-um-lease@example.test', 'authenticated', 'authenticated');
    PERFORM pg_temp.um_as(v_admin);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        INSERT INTO public.profiles (id, email, full_name, role, status)
        VALUES (v_ins, 'test-um-insert@example.test', 'TEST - Direct Insert', 'Admin', 'Active');
        v_text := 'no error';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_text = RETURNED_SQLSTATE;
    END;
    EXECUTE 'RESET ROLE';
    IF v_text <> '42501' THEN
        RAISE EXCEPTION 'TEST 18 FAILED: direct profile insert by an Admin gave "%"', v_text;
    END IF;
    IF has_table_privilege('authenticated', 'public.profiles', 'INSERT') -- [SUPABASE] roles
       OR has_table_privilege('anon', 'public.profiles', 'INSERT')
       OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_insert_admin_only') THEN
        RAISE EXCEPTION 'TEST 18 FAILED: a direct profile insert path still exists';
    END IF;
    v_res := public.fn_admin_create_invitation('test-um-insert@example.test', 'TEST - Invited Insert', 'Viewer', v_soon, pg_temp.um_hash('ins-1'));
    v_claim := (public.fn_claim_activation_link(pg_temp.um_hash('ins-1'))->>'claim_id')::UUID;
    PERFORM public.fn_accept_invitation(v_claim, v_ins);
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_ins AND role = 'Viewer' AND status = 'Active') THEN
        RAISE EXCEPTION 'TEST 18 FAILED: activation did not create the profile';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 18 Passed: an Admin cannot insert a profile directly; the invitation flow still creates it.';

    -- --------------------------------------------------------------------------
    -- TEST 19: invitation lease (one holder, release, expiry, revoke / resend end it)
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_create_invitation('test-um-lease@example.test', 'TEST - Lease', 'Support', v_soon, pg_temp.um_hash('lease-1'));
    v_inv := (v_res->>'invitation_id')::UUID;
    v_claim := (public.fn_claim_activation_link(pg_temp.um_hash('lease-1'))->>'claim_id')::UUID;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_claim_activation_link(%L)', pg_temp.um_hash('lease-1')), 'link_busy');
    IF public.fn_get_activation_link(pg_temp.um_hash('lease-1'))->>'status' <> 'Pending' THEN
        RAISE EXCEPTION 'TEST 19 FAILED: a leased link is not shown as Pending';
    END IF;
    -- Release (e.g. the auth service rejected the password): the link stays Pending.
    IF NOT public.fn_release_activation_link(v_claim) OR public.fn_release_activation_link(v_claim) THEN
        RAISE EXCEPTION 'TEST 19 FAILED: release is not true once, then false';
    END IF;
    IF (SELECT status FROM public.user_invitations WHERE id = v_inv) <> 'Pending'
       OR (SELECT claim_id FROM public.user_invitations WHERE id = v_inv) IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 19 FAILED: release did not keep the link Pending without a lease';
    END IF;
    v_claim2 := (public.fn_claim_activation_link(pg_temp.um_hash('lease-1'))->>'claim_id')::UUID;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_accept_invitation(%L, %L)', v_claim, v_lease), 'link_busy');
    -- An expired lease can be claimed again; the old claim can no longer accept.
    PERFORM pg_temp.um_as(NULL);
    UPDATE public.user_invitations SET claimed_until = NOW() - INTERVAL '1 second' WHERE id = v_inv;
    v_claim3 := (public.fn_claim_activation_link(pg_temp.um_hash('lease-1'))->>'claim_id')::UUID;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_accept_invitation(%L, %L)', v_claim2, v_lease), 'link_busy');
    PERFORM public.fn_accept_invitation(v_claim3, v_lease);
    IF (SELECT status FROM public.user_invitations WHERE id = v_inv) <> 'Accepted'
       OR (SELECT claim_id FROM public.user_invitations WHERE id = v_inv) IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 19 FAILED: accept with the current claim did not finish the link';
    END IF;
    -- A lease on a direct (owner) update of an Accepted link is impossible.
    PERFORM pg_temp.um_expect(format('UPDATE public.user_invitations SET claim_id = %L, claimed_until = NOW() WHERE id = %L',
        gen_random_uuid(), v_inv), 'invalid_status');
    -- Revoke and resend end an active lease.
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_create_invitation('test-um-lease2@example.test', 'TEST - Lease 2', 'Viewer', v_soon, pg_temp.um_hash('lease-2'));
    v_inv := (v_res->>'invitation_id')::UUID;
    v_claim := (public.fn_claim_activation_link(pg_temp.um_hash('lease-2'))->>'claim_id')::UUID;
    PERFORM public.fn_admin_resend_invitation(v_inv, v_soon, pg_temp.um_hash('lease-3'));
    IF (SELECT claim_id FROM public.user_invitations WHERE id = v_inv) IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 19 FAILED: resend did not end the lease';
    END IF;
    v_claim := (public.fn_claim_activation_link(pg_temp.um_hash('lease-3'))->>'claim_id')::UUID;
    PERFORM public.fn_admin_revoke_invitation(v_inv);
    PERFORM pg_temp.um_expect(format('SELECT public.fn_accept_invitation(%L, %L)', v_claim, v_lease), 'link_busy');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 19 Passed: one lease holder; release keeps the link; expired lease re-claimable; revoke / resend end the lease.';

    -- --------------------------------------------------------------------------
    -- TEST 20: password reset lease (release, newer link, disable during the lease)
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(v_admin);
    v_res := public.fn_admin_create_password_reset_link(v_mixed, v_soon, pg_temp.um_hash('rl-1'));
    v_reset1 := (v_res->>'invitation_id')::UUID;
    v_claim := (public.fn_claim_activation_link(pg_temp.um_hash('rl-1'))->>'claim_id')::UUID;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_claim_activation_link(%L)', pg_temp.um_hash('rl-1')), 'link_busy');
    PERFORM public.fn_release_activation_link(v_claim);
    IF (SELECT status FROM public.user_invitations WHERE id = v_reset1) <> 'Pending' THEN
        RAISE EXCEPTION 'TEST 20 FAILED: released reset link is not Pending';
    END IF;
    v_claim2 := (public.fn_claim_activation_link(pg_temp.um_hash('rl-1'))->>'claim_id')::UUID;
    -- A newer reset link revokes the leased older one.
    PERFORM public.fn_admin_create_password_reset_link(v_mixed, v_soon, pg_temp.um_hash('rl-2'));
    IF (SELECT status FROM public.user_invitations WHERE id = v_reset1) <> 'Revoked'
       OR (SELECT claim_id FROM public.user_invitations WHERE id = v_reset1) IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 20 FAILED: newer reset link did not revoke the leased one';
    END IF;
    PERFORM pg_temp.um_expect(format('SELECT public.fn_accept_password_reset(%L)', v_claim2), 'link_busy');
    -- Disabling the user during the lease ends it.
    v_claim := (public.fn_claim_activation_link(pg_temp.um_hash('rl-2'))->>'claim_id')::UUID;
    PERFORM public.fn_admin_disable_user(v_mixed);
    PERFORM pg_temp.um_expect(format('SELECT public.fn_accept_password_reset(%L)', v_claim), 'link_busy');
    PERFORM pg_temp.um_expect(format('SELECT public.fn_claim_activation_link(%L)', pg_temp.um_hash('rl-2')), 'token_revoked');
    PERFORM public.fn_admin_enable_user(v_mixed);
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 20 Passed: reset lease is released cleanly; a newer link or disabling the user ends it.';

    -- --------------------------------------------------------------------------
    -- TEST 21: rate limit counter (limit, window, input checks, cleanup, privileges)
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(NULL);
    v_key := pg_temp.um_hash('rate-key-1');
    FOR i IN 1..3 LOOP
        SELECT * INTO v_row FROM public.fn_rate_limit_hit(v_key, 3, 600);
        IF NOT v_row.allowed THEN
            RAISE EXCEPTION 'TEST 21 FAILED: hit % of 3 was not allowed', i;
        END IF;
    END LOOP;
    SELECT * INTO v_row FROM public.fn_rate_limit_hit(v_key, 3, 600);
    IF v_row.allowed OR v_row.retry_after_seconds < 1 OR v_row.retry_after_seconds > 600 THEN
        RAISE EXCEPTION 'TEST 21 FAILED: hit 4 of 3 allowed or wrong retry_after: %', v_row;
    END IF;
    UPDATE public.auth_link_rate_limits SET window_started_at = NOW() - INTERVAL '601 seconds' WHERE key_hash = v_key;
    SELECT * INTO v_row FROM public.fn_rate_limit_hit(v_key, 3, 600);
    IF NOT v_row.allowed OR (SELECT hits FROM public.auth_link_rate_limits WHERE key_hash = v_key) <> 1 THEN
        RAISE EXCEPTION 'TEST 21 FAILED: a new window did not reset the counter';
    END IF;
    PERFORM pg_temp.um_expect('SELECT * FROM public.fn_rate_limit_hit(''not-a-hash'', 3, 600)', 'invalid_input');
    PERFORM pg_temp.um_expect(format('SELECT * FROM public.fn_rate_limit_hit(%L, 0, 600)', v_key), 'invalid_input');
    PERFORM pg_temp.um_expect(format('SELECT * FROM public.fn_rate_limit_hit(%L, 3, 0)', v_key), 'invalid_input');
    PERFORM pg_temp.um_expect(format('INSERT INTO public.auth_link_rate_limits (key_hash, window_started_at, hits) VALUES (%L, NOW(), 1)',
        '203.0.113.7'), '23514');
    INSERT INTO public.auth_link_rate_limits (key_hash, window_started_at, hits)
    VALUES (pg_temp.um_hash('rate-old'), NOW() - INTERVAL '2 days', 5);
    PERFORM * FROM public.fn_rate_limit_hit(pg_temp.um_hash('rate-key-2'), 3, 600);
    IF EXISTS (SELECT 1 FROM public.auth_link_rate_limits WHERE key_hash = pg_temp.um_hash('rate-old')) THEN
        RAISE EXCEPTION 'TEST 21 FAILED: a counter row older than 1 day was not cleaned up';
    END IF;
    IF has_table_privilege('anon', 'public.auth_link_rate_limits', 'SELECT') -- [SUPABASE] roles
       OR has_table_privilege('authenticated', 'public.auth_link_rate_limits', 'SELECT')
       OR has_table_privilege('service_role', 'public.auth_link_rate_limits', 'SELECT')
       OR has_function_privilege('anon', 'public.fn_rate_limit_hit(text, integer, integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_rate_limit_hit(text, integer, integer)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.fn_rate_limit_hit(text, integer, integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_claim_activation_link(text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_release_activation_link(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.fn_claim_activation_link(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'TEST 21 FAILED: wrong privileges on the rate limit / lease objects';
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 21 Passed: rate limit counts per window, rejects bad input, cleans old rows; server only.';

    -- --------------------------------------------------------------------------
    -- TEST 22: caller check for the admin-users Edge Function
    -- --------------------------------------------------------------------------
    PERFORM pg_temp.um_as(v_admin);
    IF (public.fn_admin_current_caller()->>'user_id')::UUID <> v_admin THEN
        RAISE EXCEPTION 'TEST 22 FAILED: active Admin not returned';
    END IF;
    PERFORM pg_temp.um_as(v_support);
    PERFORM pg_temp.um_expect('SELECT public.fn_admin_current_caller()', 'forbidden');
    PERFORM pg_temp.um_as(NULL);
    PERFORM pg_temp.um_expect('SELECT public.fn_admin_current_caller()', 'unauthenticated');
    v_pass := v_pass + 1;
    RAISE NOTICE 'Test 22 Passed: fn_admin_current_caller returns an active Admin; others forbidden / unauthenticated.';

    RAISE NOTICE '=== ALL 22 USER MANAGEMENT TESTS PASSED (%/22) ===', v_pass;
END $$;

-- Complete automatic rollback: leaves zero test artifacts in database
ROLLBACK;
