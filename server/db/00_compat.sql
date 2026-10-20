-- ==============================================================================
-- Iceberg Playbook: plain-PostgreSQL compatibility layer
-- Runs BEFORE supabase/migrations/*.sql so those migrations apply unchanged on a
-- vanilla PostgreSQL (e.g. Railway). It provides the few Supabase objects the
-- migrations rely on:
--   * roles anon / authenticated / service_role (the API switches to them per request)
--   * auth.users, auth.uid(), auth.role(), auth.jwt()
--   * storage.buckets / storage.objects (metadata + RLS; file bytes live on disk)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ROLES -------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;
END $$;

-- The connecting (owner) user must be allowed to SET ROLE to them.
DO $$ BEGIN
    EXECUTE format('GRANT anon, authenticated, service_role TO %I', current_user);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. AUTH SCHEMA ---------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    encrypted_password TEXT,
    email_confirmed_at TIMESTAMPTZ,
    banned_until TIMESTAMPTZ,
    raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON auth.users (lower(btrim(email)));

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(auth.jwt() ->> 'role', '');
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role() TO anon, authenticated, service_role;
-- auth.users is reachable only through SECURITY DEFINER functions and the API server.
REVOKE ALL ON auth.users FROM anon, authenticated;

-- 3. STORAGE SCHEMA (metadata only; bytes are stored on the API server's volume) ---
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    public BOOLEAN NOT NULL DEFAULT FALSE,
    file_size_limit BIGINT,
    allowed_mime_types TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id TEXT REFERENCES storage.buckets(id),
    name TEXT,
    owner UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT objects_bucket_name_key UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
GRANT ALL ON storage.objects, storage.buckets TO service_role;

-- The API server (not the browser) manages auth.users on behalf of the user-management flows.
GRANT SELECT, INSERT, UPDATE ON auth.users TO service_role;
