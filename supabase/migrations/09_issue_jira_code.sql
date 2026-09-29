-- Migration 09: Add optional jira_code reference to public.issues
-- Manual reference field only (no Jira API integration).
-- Guides derive this value from their linked Issue.

ALTER TABLE public.issues
ADD COLUMN IF NOT EXISTS jira_code TEXT DEFAULT NULL;

-- Partial index for active issues with a jira_code
CREATE INDEX IF NOT EXISTS idx_issues_jira_code
ON public.issues (jira_code)
WHERE jira_code IS NOT NULL AND deleted_at IS NULL;
