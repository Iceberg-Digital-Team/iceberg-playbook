-- Migration 06: Explicit table-level privileges for authenticated and service_role
-- Note: PostgreSQL evaluates table-level privileges before RLS policies.
-- These grants allow authenticated requests to reach RLS, which enforces actual row-level rules.

-- 1. Tables with full DML access under RLS control
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.playbooks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.issues TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_files TO authenticated;

-- 2. Append/read-only tables (no UPDATE or DELETE for authenticated)
GRANT SELECT, INSERT ON TABLE public.guide_versions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO authenticated;

-- 3. Service role administrative access
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.playbooks TO service_role;
GRANT ALL ON TABLE public.issues TO service_role;
GRANT ALL ON TABLE public.guides TO service_role;
GRANT ALL ON TABLE public.guide_versions TO service_role;
GRANT ALL ON TABLE public.sops TO service_role;
GRANT ALL ON TABLE public.media_files TO service_role;
GRANT ALL ON TABLE public.audit_logs TO service_role;
