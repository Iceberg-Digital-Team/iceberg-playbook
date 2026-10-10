-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 12: User Management Security (RLS, privileges, triggers, functions)
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================
-- Contract: docs/USER_MANAGEMENT_API.md (sections 5, 6, 7, 8, 9, 10, 11).
-- Requires: 10_restore_playbook.sql (team lead), 11_user_management.sql.
--
-- The database is the authority for every User Management rule. The frontend
-- rules (src/services/adminUserRules.ts) are only UX mirrors.
--
-- ERROR CONVENTION (mapped 1:1 by the server to AdminUserErrorCode):
--   RAISE EXCEPTION USING ERRCODE = 'P0001',
--       MESSAGE = '<code>',            -- exactly one AdminUserErrorCode
--       DETAIL  = '<English text>',    -- shown to the user
--       HINT    = '<suggestion JSON>'; -- optional, e.g. {"action":"resend_invitation","invitationId":"..."}
--   Codes used here: unauthenticated, forbidden, not_found, invalid_input,
--   invalid_status, email_in_use, invitation_exists, last_admin, self_action,
--   token_invalid, token_expired, token_used, token_revoked, link_busy.
--   Any other SQLSTATE is an unexpected error (server maps it to 'unknown').
--   DETAIL / HINT / audit rows never contain a token, a token hash or a password.
--
-- CALLERS:
--   fn_admin_*            : the signed-in Admin's own JWT (role authenticated).
--                           Each function checks auth.uid() is an active Admin.
--   fn_get_activation_link,
--   fn_claim_activation_link,
--   fn_release_activation_link,
--   fn_accept_*,
--   fn_rate_limit_hit     : server only (service_role), on behalf of the
--                           anonymous link holder.
--
-- ACTIVATION LEASE (a rejected password never uses up a link):
--   claim (60 s lease, only if Pending, usable and not leased) -> the server sets
--   the password in the auth service -> accept with the same claim id.
--   If the password is rejected or anything fails, the server releases the lease
--   and the link stays Pending. A second request during the lease gets link_busy
--   and never touches a password.
--
-- CHANGES EXISTING BEHAVIOR (needs team lead OK):
--   a) Policy profiles_delete_admin_only (04) is dropped and DELETE on profiles
--      is revoked from API roles: no hard delete of users through the API.
--   b) fn_user_role() (04) gives no role to a Disabled user, so fn_is_admin()
--      and fn_is_support_or_admin() deny a disabled user with a live session.
--   c) fn_get_current_actor() (03) resolves a Disabled user to Viewer.
--   d) Trigger on profiles: role/status can no longer be changed by a direct
--      API update; only by the functions below (or a trusted server role).
--      Name / avatar updates are unchanged.
--   e) user_invitations foreign keys use ON DELETE RESTRICT: deleting a user who
--      invited someone or has a reset link fails (history is kept).
--   f) Policy profiles_insert_admin_only (04) is dropped and INSERT on profiles
--      is revoked from API roles: profiles are created only by
--      fn_accept_invitation (invitation flow), never by a direct API insert.
--
-- Supabase-specific parts are marked [SUPABASE]: auth.uid(), auth.users and the
-- roles anon / authenticated / service_role.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. NO HARD DELETE AND NO DIRECT CREATE OF USERS THROUGH THE API  (changes a, f)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_delete_admin_only" ON public.profiles;
REVOKE DELETE ON TABLE public.profiles FROM anon, authenticated; -- [SUPABASE] roles

-- Rule: profiles are created only through the invitation flow (fn_accept_invitation,
-- SECURITY DEFINER), so a direct insert cannot skip its checks and audit.
DROP POLICY IF EXISTS "profiles_insert_admin_only" ON public.profiles;
REVOKE INSERT ON TABLE public.profiles FROM anon, authenticated; -- [SUPABASE] roles

-- ------------------------------------------------------------------------------
-- 2. DISABLED USERS GET NO ROLE  (changes b and c)
-- ------------------------------------------------------------------------------
-- Rule: a Disabled user has no rights, even with a session that has not expired yet.
-- Same signature as migration 04, so every RLS policy that uses fn_is_admin() /
-- fn_is_support_or_admin() follows automatically.
CREATE OR REPLACE FUNCTION public.fn_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.profiles
    WHERE id = (SELECT auth.uid()) -- [SUPABASE] auth.uid()
      AND status = 'Active';
$$;
COMMENT ON FUNCTION public.fn_user_role() IS
    'Role of the calling user, or NULL when the user has no profile or is Disabled. Base of all RLS role checks. Changed in migration 12 to respect profiles.status.';
REVOKE EXECUTE ON FUNCTION public.fn_user_role() FROM PUBLIC, anon; -- [SUPABASE] role anon
GRANT EXECUTE ON FUNCTION public.fn_user_role() TO authenticated, service_role; -- [SUPABASE] roles

-- Same as migration 03, except a Disabled profile resolves to Viewer, so the
-- content functions (fn_create_guide, fn_soft_delete_*, ...) reject it.
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
    v_uid := (SELECT auth.uid()); -- [SUPABASE] auth.uid()
    IF v_uid IS NOT NULL THEN
        SELECT p.id, p.full_name, p.role, p.status INTO v_profile FROM public.profiles p WHERE p.id = v_uid;
        IF FOUND THEN
            IF v_profile.status <> 'Active' THEN
                -- Disabled user: no write rights
                RETURN QUERY SELECT v_profile.id, v_profile.full_name, 'Viewer'::public.app_role;
                RETURN;
            END IF;
            RETURN QUERY SELECT v_profile.id, v_profile.full_name, v_profile.role;
            RETURN;
        END IF;
        -- Authenticated user with no profile record yet defaults to Viewer
        RETURN QUERY SELECT v_uid, 'Authenticated User'::TEXT, 'Viewer'::public.app_role;
        RETURN;
    END IF;

    -- Trusted database roles (e.g. background migrations, seed scripts, service role)
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN -- [SUPABASE] roles
        RETURN QUERY SELECT NULL::UUID, 'Support Team'::TEXT, 'Support'::public.app_role;
        RETURN;
    END IF;

    -- Unauthenticated callers are strictly Viewer
    RETURN QUERY SELECT NULL::UUID, 'Anonymous'::TEXT, 'Viewer'::public.app_role;
END;
$$;
COMMENT ON FUNCTION public.fn_get_current_actor() IS
    'Actor (id, name, role) for content functions and audit. Changed in migration 12: a Disabled user resolves to Viewer.';
REVOKE EXECUTE ON FUNCTION public.fn_get_current_actor() FROM PUBLIC, anon; -- [SUPABASE] role anon
GRANT EXECUTE ON FUNCTION public.fn_get_current_actor() TO authenticated, service_role; -- [SUPABASE] roles

-- ------------------------------------------------------------------------------
-- 3. user_invitations: RLS AND PRIVILEGES
-- ------------------------------------------------------------------------------
-- Rule: links (and their hashes) are never readable or writable directly by API
-- users. RLS is on and there are intentionally NO policies: all access goes
-- through the SECURITY DEFINER functions below.
ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

-- Supabase grants new tables to API roles by default, so revoke explicitly.
REVOKE ALL ON TABLE public.user_invitations FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
-- Server role: read / create / update only. Nobody gets DELETE (no hard delete).
REVOKE ALL ON TABLE public.user_invitations FROM service_role; -- [SUPABASE] role
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_invitations TO service_role; -- [SUPABASE] role

-- ------------------------------------------------------------------------------
-- 4. TRIGGERS
-- Trigger functions are SECURITY INVOKER on purpose: they must see the real
-- current_user (a direct API update runs as 'authenticated'; the SECURITY
-- DEFINER functions below run as the function owner).
-- ------------------------------------------------------------------------------

-- 4a. profiles: role / status guard  (change d)
-- Rules: role/status change only through the admin functions; an Admin cannot
-- disable themselves or change their own role; the last active Admin cannot be
-- disabled or demoted. Enforced for EVERY write path, race-safe.
CREATE OR REPLACE FUNCTION public.fn_trg_profiles_guard_role_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_other_admins INTEGER;
BEGIN
    IF NEW.role IS NOT DISTINCT FROM OLD.role AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW; -- name / avatar / department updates are not affected
    END IF;

    -- Direct API update (PostgREST runs as anon / authenticated) -> blocked.
    IF current_user IN ('anon', 'authenticated') THEN -- [SUPABASE] roles
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden',
            DETAIL = 'Role and status can only be changed through the user management functions.';
    END IF;

    -- Self action: holds for every caller that carries a user JWT.
    v_uid := (SELECT auth.uid()); -- [SUPABASE] auth.uid()
    IF v_uid IS NOT NULL AND v_uid = NEW.id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'self_action',
            DETAIL = 'You cannot disable your own account or change your own role.';
    END IF;

    -- Last active Admin. The advisory lock serializes concurrent demotions /
    -- disables, so two Admins cannot remove each other at the same time.
    IF OLD.role = 'Admin' AND OLD.status = 'Active'
       AND NOT (NEW.role = 'Admin' AND NEW.status = 'Active') THEN
        PERFORM pg_advisory_xact_lock(hashtext('iceberg.user_management.admins'));
        SELECT COUNT(*) INTO v_other_admins
        FROM public.profiles p
        WHERE p.role = 'Admin' AND p.status = 'Active' AND p.id <> NEW.id;
        IF v_other_admins = 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'last_admin',
                DETAIL = 'The last active Admin cannot be disabled or demoted.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.fn_trg_profiles_guard_role_status() IS
    'Trigger: role/status may change only through the user management functions (not by a direct API update); no self disable / self role change; the last active Admin cannot be disabled or demoted (race-safe with an advisory lock).';
REVOKE EXECUTE ON FUNCTION public.fn_trg_profiles_guard_role_status() FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles

DROP TRIGGER IF EXISTS trg_profiles_guard_role_status ON public.profiles;
CREATE TRIGGER trg_profiles_guard_role_status
    BEFORE UPDATE OF role, status ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_profiles_guard_role_status();
COMMENT ON TRIGGER trg_profiles_guard_role_status ON public.profiles IS
    'Protects the admin safety rules (self action, last active Admin) and blocks direct role/status changes on every write path.';

-- 4b. user_invitations: identity fields immutable, final states final
CREATE OR REPLACE FUNCTION public.fn_trg_user_invitations_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    -- Accepted and Revoked are final: a used or revoked link can never be reopened.
    IF OLD.status <> 'Pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status',
            DETAIL = 'This link is already used or revoked and cannot be changed.';
    END IF;

    -- Who / what a link is for never changes; resend only replaces token_hash,
    -- expires_at and issued_at (the lease columns change while the link is Pending).
    IF NEW.id <> OLD.id
       OR NEW.purpose <> OLD.purpose
       OR NEW.email <> OLD.email
       OR NEW.full_name <> OLD.full_name
       OR NEW.role <> OLD.role
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden',
            DETAIL = 'The target of a link cannot be changed. Revoke it and create a new one.';
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.fn_trg_user_invitations_guard() IS
    'Trigger: Accepted / Revoked links are final; the target fields of a link (purpose, email, name, role, user, inviter) never change; keeps updated_at current.';
REVOKE EXECUTE ON FUNCTION public.fn_trg_user_invitations_guard() FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles

DROP TRIGGER IF EXISTS trg_user_invitations_guard ON public.user_invitations;
CREATE TRIGGER trg_user_invitations_guard
    BEFORE UPDATE ON public.user_invitations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_user_invitations_guard();
COMMENT ON TRIGGER trg_user_invitations_guard ON public.user_invitations IS
    'Keeps links single-use and final, and their target immutable, on every write path.';

-- 4c. user_invitations: no hard delete
CREATE OR REPLACE FUNCTION public.fn_trg_user_invitations_no_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden',
        DETAIL = 'Links are never deleted. Revoke the link instead.';
END;
$$;
COMMENT ON FUNCTION public.fn_trg_user_invitations_no_delete() IS
    'Trigger: invitation and password link rows are history and are never deleted (any role).';
REVOKE EXECUTE ON FUNCTION public.fn_trg_user_invitations_no_delete() FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles

DROP TRIGGER IF EXISTS trg_user_invitations_no_delete ON public.user_invitations;
CREATE TRIGGER trg_user_invitations_no_delete
    BEFORE DELETE ON public.user_invitations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_user_invitations_no_delete();
COMMENT ON TRIGGER trg_user_invitations_no_delete ON public.user_invitations IS
    'No hard delete of links, for every role.';

-- ------------------------------------------------------------------------------
-- 5. INTERNAL HELPERS (not callable by API roles)
-- ------------------------------------------------------------------------------

-- Rule: every admin operation checks on the server that the caller is an active Admin.
CREATE OR REPLACE FUNCTION public.fn_um_require_active_admin()
RETURNS TABLE (actor_id UUID, actor_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_profile RECORD;
BEGIN
    v_uid := (SELECT auth.uid()); -- [SUPABASE] auth.uid()
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated',
            DETAIL = 'Your session has ended. Please sign in again.';
    END IF;

    SELECT p.id, p.full_name, p.role, p.status INTO v_profile FROM public.profiles p WHERE p.id = v_uid;
    IF NOT FOUND OR v_profile.role <> 'Admin' OR v_profile.status <> 'Active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden',
            DETAIL = 'Permission denied. Only active Admins can manage users.';
    END IF;

    RETURN QUERY SELECT v_profile.id, v_profile.full_name;
END;
$$;
COMMENT ON FUNCTION public.fn_um_require_active_admin() IS
    'Internal: returns the calling Admin (id, name) or raises unauthenticated / forbidden. Used by every fn_admin_* function.';
REVOKE EXECUTE ON FUNCTION public.fn_um_require_active_admin() FROM PUBLIC, anon, authenticated, service_role; -- [SUPABASE] roles

-- Rule: link expiry must be in the future and at most 7 days ahead (+5 min clock tolerance).
CREATE OR REPLACE FUNCTION public.fn_um_check_expiry(p_expires_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_expires_at IS NULL OR p_expires_at <= NOW() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input',
            DETAIL = 'The expiry must be in the future.';
    END IF;
    IF p_expires_at > NOW() + INTERVAL '7 days 5 minutes' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input',
            DETAIL = 'A link can be valid for at most 7 days.';
    END IF;
END;
$$;
COMMENT ON FUNCTION public.fn_um_check_expiry(TIMESTAMPTZ) IS
    'Internal: raises invalid_input unless now < expiry <= now + 7 days (+5 minutes clock tolerance).';
REVOKE EXECUTE ON FUNCTION public.fn_um_check_expiry(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role; -- [SUPABASE] roles

-- Rule: only a lower-case hex SHA-256 hash is accepted from the server.
CREATE OR REPLACE FUNCTION public.fn_um_check_token_hash(p_token_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input',
            DETAIL = 'The link could not be created. Please try again.';
    END IF;
END;
$$;
COMMENT ON FUNCTION public.fn_um_check_token_hash(TEXT) IS
    'Internal: raises invalid_input unless the value is a lower-case hex SHA-256 hash (never a plaintext token).';
REVOKE EXECUTE ON FUNCTION public.fn_um_check_token_hash(TEXT) FROM PUBLIC, anon, authenticated, service_role; -- [SUPABASE] roles

-- Domain shape of a user (contract AdminUser, snake_case).
CREATE OR REPLACE FUNCTION public.fn_um_user_json(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', p.full_name,
        'role', p.role,
        'status', p.status,
        'created_at', p.created_at
    )
    FROM public.profiles p
    WHERE p.id = p_user_id;
$$;
COMMENT ON FUNCTION public.fn_um_user_json(UUID) IS
    'Internal: a user in the contract AdminUser shape (no secrets).';
REVOKE EXECUTE ON FUNCTION public.fn_um_user_json(UUID) FROM PUBLIC, anon, authenticated, service_role; -- [SUPABASE] roles

-- ------------------------------------------------------------------------------
-- 6. ADMIN OPERATIONS (caller: the Admin's own JWT, role authenticated)
-- ------------------------------------------------------------------------------

-- Caller check used by the admin-users Edge Function before any admin operation
-- (defense in depth: the function verifies the JWT with the auth service AND the
-- active Admin role here; every fn_admin_* function checks again).
CREATE OR REPLACE FUNCTION public.fn_admin_current_caller()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();
    RETURN jsonb_build_object('user_id', v_actor.actor_id);
END;
$$;
COMMENT ON FUNCTION public.fn_admin_current_caller() IS
    'Active Admin only: returns {user_id} of the caller, or raises unauthenticated / forbidden. Used by the admin-users Edge Function to verify the caller before any admin RPC. No other data.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_current_caller() FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_current_caller() TO authenticated; -- [SUPABASE] role

-- listUsers(): all users + open links (stored Pending, with effective status).
CREATE OR REPLACE FUNCTION public.fn_admin_list_users()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();

    RETURN jsonb_build_object(
        'users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', p.id,
                'email', p.email,
                'full_name', p.full_name,
                'role', p.role,
                'status', p.status,
                'created_at', p.created_at
            ) ORDER BY p.full_name, p.email)
            FROM public.profiles p
        ), '[]'::jsonb),
        -- Never token_hash or lease data. Only open links; accepted / revoked rows are history.
        'invitations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', i.id,
                'purpose', i.purpose,
                'email', i.email,
                'full_name', i.full_name,
                'role', i.role,
                'user_id', i.user_id,
                'status', public.fn_invitation_effective_status(i.status, i.expires_at, v_now),
                'expires_at', i.expires_at,
                'accepted_at', i.accepted_at,
                'revoked_at', i.revoked_at,
                'invited_by', i.invited_by,
                'created_at', i.created_at
            ) ORDER BY i.created_at)
            FROM public.user_invitations i
            WHERE i.status = 'Pending'
        ), '[]'::jsonb)
    );
END;
$$;
COMMENT ON FUNCTION public.fn_admin_list_users() IS
    'listUsers: active Admin only. Returns {users, invitations}; invitations are open links (stored Pending) with their effective status (Pending / Expired). Never returns token_hash.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_list_users() FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_list_users() TO authenticated; -- [SUPABASE] role

-- inviteUser(): new invitation link. Conflicts: email_in_use / invitation_exists.
CREATE OR REPLACE FUNCTION public.fn_admin_create_invitation(
    p_email TEXT,
    p_full_name TEXT,
    p_role public.app_role,
    p_expires_at TIMESTAMPTZ,
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_email TEXT := lower(btrim(COALESCE(p_email, '')));
    v_name TEXT := btrim(COALESCE(p_full_name, ''));
    v_user RECORD;
    v_open_id UUID;
    v_id UUID;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();

    IF v_email = '' OR char_length(v_email) > 254 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'Enter a valid email address.';
    END IF;
    IF v_name = '' OR char_length(v_name) > 100 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'Enter a name (at most 100 characters).';
    END IF;
    IF p_role IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'Choose a valid role.';
    END IF;
    PERFORM public.fn_um_check_expiry(p_expires_at);
    PERFORM public.fn_um_check_token_hash(p_token_hash);

    -- Conflict 1: the email already has an account. Existing profiles.email values
    -- are not normalized, so compare lower(btrim()) on both sides.
    SELECT p.id, p.status INTO v_user
    FROM public.profiles p
    WHERE lower(btrim(p.email)) = v_email
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'email_in_use',
            DETAIL = 'This email already has an account.',
            HINT = jsonb_build_object(
                'action', CASE WHEN v_user.status = 'Active' THEN 'create_password_link' ELSE 'enable_user' END,
                'userId', v_user.id
            )::TEXT;
    END IF;

    -- Conflict 2: an open (Pending or Expired) invitation exists -> point to Resend.
    SELECT i.id INTO v_open_id
    FROM public.user_invitations i
    WHERE i.purpose = 'invitation' AND i.status = 'Pending' AND i.email = v_email
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invitation_exists',
            DETAIL = 'This email already has an open invitation. Resend it instead.',
            HINT = jsonb_build_object('action', 'resend_invitation', 'invitationId', v_open_id)::TEXT;
    END IF;

    BEGIN
        INSERT INTO public.user_invitations (purpose, email, full_name, role, user_id, token_hash, expires_at, invited_by)
        VALUES ('invitation', v_email, v_name, p_role, NULL, p_token_hash, p_expires_at, v_actor.actor_id)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        -- Race: another Admin invited the same email at the same time.
        SELECT i.id INTO v_open_id
        FROM public.user_invitations i
        WHERE i.purpose = 'invitation' AND i.status = 'Pending' AND i.email = v_email
        LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invitation_exists',
                DETAIL = 'This email already has an open invitation. Resend it instead.',
                HINT = jsonb_build_object('action', 'resend_invitation', 'invitationId', v_open_id)::TEXT;
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input',
            DETAIL = 'The link could not be created. Please try again.';
    END;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('invitation', v_id::TEXT, 'INVITE', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('email', v_email, 'role', p_role, 'expires_at', p_expires_at));

    RETURN jsonb_build_object('invitation_id', v_id, 'purpose', 'invitation', 'email', v_email, 'expires_at', p_expires_at);
END;
$$;
COMMENT ON FUNCTION public.fn_admin_create_invitation(TEXT, TEXT, public.app_role, TIMESTAMPTZ, TEXT) IS
    'inviteUser: active Admin only. Validates email (normalized), name, role, expiry (max 7 days) and token hash; rejects an email that has an account (email_in_use + suggestion) or an open invitation (invitation_exists + resend suggestion). Stores only the token hash. Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_create_invitation(TEXT, TEXT, public.app_role, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_create_invitation(TEXT, TEXT, public.app_role, TIMESTAMPTZ, TEXT) TO authenticated; -- [SUPABASE] role

-- resendInvitation(): same row, new token hash and expiry; the old link dies
-- (also an active lease on it).
CREATE OR REPLACE FUNCTION public.fn_admin_resend_invitation(
    p_invitation_id UUID,
    p_expires_at TIMESTAMPTZ,
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_inv RECORD;
    v_user RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();
    PERFORM public.fn_um_check_expiry(p_expires_at);
    PERFORM public.fn_um_check_token_hash(p_token_hash);

    SELECT * INTO v_inv FROM public.user_invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND OR v_inv.purpose <> 'invitation' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found', DETAIL = 'The invitation was not found.';
    END IF;
    -- Allowed for Pending Invite and Invite Expired (both stored Pending).
    IF v_inv.status <> 'Pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status',
            DETAIL = 'Only pending or expired invitations can be resent.';
    END IF;

    SELECT p.id, p.status INTO v_user FROM public.profiles p WHERE lower(btrim(p.email)) = v_inv.email LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'email_in_use',
            DETAIL = 'This email already has an account.',
            HINT = jsonb_build_object(
                'action', CASE WHEN v_user.status = 'Active' THEN 'create_password_link' ELSE 'enable_user' END,
                'userId', v_user.id
            )::TEXT;
    END IF;

    BEGIN
        UPDATE public.user_invitations
        SET token_hash = p_token_hash, expires_at = p_expires_at, issued_at = NOW(),
            claim_id = NULL, claimed_until = NULL
        WHERE id = v_inv.id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input',
            DETAIL = 'The link could not be created. Please try again.';
    END;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('invitation', v_inv.id::TEXT, 'RESEND', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('email', v_inv.email, 'expires_at', p_expires_at));

    RETURN jsonb_build_object('invitation_id', v_inv.id, 'purpose', 'invitation', 'email', v_inv.email, 'expires_at', p_expires_at);
END;
$$;
COMMENT ON FUNCTION public.fn_admin_resend_invitation(UUID, TIMESTAMPTZ, TEXT) IS
    'resendInvitation: active Admin only. Pending or expired invitation keeps its id and gets a new token hash, expiry and issued_at; the old link (and any lease on it) stops working at once. Row lock prevents a race. Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_resend_invitation(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_resend_invitation(UUID, TIMESTAMPTZ, TEXT) TO authenticated; -- [SUPABASE] role

-- revokeInvitation(): only an effective Pending invitation.
CREATE OR REPLACE FUNCTION public.fn_admin_revoke_invitation(p_invitation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_inv RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();

    SELECT * INTO v_inv FROM public.user_invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND OR v_inv.purpose <> 'invitation' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found', DETAIL = 'The invitation was not found.';
    END IF;
    IF public.fn_invitation_effective_status(v_inv.status, v_inv.expires_at, NOW()) <> 'Pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status',
            DETAIL = 'Only pending invitations can be revoked.';
    END IF;

    UPDATE public.user_invitations
    SET status = 'Revoked', revoked_at = NOW(), claim_id = NULL, claimed_until = NULL
    WHERE id = v_inv.id;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('invitation', v_inv.id::TEXT, 'REVOKE', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('email', v_inv.email));
END;
$$;
COMMENT ON FUNCTION public.fn_admin_revoke_invitation(UUID) IS
    'revokeInvitation: active Admin only. Only a pending, not expired invitation can be revoked; Revoked is final and ends any lease. Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_revoke_invitation(UUID) FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_revoke_invitation(UUID) TO authenticated; -- [SUPABASE] role

-- changeUserRole(): Active users only; no self change; last Admin protected.
CREATE OR REPLACE FUNCTION public.fn_admin_change_user_role(p_user_id UUID, p_role public.app_role)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_user RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();

    IF p_user_id IS NULL OR p_role IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'Choose a user and a valid role.';
    END IF;
    IF p_user_id = v_actor.actor_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'self_action',
            DETAIL = 'You cannot disable your own account or change your own role.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('iceberg.user_management.admins'));
    SELECT p.id, p.role, p.status INTO v_user FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found', DETAIL = 'The user was not found.';
    END IF;
    IF v_user.status <> 'Active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status',
            DETAIL = 'The role can only be changed for active users.';
    END IF;
    IF v_user.role = p_role THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'The user already has this role.';
    END IF;
    IF v_user.role = 'Admin' AND p_role <> 'Admin' AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.role = 'Admin' AND p.status = 'Active' AND p.id <> p_user_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'last_admin',
            DETAIL = 'The last active Admin cannot be disabled or demoted.';
    END IF;

    UPDATE public.profiles SET role = p_role, updated_at = NOW() WHERE id = p_user_id;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('user', p_user_id::TEXT, 'ROLE_CHANGE', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('from', v_user.role, 'to', p_role));

    RETURN public.fn_um_user_json(p_user_id);
END;
$$;
COMMENT ON FUNCTION public.fn_admin_change_user_role(UUID, public.app_role) IS
    'changeUserRole: active Admin only. Active target only; not the caller (self_action); same role is invalid_input; the last active Admin cannot be demoted (last_admin, also enforced by trigger). Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_change_user_role(UUID, public.app_role) FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_change_user_role(UUID, public.app_role) TO authenticated; -- [SUPABASE] role

-- disableUser(): also revokes the user's open password links.
CREATE OR REPLACE FUNCTION public.fn_admin_disable_user(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_user RECORD;
    v_revoked INTEGER;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'Choose a user.';
    END IF;
    IF p_user_id = v_actor.actor_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'self_action',
            DETAIL = 'You cannot disable your own account or change your own role.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('iceberg.user_management.admins'));
    SELECT p.id, p.role, p.status INTO v_user FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found', DETAIL = 'The user was not found.';
    END IF;
    IF v_user.status <> 'Active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status', DETAIL = 'The user is already disabled.';
    END IF;
    IF v_user.role = 'Admin' AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.role = 'Admin' AND p.status = 'Active' AND p.id <> p_user_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'last_admin',
            DETAIL = 'The last active Admin cannot be disabled or demoted.';
    END IF;

    UPDATE public.profiles SET status = 'Disabled', updated_at = NOW() WHERE id = p_user_id;

    -- A disabled user cannot use or receive links (an active lease ends too).
    UPDATE public.user_invitations
    SET status = 'Revoked', revoked_at = NOW(), claim_id = NULL, claimed_until = NULL
    WHERE purpose = 'password_reset' AND user_id = p_user_id AND status = 'Pending';
    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('user', p_user_id::TEXT, 'DISABLE', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('revoked_links', v_revoked));

    RETURN public.fn_um_user_json(p_user_id);
END;
$$;
COMMENT ON FUNCTION public.fn_admin_disable_user(UUID) IS
    'disableUser: active Admin only. Active target only; not the caller (self_action); not the last active Admin (last_admin). Revokes the user''s open password links (and their leases) in the same transaction. History is kept (no delete). Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_disable_user(UUID) FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_disable_user(UUID) TO authenticated; -- [SUPABASE] role

-- enableUser()
CREATE OR REPLACE FUNCTION public.fn_admin_enable_user(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_user RECORD;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'Choose a user.';
    END IF;

    SELECT p.id, p.status INTO v_user FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found', DETAIL = 'The user was not found.';
    END IF;
    IF v_user.status <> 'Disabled' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status', DETAIL = 'The user is already active.';
    END IF;

    UPDATE public.profiles SET status = 'Active', updated_at = NOW() WHERE id = p_user_id;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('user', p_user_id::TEXT, 'ENABLE', v_actor.actor_id, v_actor.actor_name, '{}'::jsonb);

    RETURN public.fn_um_user_json(p_user_id);
END;
$$;
COMMENT ON FUNCTION public.fn_admin_enable_user(UUID) IS
    'enableUser: active Admin only. Disabled target only. Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_enable_user(UUID) FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_enable_user(UUID) TO authenticated; -- [SUPABASE] role

-- createPasswordResetLink(): Active users only; revokes older open reset links.
CREATE OR REPLACE FUNCTION public.fn_admin_create_password_reset_link(
    p_user_id UUID,
    p_expires_at TIMESTAMPTZ,
    p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor RECORD;
    v_user RECORD;
    v_email TEXT;
    v_name TEXT;
    v_revoked INTEGER;
    v_id UUID;
BEGIN
    SELECT * INTO v_actor FROM public.fn_um_require_active_admin();

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'Choose a user.';
    END IF;
    PERFORM public.fn_um_check_expiry(p_expires_at);
    PERFORM public.fn_um_check_token_hash(p_token_hash);

    -- Row lock: two Admins creating a link for the same user run one after the other.
    SELECT p.id, p.email, p.full_name, p.role, p.status INTO v_user
    FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_found', DETAIL = 'The user was not found.';
    END IF;
    IF v_user.status <> 'Active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_status',
            DETAIL = 'Password links can only be created for active users.';
    END IF;

    v_email := lower(btrim(v_user.email));
    v_name := left(COALESCE(NULLIF(btrim(v_user.full_name), ''), v_email), 100);

    -- A new link revokes that user's older unused links (and ends their leases).
    UPDATE public.user_invitations
    SET status = 'Revoked', revoked_at = NOW(), claim_id = NULL, claimed_until = NULL
    WHERE purpose = 'password_reset' AND user_id = p_user_id AND status = 'Pending';
    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    BEGIN
        INSERT INTO public.user_invitations (purpose, email, full_name, role, user_id, token_hash, expires_at, invited_by)
        VALUES ('password_reset', v_email, v_name, v_user.role, p_user_id, p_token_hash, p_expires_at, v_actor.actor_id)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input',
            DETAIL = 'The link could not be created. Please try again.';
    END;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('invitation', v_id::TEXT, 'PASSWORD_LINK', v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('user_id', p_user_id, 'expires_at', p_expires_at, 'revoked_previous', v_revoked));

    RETURN jsonb_build_object('invitation_id', v_id, 'purpose', 'password_reset', 'email', v_email, 'expires_at', p_expires_at);
END;
$$;
COMMENT ON FUNCTION public.fn_admin_create_password_reset_link(UUID, TIMESTAMPTZ, TEXT) IS
    'createPasswordResetLink: active Admin only. Active target only; expiry max 7 days; revokes the user''s older open reset links (and their leases), then stores the new link hash. Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_admin_create_password_reset_link(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, service_role; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_admin_create_password_reset_link(UUID, TIMESTAMPTZ, TEXT) TO authenticated; -- [SUPABASE] role

-- ------------------------------------------------------------------------------
-- 7. LINK HOLDER OPERATIONS (caller: server only, role service_role)
-- The server hashes the token from #/activate?token=... and passes only the hash.
-- Activation: fn_claim_activation_link -> set password in the auth service ->
-- fn_accept_* with the claim id (or fn_release_activation_link on any failure).
-- ------------------------------------------------------------------------------

-- getInvitation(): only the ActivationLinkInfo fields; dead links raise token_*.
-- A leased link is still Pending and is shown normally.
CREATE OR REPLACE FUNCTION public.fn_get_activation_link(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inv RECORD;
    v_status TEXT;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_invalid', DETAIL = 'This link is not valid.';
    END IF;

    SELECT * INTO v_inv FROM public.user_invitations WHERE token_hash = p_token_hash;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_invalid', DETAIL = 'This link is not valid.';
    END IF;

    v_status := public.fn_invitation_effective_status(v_inv.status, v_inv.expires_at, NOW());
    IF v_status = 'Accepted' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_used', DETAIL = 'This link has already been used.';
    ELSIF v_status = 'Revoked' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_revoked', DETAIL = 'This link has been revoked.';
    ELSIF v_status = 'Expired' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_expired', DETAIL = 'This link has expired.';
    END IF;

    -- A reset link is dead as soon as its user is no longer Active.
    IF v_inv.purpose = 'password_reset' AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = v_inv.user_id AND p.status = 'Active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_revoked', DETAIL = 'This link has been revoked.';
    END IF;

    -- No ids of any record.
    RETURN jsonb_build_object(
        'purpose', v_inv.purpose,
        'status', 'Pending',
        'email', v_inv.email,
        'full_name', v_inv.full_name,
        'role', v_inv.role,
        'expires_at', v_inv.expires_at
    );
END;
$$;
COMMENT ON FUNCTION public.fn_get_activation_link(TEXT) IS
    'getInvitation (server only): resolves a usable link from its token hash and returns only purpose, status, email, full_name, role, expires_at. Dead links raise token_invalid / token_expired / token_used / token_revoked without personal data.';
REVOKE EXECUTE ON FUNCTION public.fn_get_activation_link(TEXT) FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_get_activation_link(TEXT) TO service_role; -- [SUPABASE] role

-- activateAccount() step 1: lease the link for 60 seconds. Only one request can
-- hold the lease, so only that request sets a password for this link.
CREATE OR REPLACE FUNCTION public.fn_claim_activation_link(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inv RECORD;
    v_status TEXT;
    v_claim_id UUID := gen_random_uuid();
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_invalid', DETAIL = 'This link is not valid.';
    END IF;

    -- Concurrent requests with the same token wait here, one after the other.
    SELECT * INTO v_inv FROM public.user_invitations WHERE token_hash = p_token_hash FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_invalid', DETAIL = 'This link is not valid.';
    END IF;

    v_status := public.fn_invitation_effective_status(v_inv.status, v_inv.expires_at, NOW());
    IF v_status = 'Accepted' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_used', DETAIL = 'This link has already been used.';
    ELSIF v_status = 'Revoked' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_revoked', DETAIL = 'This link has been revoked.';
    ELSIF v_status = 'Expired' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_expired', DETAIL = 'This link has expired.';
    END IF;

    -- A reset link can only be used for an Active user.
    IF v_inv.purpose = 'password_reset' AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = v_inv.user_id AND p.status = 'Active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_revoked', DETAIL = 'This link has been revoked.';
    END IF;

    -- Another request holds the lease: no password may be touched now.
    IF v_inv.claimed_until IS NOT NULL AND v_inv.claimed_until > NOW() THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'link_busy',
            DETAIL = 'This link is being used right now. Please try again in a moment.';
    END IF;

    UPDATE public.user_invitations
    SET claim_id = v_claim_id, claimed_until = NOW() + INTERVAL '60 seconds'
    WHERE id = v_inv.id;

    -- claim_id and user_id are for the server only; they are never sent to the browser.
    RETURN jsonb_build_object(
        'claim_id', v_claim_id,
        'purpose', v_inv.purpose,
        'email', v_inv.email,
        'user_id', v_inv.user_id
    );
END;
$$;
COMMENT ON FUNCTION public.fn_claim_activation_link(TEXT) IS
    'activateAccount step 1 (server only): locks a usable link (token_* for dead links, token_revoked for a reset link of a non-Active user), raises link_busy while another lease is active, otherwise leases it for 60 seconds and returns {claim_id, purpose, email, user_id}. The link stays Pending.';
REVOKE EXECUTE ON FUNCTION public.fn_claim_activation_link(TEXT) FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_claim_activation_link(TEXT) TO service_role; -- [SUPABASE] role

-- activateAccount() on failure: give the link back (it stays Pending) so the
-- user can try again at once, e.g. after a password the auth service rejected.
CREATE OR REPLACE FUNCTION public.fn_release_activation_link(p_claim_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF p_claim_id IS NULL THEN
        RETURN FALSE;
    END IF;
    UPDATE public.user_invitations
    SET claim_id = NULL, claimed_until = NULL
    WHERE claim_id = p_claim_id AND status = 'Pending';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
END;
$$;
COMMENT ON FUNCTION public.fn_release_activation_link(UUID) IS
    'activateAccount on failure (server only): ends the lease with this claim id; the link stays Pending and usable. Returns false when the lease is already gone (idempotent, never raises).';
REVOKE EXECUTE ON FUNCTION public.fn_release_activation_link(UUID) FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_release_activation_link(UUID) TO service_role; -- [SUPABASE] role

-- activateAccount() for an invitation, step 3. Called AFTER the server created (or
-- reused an orphan) auth user with the invited email and this request's password.
-- In ONE transaction: lock the leased link, re-check it, create the profile, mark
-- the link Accepted, write audit. If anything fails, nothing is saved and the link
-- stays Pending (the server then releases the lease).
CREATE OR REPLACE FUNCTION public.fn_accept_invitation(p_claim_id UUID, p_auth_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inv RECORD;
    v_auth_email TEXT;
BEGIN
    -- Only the holder of the lease can accept. A lost lease (released, or expired
    -- and claimed by another request) is not found here.
    SELECT * INTO v_inv FROM public.user_invitations WHERE claim_id = p_claim_id FOR UPDATE;
    IF p_claim_id IS NULL OR NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'link_busy',
            DETAIL = 'This link is being used right now. Please try again in a moment.';
    END IF;
    IF v_inv.purpose <> 'invitation' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_invalid', DETAIL = 'This link is not valid.';
    END IF;
    -- A lease exists only on a Pending link (chk_user_invitations_claim); kept as a second lock.
    IF v_inv.status = 'Accepted' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_used', DETAIL = 'This link has already been used.';
    ELSIF v_inv.status = 'Revoked' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_revoked', DETAIL = 'This link has been revoked.';
    END IF;

    -- The auth account must exist and belong to the invited email.
    IF p_auth_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'The account does not match this invitation.';
    END IF;
    SELECT u.email INTO v_auth_email FROM auth.users u WHERE u.id = p_auth_user_id; -- [SUPABASE] auth.users
    IF NOT FOUND OR lower(btrim(COALESCE(v_auth_email, ''))) <> v_inv.email THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input', DETAIL = 'The account does not match this invitation.';
    END IF;

    -- A profile for this account or email means a real account already exists.
    IF EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = p_auth_user_id OR lower(btrim(p.email)) = v_inv.email
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'email_in_use', DETAIL = 'This email already has an account.';
    END IF;

    BEGIN
        INSERT INTO public.profiles (id, email, full_name, role, status)
        VALUES (p_auth_user_id, v_inv.email, v_inv.full_name, v_inv.role, 'Active');
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'email_in_use', DETAIL = 'This email already has an account.';
    END;

    UPDATE public.user_invitations
    SET status = 'Accepted', accepted_at = NOW(), claim_id = NULL, claimed_until = NULL
    WHERE id = v_inv.id;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('invitation', v_inv.id::TEXT, 'ACCEPT', p_auth_user_id, v_inv.full_name,
            jsonb_build_object('email', v_inv.email, 'role', v_inv.role, 'user_id', p_auth_user_id));

    RETURN jsonb_build_object('purpose', 'invitation', 'email', v_inv.email);
END;
$$;
COMMENT ON FUNCTION public.fn_accept_invitation(UUID, UUID) IS
    'activateAccount for an invitation (server only): locks the link by its lease id (only the lease holder; lost lease -> link_busy), checks the auth account email matches, creates the Active profile with the invited name/role, marks the link Accepted and ends the lease in one transaction. Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_accept_invitation(UUID, UUID) FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_accept_invitation(UUID, UUID) TO service_role; -- [SUPABASE] role

-- activateAccount() for a password reset link, step 3. Called AFTER the server set
-- the new password while holding the lease.
CREATE OR REPLACE FUNCTION public.fn_accept_password_reset(p_claim_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inv RECORD;
    v_user RECORD;
BEGIN
    SELECT * INTO v_inv FROM public.user_invitations WHERE claim_id = p_claim_id FOR UPDATE;
    IF p_claim_id IS NULL OR NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'link_busy',
            DETAIL = 'This link is being used right now. Please try again in a moment.';
    END IF;
    IF v_inv.purpose <> 'password_reset' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_invalid', DETAIL = 'This link is not valid.';
    END IF;
    IF v_inv.status = 'Accepted' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_used', DETAIL = 'This link has already been used.';
    ELSIF v_inv.status = 'Revoked' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_revoked', DETAIL = 'This link has been revoked.';
    END IF;

    -- The user must still be Active (a Disabled user cannot use links).
    SELECT p.id, p.full_name, p.status INTO v_user FROM public.profiles p WHERE p.id = v_inv.user_id FOR SHARE;
    IF NOT FOUND OR v_user.status <> 'Active' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'token_revoked', DETAIL = 'This link has been revoked.';
    END IF;

    UPDATE public.user_invitations
    SET status = 'Accepted', accepted_at = NOW(), claim_id = NULL, claimed_until = NULL
    WHERE id = v_inv.id;

    INSERT INTO public.audit_logs (entity_type, entity_id, action, actor_id, actor_name, changes)
    VALUES ('invitation', v_inv.id::TEXT, 'PASSWORD_RESET', v_user.id, v_user.full_name,
            jsonb_build_object('user_id', v_user.id));

    RETURN jsonb_build_object('purpose', 'password_reset', 'email', v_inv.email);
END;
$$;
COMMENT ON FUNCTION public.fn_accept_password_reset(UUID) IS
    'activateAccount for a password reset link (server only): locks the link by its lease id (only the lease holder; lost lease -> link_busy), checks the user is still Active, marks the link Accepted and ends the lease. Role and status do not change. Audited.';
REVOKE EXECUTE ON FUNCTION public.fn_accept_password_reset(UUID) FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_accept_password_reset(UUID) TO service_role; -- [SUPABASE] role

-- ------------------------------------------------------------------------------
-- 8. RATE LIMITING FOR THE PUBLIC LINK ENDPOINTS (caller: server only)
-- Edge Functions are stateless, so the counters live here. The server sends only
-- an HMAC-SHA-256 of the key (client IP or token hash); no raw IP and no token
-- hash is stored. Counter rows are not user data and are cleaned up after 1 day.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_link_rate_limits (
    key_hash TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL,
    hits INTEGER NOT NULL
);
COMMENT ON TABLE public.auth_link_rate_limits IS
    'Fixed-window request counters for the public link endpoints (lookup / activate). One row per key. Accessed only through fn_rate_limit_hit. Not user data; rows older than 1 day are deleted.';
COMMENT ON COLUMN public.auth_link_rate_limits.key_hash IS
    'Lower-case hex HMAC-SHA-256 of "<kind>:<value>" (kind lookup-ip / activate-ip / token), made by the server. Never a raw IP or token hash.';
COMMENT ON COLUMN public.auth_link_rate_limits.window_started_at IS
    'Start of the current counting window.';
COMMENT ON COLUMN public.auth_link_rate_limits.hits IS
    'Requests counted in the current window (including rejected ones).';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_auth_link_rate_limits_key_hash') THEN
        ALTER TABLE public.auth_link_rate_limits
            ADD CONSTRAINT chk_auth_link_rate_limits_key_hash
            CHECK (key_hash ~ '^[0-9a-f]{64}$');
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_auth_link_rate_limits_key_hash ON public.auth_link_rate_limits IS
    'Only a 64-char lower-case hex hash can be stored, so a raw IP or token cannot be saved here by mistake.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_auth_link_rate_limits_hits') THEN
        ALTER TABLE public.auth_link_rate_limits
            ADD CONSTRAINT chk_auth_link_rate_limits_hits
            CHECK (hits >= 1);
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_auth_link_rate_limits_hits ON public.auth_link_rate_limits IS
    'A stored window has at least one counted request.';

CREATE INDEX IF NOT EXISTS idx_auth_link_rate_limits_window
    ON public.auth_link_rate_limits (window_started_at);
COMMENT ON INDEX public.idx_auth_link_rate_limits_window IS
    'Cheap cleanup of old counter rows.';

-- RLS on with no policies; no API role (not even service_role) reads the table directly.
ALTER TABLE public.auth_link_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_link_rate_limits FROM PUBLIC, anon, authenticated, service_role; -- [SUPABASE] roles

-- Counts one request for a key and says whether it is allowed (atomic, race-safe:
-- one INSERT ... ON CONFLICT DO UPDATE per call).
CREATE OR REPLACE FUNCTION public.fn_rate_limit_hit(p_key_hash TEXT, p_limit INTEGER, p_window_seconds INTEGER)
RETURNS TABLE (allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_window INTERVAL;
    v_hits INTEGER;
    v_started TIMESTAMPTZ;
BEGIN
    IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
       OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
       OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_input',
            DETAIL = 'The rate limit request is not valid.';
    END IF;
    v_window := make_interval(secs => p_window_seconds);

    -- Cleanup: at most 100 rows older than the longest window (1 day) per call.
    DELETE FROM public.auth_link_rate_limits
    WHERE ctid IN (
        SELECT r.ctid FROM public.auth_link_rate_limits r
        WHERE r.window_started_at < v_now - INTERVAL '1 day'
        LIMIT 100
    );

    INSERT INTO public.auth_link_rate_limits AS r (key_hash, window_started_at, hits)
    VALUES (p_key_hash, v_now, 1)
    ON CONFLICT (key_hash) DO UPDATE SET
        hits = CASE WHEN r.window_started_at <= v_now - v_window THEN 1 ELSE LEAST(r.hits + 1, 1000000) END,
        window_started_at = CASE WHEN r.window_started_at <= v_now - v_window THEN v_now ELSE r.window_started_at END
    RETURNING r.hits, r.window_started_at INTO v_hits, v_started;

    RETURN QUERY SELECT
        v_hits <= p_limit,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_started + v_window - v_now)))::INTEGER);
END;
$$;
COMMENT ON FUNCTION public.fn_rate_limit_hit(TEXT, INTEGER, INTEGER) IS
    'Server only: counts one request for a hashed key in a fixed window of p_window_seconds (1-86400) and returns allowed = hits <= p_limit (1-1000) plus the seconds left in the window. Deletes at most 100 counter rows older than 1 day per call.';
REVOKE EXECUTE ON FUNCTION public.fn_rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role; -- [SUPABASE] role
