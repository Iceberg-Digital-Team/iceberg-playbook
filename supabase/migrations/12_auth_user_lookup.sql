-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 12: Auth User Lookup for Account Activation
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================
-- Contract: docs/USER_MANAGEMENT_API.md (section 11, activation order).
-- Requires: 10_user_management.sql, 11_user_invitation_security.sql.
--
-- Used only by the auth-links Edge Function (secret key / service_role) during
-- invitation activation:
--   - account with a profile    -> email_in_use, its password is never touched;
--   - account without a profile -> left over from an earlier failed activation,
--                                  may be reused (after fn_accept_invitation);
--   - no account                -> the server creates one.
-- Supabase-specific parts are marked [SUPABASE].
-- ==============================================================================

-- Rule: find the auth account of an invited email, compared with lower(btrim())
-- on both sides (existing emails are not normalized). Returns only the id and
-- whether a profile exists; never the email or any other column.
CREATE OR REPLACE FUNCTION public.fn_find_auth_user_by_email(p_email TEXT)
RETURNS TABLE (user_id UUID, has_profile BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        u.id,
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
    FROM auth.users u -- [SUPABASE] auth.users
    WHERE lower(btrim(u.email)) = lower(btrim(p_email))
    ORDER BY u.created_at
    LIMIT 1;
$$;
COMMENT ON FUNCTION public.fn_find_auth_user_by_email(TEXT) IS
    'Server only: auth account id for an email (lower(btrim) on both sides) and whether it has a profile. Activation reuses only an account WITHOUT a profile; an account with a profile is a real account (email_in_use). Returns no email or other data.';

REVOKE EXECUTE ON FUNCTION public.fn_find_auth_user_by_email(TEXT) FROM PUBLIC, anon, authenticated; -- [SUPABASE] roles
GRANT EXECUTE ON FUNCTION public.fn_find_auth_user_by_email(TEXT) TO service_role; -- [SUPABASE] role
