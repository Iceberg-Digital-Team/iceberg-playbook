-- Removes ONLY the demo records inserted by supabase/migrations/05_seed_data.sql
-- (exact ids below). Content created by users is left untouched, and a demo playbook is
-- deleted only when nothing else still belongs to it.
-- Run as the database owner (Railway: PostgreSQL service -> Data/Query, or psql "$DATABASE_URL").
-- Safe to run twice. The whole script is one transaction.
BEGIN;

CREATE TEMP TABLE _demo_issues (id TEXT PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE _demo_guides (id TEXT PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE _demo_sops (id TEXT PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE _demo_playbooks (id TEXT PRIMARY KEY) ON COMMIT DROP;

INSERT INTO _demo_issues VALUES ('WA-001'),('WA-002'),('WA-003'),('WA-004'),('WA-005'),('LIFE-003'),('META-006'),('ZOOM-002');
INSERT INTO _demo_guides VALUES ('WA-G01'),('WA-G02'),('WA-G03'),('WA-G04'),('WA-G05'),('LIFE-G01'),('META-G01'),('ZOOM-G01');
INSERT INTO _demo_sops VALUES ('WA-SOP01');
INSERT INTO _demo_playbooks VALUES ('whatsapp'),('lifesycle'),('meta-business'),('plaud'),('website'),('zoom');

-- 1. Files / audit rows that point at the demo records.
DELETE FROM public.media_files
 WHERE guide_id IN (SELECT id FROM _demo_guides) OR issue_id IN (SELECT id FROM _demo_issues)
    OR sop_id IN (SELECT id FROM _demo_sops)
    OR guide_version_id IN (SELECT id FROM public.guide_versions WHERE guide_id IN (SELECT id FROM _demo_guides));
DELETE FROM public.audit_logs
 WHERE (entity_type IN ('guide','guide_version') AND split_part(entity_id, ':', 1) IN (SELECT id FROM _demo_guides))
    OR (entity_type = 'issue' AND entity_id IN (SELECT id FROM _demo_issues))
    OR (entity_type = 'sop' AND entity_id IN (SELECT id FROM _demo_sops))
    OR (entity_type = 'playbook' AND entity_id IN (SELECT id FROM _demo_playbooks));

-- 2. Guides <-> versions reference each other: detach, then delete versions, then guides.
UPDATE public.guides SET current_version_id = NULL WHERE id IN (SELECT id FROM _demo_guides);
DELETE FROM public.guide_versions WHERE guide_id IN (SELECT id FROM _demo_guides);
DELETE FROM public.guides WHERE id IN (SELECT id FROM _demo_guides);

-- 3. Issues and SOPs.
DELETE FROM public.issues WHERE id IN (SELECT id FROM _demo_issues);
DELETE FROM public.sops WHERE id IN (SELECT id FROM _demo_sops);

-- 4. Demo playbooks, only the ones that are now empty.
DELETE FROM public.playbooks p
 WHERE p.id IN (SELECT id FROM _demo_playbooks)
   AND NOT EXISTS (SELECT 1 FROM public.issues WHERE playbook_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.guides WHERE playbook_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM public.sops WHERE playbook_id = p.id);

-- Result (check these before the COMMIT below takes effect).
SELECT 'playbooks' AS remaining, count(*) FROM public.playbooks
UNION ALL SELECT 'issues', count(*) FROM public.issues
UNION ALL SELECT 'guides', count(*) FROM public.guides
UNION ALL SELECT 'guide_versions', count(*) FROM public.guide_versions
UNION ALL SELECT 'sops', count(*) FROM public.sops;

COMMIT;
