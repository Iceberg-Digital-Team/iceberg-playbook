-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 10: User Management Data Model (user status + invitation / password links)
-- Target Project Ref: xwqqngkjlsgwsvacmjmf
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- ==============================================================================
-- Contract: docs/USER_MANAGEMENT_API.md (sections 2, 3, 5, 7, 10).
-- This file only defines data and constraints. Access rules, triggers and the
-- functions that change this data live in 11_user_invitation_security.sql.
--
-- Portability: plain PostgreSQL. Supabase-specific parts are marked [SUPABASE].
-- Tokens: the server (Edge Function) creates a random token, puts it in the link
-- and sends ONLY lower-case hex SHA-256 of it to the database. No plaintext token
-- is ever stored, logged or passed to SQL.
-- ==============================================================================

-- 1. USER STATUS ON PROFILES
-- Rule: a Disabled user cannot sign in and has no role (contract UserStatus).
-- The default fills every existing profile with 'Active' in the same statement.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_status') THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT chk_profiles_status
            CHECK (status IN ('Active', 'Disabled'));
    END IF;
END $$;

COMMENT ON COLUMN public.profiles.status IS
    'User status: Active or Disabled. Disabled users cannot sign in and get no role (fn_user_role). Users are never hard-deleted; disabling is the only way to remove access. Changed only through fn_admin_disable_user / fn_admin_enable_user.';
COMMENT ON CONSTRAINT chk_profiles_status ON public.profiles IS
    'Only the contract values Active / Disabled are allowed.';

-- Rule: the last active Admin cannot be disabled or demoted. This index keeps the
-- "how many active Admins are left" check cheap.
CREATE INDEX IF NOT EXISTS idx_profiles_active_admins
    ON public.profiles (id)
    WHERE role = 'Admin' AND status = 'Active';
COMMENT ON INDEX public.idx_profiles_active_admins IS
    'Fast count of active Admins for the last-active-Admin rule.';

-- 2. INVITATION AND PASSWORD LINK TABLE
-- One row per link. purpose = 'invitation' (new user) or 'password_reset'
-- (existing Active user). Rows are never deleted (history).
CREATE TABLE IF NOT EXISTS public.user_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose TEXT NOT NULL,                       -- added for the contract, needs team lead OK
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,                     -- added for the contract, needs team lead OK
    role public.app_role NOT NULL,
    user_id UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT, -- added for the contract, needs team lead OK
    status TEXT NOT NULL DEFAULT 'Pending',
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    invited_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_invitations IS
    'Invitation and password reset links (one row per link). Only a SHA-256 hash of the token is stored. Single-use, expiring, revocable. Rows are never deleted. Accessed only through the functions in migration 11.';
COMMENT ON COLUMN public.user_invitations.id IS
    'Stable invitation id. Resend keeps the same id.';
COMMENT ON COLUMN public.user_invitations.purpose IS
    'invitation = new user; password_reset = new password for an existing Active user. Added for the contract (needs team lead OK).';
COMMENT ON COLUMN public.user_invitations.email IS
    'Target email, stored lower-case and trimmed. Resolved from the token by the server; never put in the URL.';
COMMENT ON COLUMN public.user_invitations.full_name IS
    'Name entered by the Admin (invitation) or copied from the profile (password_reset). Required because profiles.full_name is NOT NULL. Added for the contract (needs team lead OK).';
COMMENT ON COLUMN public.user_invitations.role IS
    'Role the new user gets on activation (invitation) or the user''s role when the link was created (password_reset).';
COMMENT ON COLUMN public.user_invitations.user_id IS
    'Target user of a password_reset link; NULL for an invitation. RESTRICT keeps history if someone tries to delete the user. Added for the contract (needs team lead OK).';
COMMENT ON COLUMN public.user_invitations.status IS
    'Stored status: Pending, Accepted or Revoked. Expired is never stored: a Pending row with expires_at <= now is Expired (fn_invitation_effective_status). Accepted and Revoked are final.';
COMMENT ON COLUMN public.user_invitations.token_hash IS
    'Lower-case hex SHA-256 of the link token (64 chars). The plaintext token is never stored. Replaced on resend, so the old link stops working.';
COMMENT ON COLUMN public.user_invitations.expires_at IS
    'Link expiry. At most 7 days (+5 minutes clock tolerance) after issued_at.';
COMMENT ON COLUMN public.user_invitations.issued_at IS
    'When the current token was issued. Equals created_at at first, updated on every resend. The expiry window is measured from here.';
COMMENT ON COLUMN public.user_invitations.accepted_at IS
    'Set when the link is used (status Accepted). Single use.';
COMMENT ON COLUMN public.user_invitations.revoked_at IS
    'Set when the link is revoked by an Admin, replaced by a newer reset link, or its user is disabled (status Revoked).';
COMMENT ON COLUMN public.user_invitations.invited_by IS
    'Admin who created the link. RESTRICT keeps history if someone tries to delete that user.';
COMMENT ON COLUMN public.user_invitations.created_at IS
    'When the row was created.';
COMMENT ON COLUMN public.user_invitations.updated_at IS
    'Last change of the row (set by trigger trg_user_invitations_guard).';

-- 3. CHECK CONSTRAINTS (each protects one contract rule)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_purpose') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_purpose
            CHECK (purpose IN ('invitation', 'password_reset'));
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_purpose ON public.user_invitations IS
    'Only the contract link purposes: invitation, password_reset.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_status') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_status
            CHECK (status IN ('Pending', 'Accepted', 'Revoked'));
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_status ON public.user_invitations IS
    'Stored statuses only. Expired is computed from expires_at, never stored.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_email_format') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_email_format
            CHECK (
                email = lower(btrim(email))
                AND char_length(email) <= 254
                AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
            );
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_email_format ON public.user_invitations IS
    'Email is stored lower-case and trimmed, at most 254 chars, valid format (same rule as the frontend).';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_full_name') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_full_name
            CHECK (btrim(full_name) <> '' AND char_length(full_name) <= 100);
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_full_name ON public.user_invitations IS
    'Name is required (1 to 100 chars) because profiles.full_name is NOT NULL.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_purpose_user') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_purpose_user
            CHECK (
                (purpose = 'invitation' AND user_id IS NULL)
                OR (purpose = 'password_reset' AND user_id IS NOT NULL)
            );
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_purpose_user ON public.user_invitations IS
    'An invitation has no target user yet; a password_reset link always has one.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_status_timestamps') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_status_timestamps
            CHECK (
                (status = 'Pending' AND accepted_at IS NULL AND revoked_at IS NULL)
                OR (status = 'Accepted' AND accepted_at IS NOT NULL AND revoked_at IS NULL)
                OR (status = 'Revoked' AND revoked_at IS NOT NULL AND accepted_at IS NULL)
            );
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_status_timestamps ON public.user_invitations IS
    'Status and timestamps agree: a link is either open, used once, or revoked; never both used and revoked.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_expiry_window') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_expiry_window
            CHECK (
                issued_at >= created_at
                AND expires_at > issued_at
                AND expires_at <= issued_at + INTERVAL '7 days 5 minutes'
            );
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_expiry_window ON public.user_invitations IS
    'Expiry is after the (re)issue time and at most 7 days later (+5 minutes clock tolerance). Holds for every write path, also direct ones. Implies expires_at > created_at.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_invitations_token_hash_format') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT chk_user_invitations_token_hash_format
            CHECK (token_hash ~ '^[0-9a-f]{64}$');
    END IF;
END $$;
COMMENT ON CONSTRAINT chk_user_invitations_token_hash_format ON public.user_invitations IS
    'Only a lower-case hex SHA-256 hash (64 chars) can be stored, so a plaintext token cannot be saved here by mistake.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_invitations_token_hash') THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT uq_user_invitations_token_hash UNIQUE (token_hash);
    END IF;
END $$;
COMMENT ON CONSTRAINT uq_user_invitations_token_hash ON public.user_invitations IS
    'A token resolves to exactly one link.';

-- 4. INDEXES
-- Rule: at most one open invitation per email. A stored-Pending row that has
-- expired still counts, so the Admin is pointed to "Resend" (invitation_exists).
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invitations_open_invitation
    ON public.user_invitations (email)
    WHERE purpose = 'invitation' AND status = 'Pending';
COMMENT ON INDEX public.uq_user_invitations_open_invitation IS
    'At most one open (stored Pending) invitation per email. Also blocks a race between two Admins inviting the same email.';

-- Rule: a new password link revokes older open ones, so at most one is open.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invitations_open_reset
    ON public.user_invitations (user_id)
    WHERE purpose = 'password_reset' AND status = 'Pending';
COMMENT ON INDEX public.uq_user_invitations_open_reset IS
    'At most one open (stored Pending) password reset link per user.';

CREATE INDEX IF NOT EXISTS idx_user_invitations_user_id ON public.user_invitations (user_id);
COMMENT ON INDEX public.idx_user_invitations_user_id IS
    'Foreign key lookup: reset links of a user (revoke on disable / new link) and RESTRICT checks.';

CREATE INDEX IF NOT EXISTS idx_user_invitations_invited_by ON public.user_invitations (invited_by);
COMMENT ON INDEX public.idx_user_invitations_invited_by IS
    'Foreign key lookup for RESTRICT checks when a profile delete is attempted.';

CREATE INDEX IF NOT EXISTS idx_user_invitations_pending
    ON public.user_invitations (created_at)
    WHERE status = 'Pending';
COMMENT ON INDEX public.idx_user_invitations_pending IS
    'Admin user list: open links only.';

-- 5. EFFECTIVE STATUS (pure rule, no data access)
-- Rule: a stored Pending link past expires_at is Expired. Accepted / Revoked are final.
-- Every function in migration 11 uses this instead of reading status directly.
CREATE OR REPLACE FUNCTION public.fn_invitation_effective_status(
    p_status TEXT,
    p_expires_at TIMESTAMPTZ,
    p_now TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_status = 'Pending' AND p_expires_at <= p_now THEN 'Expired'
        ELSE p_status
    END;
$$;
COMMENT ON FUNCTION public.fn_invitation_effective_status(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Effective link status: stored Pending with expires_at <= now is Expired; otherwise the stored status. Pure rule, mirrors getEffectiveInvitationStatus in src/services/adminUserRules.ts.';

REVOKE EXECUTE ON FUNCTION public.fn_invitation_effective_status(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon; -- [SUPABASE] role anon
GRANT EXECUTE ON FUNCTION public.fn_invitation_effective_status(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role; -- [SUPABASE] roles
