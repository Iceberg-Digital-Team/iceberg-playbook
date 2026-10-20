WITH
 d_issues AS (SELECT unnest(ARRAY['WA-001','WA-002','WA-003','WA-004','WA-005','LIFE-003','META-006','ZOOM-002']) AS id),
 d_guides AS (SELECT unnest(ARRAY['WA-G01','WA-G02','WA-G03','WA-G04','WA-G05','LIFE-G01','META-G01','ZOOM-G01']) AS id),
 d_sops   AS (SELECT unnest(ARRAY['WA-SOP01']) AS id),
 d_pbs    AS (SELECT unnest(ARRAY['whatsapp','lifesycle','meta-business','plaud','website','zoom']) AS id),
 del_media AS (
   DELETE FROM public.media_files
   WHERE guide_id IN (SELECT id FROM d_guides) OR issue_id IN (SELECT id FROM d_issues) OR sop_id IN (SELECT id FROM d_sops)
      OR guide_version_id IN (SELECT id FROM public.guide_versions WHERE guide_id IN (SELECT id FROM d_guides))
   RETURNING 1),
 del_audit AS (
   DELETE FROM public.audit_logs
   WHERE (entity_type IN ('guide','guide_version') AND split_part(entity_id, ':', 1) IN (SELECT id FROM d_guides))
      OR (entity_type = 'issue' AND entity_id IN (SELECT id FROM d_issues))
      OR (entity_type = 'sop' AND entity_id IN (SELECT id FROM d_sops))
      OR (entity_type = 'playbook' AND entity_id IN (SELECT id FROM d_pbs))
   RETURNING 1),
 del_versions AS (DELETE FROM public.guide_versions WHERE guide_id IN (SELECT id FROM d_guides) RETURNING 1),
 del_guides   AS (DELETE FROM public.guides WHERE id IN (SELECT id FROM d_guides) RETURNING 1),
 del_issues   AS (DELETE FROM public.issues WHERE id IN (SELECT id FROM d_issues) RETURNING 1),
 del_sops     AS (DELETE FROM public.sops WHERE id IN (SELECT id FROM d_sops) RETURNING 1),
 del_pbs AS (
   DELETE FROM public.playbooks p
   WHERE p.id IN (SELECT id FROM d_pbs)
     AND NOT EXISTS (SELECT 1 FROM public.issues  x WHERE x.playbook_id = p.id AND x.id NOT IN (SELECT id FROM d_issues))
     AND NOT EXISTS (SELECT 1 FROM public.guides  x WHERE x.playbook_id = p.id AND x.id NOT IN (SELECT id FROM d_guides))
     AND NOT EXISTS (SELECT 1 FROM public.sops    x WHERE x.playbook_id = p.id AND x.id NOT IN (SELECT id FROM d_sops))
   RETURNING 1)
SELECT (SELECT count(*) FROM del_media) AS media, (SELECT count(*) FROM del_audit) AS audit,
       (SELECT count(*) FROM del_versions) AS versions, (SELECT count(*) FROM del_guides) AS guides,
       (SELECT count(*) FROM del_issues) AS issues, (SELECT count(*) FROM del_sops) AS sops,
       (SELECT count(*) FROM del_pbs) AS playbooks
