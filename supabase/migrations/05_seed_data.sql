-- ==============================================================================
-- ICEBERG PLAYBOOK SUPABASE V2 MIGRATIONS
-- Migration 05: Clean Seed Data (Text, Structures, Relationships & Versions)
-- Source of Truth: src/sampleData.ts
-- Mode: PROPOSED (DO NOT EXECUTE WITHOUT APPROVAL)
-- Guarantees:
--   - All Playbooks, Issues, Guides, GuideVersions, and SOPs strictly preserved
--   - All old video/PDF/screenshot/blob/external URLs stripped
--   - Idempotent: safe against re-runs, never downgrades active production guides
--   - Zero media_files rows created
-- ==============================================================================

-- 1. SEED PLAYBOOKS
INSERT INTO public.playbooks (id, slug, name, code, description, icon, owner, visibility, created_at, updated_at)
VALUES ('whatsapp', 'whatsapp', 'WhatsApp', 'WA', 'WhatsApp related issues, API onboarding, and BSP numbers migration processes.', 'MessageSquare', 'Support Team', 'Internal', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.playbooks (id, slug, name, code, description, icon, owner, visibility, created_at, updated_at)
VALUES ('meta-business', 'meta-business', 'Meta Business', 'META', 'Business Manager verification, system user setup, and WABA permissions management.', 'Briefcase', 'Support Team', 'Internal', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.playbooks (id, slug, name, code, description, icon, owner, visibility, created_at, updated_at)
VALUES ('lifesycle', 'lifesycle', 'Lifesycle', 'LIFE', 'Property match automation configurations, webhook integrations, and CRM syncing issues.', 'Home', 'Support Team', 'Internal', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.playbooks (id, slug, name, code, description, icon, owner, visibility, created_at, updated_at)
VALUES ('zoom', 'zoom', 'Zoom', 'ZOOM', 'Zoom meeting triggers, API integrations, OAuth setups, and webhook diagnostics.', 'Video', 'Support Team', 'Internal', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.playbooks (id, slug, name, code, description, icon, owner, visibility, created_at, updated_at)
VALUES ('plaud', 'plaud', 'Plaud', 'PLAUD', 'Plaud AI transcription integrations, audio device pairing guides, and CRM exports.', 'Mic', 'Support Team', 'Internal', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.playbooks (id, slug, name, code, description, icon, owner, visibility, created_at, updated_at)
VALUES ('website', 'website', 'Website', 'WEB', 'Iceberg Digital main website integrations, tracking scripts, and widget setups.', 'Globe', 'Support Team', 'Internal', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 2. SEED ISSUES (Stripped of old external attachments)
INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('WA-001', 'whatsapp', 'Phone Number Already Registered', 'Occurs when a customer attempts to verify a WhatsApp phone number that is already associated with an existing WhatsApp account (either personal, business, or another BSP). This blocks embedded signup and requires manual API/deletion interventions.', ARRAY['Phone Number Already Registered'], '', '', '', ARRAY['Business Portfolio ID (Meta BM)', 'Phone Number (unlocked, ready to receive SMS/voice)', 'WhatsApp Business Account (WABA) Admin access', 'Approved Display Name in Meta BM'], '[]'::jsonb, '', 'Verified', 'Medium', '15 min', 'Tarik Deniz', '2026-08-24', '2026-08-24')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('WA-002', 'whatsapp', 'OTP Not Received', 'Support agents and customers failing to receive the 6-digit OTP code via SMS or voice when verifying a new WhatsApp Business profile.', ARRAY['OTP Not Received'], '', '', '', ARRAY['Phone number active', 'WABA onboarding access'], '[]'::jsonb, '', 'Verified', 'Easy', '5 min', 'Support Team', '2026-08-25', '2026-08-25')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('WA-003', 'whatsapp', 'Embedded Signup Failed', 'The WhatsApp Embedded Signup pop-up fails to complete, closing abruptly or rendering a blank window after selecting a Facebook Business account.', ARRAY['Embedded Signup Failed', 'Popup closes abruptly', 'Blank window displays'], '', '', '', ARRAY['Admin permission on Facebook BM', 'Ad blocker disabled'], '[]'::jsonb, '', 'Verified', 'Advanced', '20 min', 'Support Team', '2026-08-22', '2026-08-22')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('META-006', 'meta-business', 'Business Verification Failed', 'Occurs when Meta rejects the official documentation submitted for Business Portfolio verification. This prevents approval of WhatsApp numbers and system links.', ARRAY['Business Verification Failed', 'Document rejected'], '', '', '', ARRAY['Official trade license or utility bills', 'Matching Business Name and Address'], '[]'::jsonb, '', 'Verified', 'Medium', '15 min', 'Support Team', '2026-08-20', '2026-08-20')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('ZOOM-002', 'zoom', 'Zoom Meeting Not Starting', 'The automated CRM integration fails to launch a Zoom meeting when a client schedules an appointment.', ARRAY['Zoom Meeting Not Starting'], '', '', '', ARRAY['Zoom Account Connected', 'API Keys refreshed'], '[]'::jsonb, '', 'Verified', 'Easy', '5 min', 'Support Team', '2026-08-25', '2026-08-25')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('WA-004', 'whatsapp', 'WhatsApp BSP Migration Required', 'The customer’s WhatsApp Business number is hosted with another BSP and needs to move to Iceberg Digital.', '{}', '', '', '', '{}', '[]'::jsonb, '', 'Verified', 'Medium', '', 'Tarik Deniz', '2026-08-21', '2026-08-21')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('WA-005', 'whatsapp', 'New WhatsApp Number Not Configured', 'A new customer phone number has not yet been configured for the WhatsApp Business API.', '{}', '', '', '', '{}', '[]'::jsonb, '', 'Verified', 'Easy', '', 'Support Team', '2026-08-25', '2026-08-25')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.issues (id, playbook_id, title, summary, symptoms, error_message, context, affected_area, information_to_collect, attachments, internal_notes, status, difficulty, estimated_time, author, created_at, updated_at)
VALUES ('LIFE-003', 'lifesycle', 'Property Matching Issue', 'Property listings fail to match with leads in the Lifesycle integration.', '{}', '', '', '', '{}', '[]'::jsonb, '', 'Verified', 'Medium', '', 'Support Team', '2026-08-15', '2026-08-15')
ON CONFLICT (id) DO NOTHING;

-- 3. SEED GUIDES & IMMUTABLE GUIDE VERSIONS
-- Guide: WA-G03
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'WA-G03', 'WA-001', 'whatsapp', NULL, 1,
    'How to Resolve a Registered WhatsApp Number', 'Follow the documented solution for Phone Number Already Registered.', 'Verified', 'Medium', '15 min',
    ARRAY['Ensure the client owns the phone number and has it physically available to receive the OTP code.', 'Check if the number is currently registered to a consumer WhatsApp app or another business App.'], ARRAY['Business Portfolio ID (Meta BM)', 'Phone Number (unlocked, ready to receive SMS/voice)', 'WhatsApp Business Account (WABA) Admin access', 'Approved Display Name in Meta BM'], 'Deleting the existing account is destructive. All message history on the consumer device will be lost once migrated to WABA. Meta does not allow backing up consumer messages and restoring them into WABA.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check the existing WhatsApp Business Account","description":"Navigate to Meta Business Manager -> WhatsApp Manager. Under the Phone Numbers tab, check if the phone number is displayed with a status. If it is already registered elsewhere, you will see a warning message that the number belongs to another account.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"You can see the affected phone number status inside the WABA dashboard."},{"number":2,"title":"Delete/Disconnect Old Client Account","description":"If the client is running the number on a consumer WhatsApp App, open the App on the mobile phone -> Settings -> Account -> Delete My Account. If it is registered under another BSP, the client must trigger a migration or sign a consent form.","estimatedTime":"5 min","screenshot":"","importantNote":"Deleting the account can take up to 3 minutes to propagate through Meta''s registers.","successIndicator":"The WhatsApp client on the phone says \"Welcome to WhatsApp\" indicating it is unregistered."},{"number":3,"title":"Trigger Embedded Signup verification","description":"Go to the onboarding dashboard, start the Embedded Signup process again, select the appropriate BM and WABA, and enter the phone number.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"The page proceeds to the OTP verification screen without the \"number already registered\" error."},{"number":4,"title":"Enter Verification OTP","description":"Choose SMS or Voice call for OTP verification. Enter the 6-digit code received on the device.","estimatedTime":"3 min","screenshot":"","importantNote":"","successIndicator":"Number successfully verified. Status changes to \"Connected\" and certificate is generated."}]'::jsonb, '[{"problem":"OTP not received after deleting consumer account","cause":"Meta is rate-limiting SMS requests due to multiple previous triggers.","solution":"Wait 10 minutes and trigger a \"Voice Call\" instead of SMS.","relatedIssue":"WA-002"},{"problem":"Number is locked in a deleted Business Manager","cause":"The client deleted their old Meta Business Manager without removing the WhatsApp number first.","solution":"Open a Meta Support Ticket requesting the release of the phone number from the orphaned WABA ID.","relatedIssue":"META-006"}]'::jsonb, '[{"question":"Can we revert this back to a consumer account?","answer":"Yes, but the number must first be deleted from the WABA account. Once deleted, it can be re-registered on a mobile phone."},{"question":"How long does a BSP migration take?","answer":"If the source BSP approves the release, the migration takes less than 10 minutes. If they do not, it requires manual paperwork taking 2-3 days."}]'::jsonb,
    ARRAY['WA-002', 'WA-003', 'META-006'], 'Ensure the customer understands that their consumer chats will be permanently deleted. Do NOT skip Step 2. Keep customer on line until OTP is verified.', '[{"version":"1.0.0","date":"2026-08-20","updatedBy":"Tarik Deniz","changes":"Initial draft and verification steps added."},{"version":"1.0.1","date":"2026-08-24","updatedBy":"Tarik Deniz","changes":"Added screenshot notes and migration caveats."}]'::jsonb,
    'Tarik Deniz', 'Tarik Deniz', 'Tarik Deniz',
    '2026-08-24', '2026-08-24'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'WA-G03:v1', 'WA-G03', 1, 'Existing Guide captured as initial version.',
    'How to Resolve a Registered WhatsApp Number', 'Follow the documented solution for Phone Number Already Registered.', 'Verified', 'Medium', '15 min',
    ARRAY['Ensure the client owns the phone number and has it physically available to receive the OTP code.', 'Check if the number is currently registered to a consumer WhatsApp app or another business App.'], ARRAY['Business Portfolio ID (Meta BM)', 'Phone Number (unlocked, ready to receive SMS/voice)', 'WhatsApp Business Account (WABA) Admin access', 'Approved Display Name in Meta BM'], 'Deleting the existing account is destructive. All message history on the consumer device will be lost once migrated to WABA. Meta does not allow backing up consumer messages and restoring them into WABA.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check the existing WhatsApp Business Account","description":"Navigate to Meta Business Manager -> WhatsApp Manager. Under the Phone Numbers tab, check if the phone number is displayed with a status. If it is already registered elsewhere, you will see a warning message that the number belongs to another account.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"You can see the affected phone number status inside the WABA dashboard."},{"number":2,"title":"Delete/Disconnect Old Client Account","description":"If the client is running the number on a consumer WhatsApp App, open the App on the mobile phone -> Settings -> Account -> Delete My Account. If it is registered under another BSP, the client must trigger a migration or sign a consent form.","estimatedTime":"5 min","screenshot":"","importantNote":"Deleting the account can take up to 3 minutes to propagate through Meta''s registers.","successIndicator":"The WhatsApp client on the phone says \"Welcome to WhatsApp\" indicating it is unregistered."},{"number":3,"title":"Trigger Embedded Signup verification","description":"Go to the onboarding dashboard, start the Embedded Signup process again, select the appropriate BM and WABA, and enter the phone number.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"The page proceeds to the OTP verification screen without the \"number already registered\" error."},{"number":4,"title":"Enter Verification OTP","description":"Choose SMS or Voice call for OTP verification. Enter the 6-digit code received on the device.","estimatedTime":"3 min","screenshot":"","importantNote":"","successIndicator":"Number successfully verified. Status changes to \"Connected\" and certificate is generated."}]'::jsonb, '[{"problem":"OTP not received after deleting consumer account","cause":"Meta is rate-limiting SMS requests due to multiple previous triggers.","solution":"Wait 10 minutes and trigger a \"Voice Call\" instead of SMS.","relatedIssue":"WA-002"},{"problem":"Number is locked in a deleted Business Manager","cause":"The client deleted their old Meta Business Manager without removing the WhatsApp number first.","solution":"Open a Meta Support Ticket requesting the release of the phone number from the orphaned WABA ID.","relatedIssue":"META-006"}]'::jsonb, '[{"question":"Can we revert this back to a consumer account?","answer":"Yes, but the number must first be deleted from the WABA account. Once deleted, it can be re-registered on a mobile phone."},{"question":"How long does a BSP migration take?","answer":"If the source BSP approves the release, the migration takes less than 10 minutes. If they do not, it requires manual paperwork taking 2-3 days."}]'::jsonb,
    ARRAY['WA-002', 'WA-003', 'META-006'], 'Ensure the customer understands that their consumer chats will be permanently deleted. Do NOT skip Step 2. Keep customer on line until OTP is verified.',
    '2026-08-24', 'Tarik Deniz',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'WA-G03:v1',
    version_number = 1
WHERE id = 'WA-G03' AND current_version_id IS NULL;

-- Guide: WA-G04
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'WA-G04', 'WA-002', 'whatsapp', NULL, 1,
    'How to resolve: OTP Not Received', 'Follow the documented solution for OTP Not Received.', 'Verified', 'Easy', '5 min',
    ARRAY['Verify phone signal strength', 'Ensure landline can receive direct dial calls if using landline'], ARRAY['Phone number active', 'WABA onboarding access'], 'Do not click "Resend SMS" repeatedly. Meta blocks OTP triggers for 24 hours after 3 failed consecutive attempts.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check phone status","description":"Verify if the phone can receive standard incoming SMS or calls. If it is a virtual number, ensure SMS forwarders are working.","estimatedTime":"1 min","screenshot":"","importantNote":"","successIndicator":"Incoming SMS successfully received from another test phone number."},{"number":2,"title":"Choose Voice OTP alternative","description":"In the OTP modal, click on \"Call me\" or \"Voice Call\" instead of SMS.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Incoming phone call from Meta playing the audio verification code."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    ARRAY['WA-001'], 'Usually caused by roaming issues or local carrier blocks on international SMS.', '[]'::jsonb,
    'Support Team', 'Support Team', 'Support Team',
    '2026-08-25', '2026-08-25'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'WA-G04:v1', 'WA-G04', 1, 'Existing Guide captured as initial version.',
    'How to resolve: OTP Not Received', 'Follow the documented solution for OTP Not Received.', 'Verified', 'Easy', '5 min',
    ARRAY['Verify phone signal strength', 'Ensure landline can receive direct dial calls if using landline'], ARRAY['Phone number active', 'WABA onboarding access'], 'Do not click "Resend SMS" repeatedly. Meta blocks OTP triggers for 24 hours after 3 failed consecutive attempts.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check phone status","description":"Verify if the phone can receive standard incoming SMS or calls. If it is a virtual number, ensure SMS forwarders are working.","estimatedTime":"1 min","screenshot":"","importantNote":"","successIndicator":"Incoming SMS successfully received from another test phone number."},{"number":2,"title":"Choose Voice OTP alternative","description":"In the OTP modal, click on \"Call me\" or \"Voice Call\" instead of SMS.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Incoming phone call from Meta playing the audio verification code."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    ARRAY['WA-001'], 'Usually caused by roaming issues or local carrier blocks on international SMS.',
    '2026-08-25', 'Support Team',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'WA-G04:v1',
    version_number = 1
WHERE id = 'WA-G04' AND current_version_id IS NULL;

-- Guide: WA-G05
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'WA-G05', 'WA-003', 'whatsapp', NULL, 1,
    'How to resolve: Embedded Signup Failed', 'Follow the documented solution for Embedded Signup Failed.', 'Verified', 'Advanced', '20 min',
    ARRAY['Disable all browser extensions and ad blockers.', 'Clear cookies and cache for facebook.com.'], ARRAY['Admin permission on Facebook BM', 'Ad blocker disabled'], 'This is usually caused by browser policy issues or Meta service downtime.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Open in Incognito Mode","description":"Copy the signup URL and paste it in an Incognito / Private window.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Embedded popup displays the Meta login prompt correctly."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Known bug in Safari. Recommend Chrome or Firefox.', '[]'::jsonb,
    'Support Team', 'Support Team', 'Support Team',
    '2026-08-22', '2026-08-22'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'WA-G05:v1', 'WA-G05', 1, 'Existing Guide captured as initial version.',
    'How to resolve: Embedded Signup Failed', 'Follow the documented solution for Embedded Signup Failed.', 'Verified', 'Advanced', '20 min',
    ARRAY['Disable all browser extensions and ad blockers.', 'Clear cookies and cache for facebook.com.'], ARRAY['Admin permission on Facebook BM', 'Ad blocker disabled'], 'This is usually caused by browser policy issues or Meta service downtime.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Open in Incognito Mode","description":"Copy the signup URL and paste it in an Incognito / Private window.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Embedded popup displays the Meta login prompt correctly."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Known bug in Safari. Recommend Chrome or Firefox.',
    '2026-08-22', 'Support Team',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'WA-G05:v1',
    version_number = 1
WHERE id = 'WA-G05' AND current_version_id IS NULL;

-- Guide: META-G01
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'META-G01', 'META-006', 'meta-business', NULL, 1,
    'How to resolve: Business Verification Failed', 'Follow the documented solution for Business Verification Failed.', 'Verified', 'Medium', '15 min',
    ARRAY['Verify that name on invoice matches the Meta Business Portfolio name exactly.'], ARRAY['Official trade license or utility bills', 'Matching Business Name and Address'], 'Documents must be in supported languages or accompanied by official English translations.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check rejection details","description":"Go to Meta Business Suite -> Settings -> Business Info -> Business Portfolio Info. Check the exact reason for rejection.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Understand if rejection was due to address mismatch, name mismatch, or invalid ID."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Ensure the utility bill is less than 3 months old.', '[]'::jsonb,
    'Support Team', 'Support Team', 'Support Team',
    '2026-08-20', '2026-08-20'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'META-G01:v1', 'META-G01', 1, 'Existing Guide captured as initial version.',
    'How to resolve: Business Verification Failed', 'Follow the documented solution for Business Verification Failed.', 'Verified', 'Medium', '15 min',
    ARRAY['Verify that name on invoice matches the Meta Business Portfolio name exactly.'], ARRAY['Official trade license or utility bills', 'Matching Business Name and Address'], 'Documents must be in supported languages or accompanied by official English translations.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check rejection details","description":"Go to Meta Business Suite -> Settings -> Business Info -> Business Portfolio Info. Check the exact reason for rejection.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Understand if rejection was due to address mismatch, name mismatch, or invalid ID."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Ensure the utility bill is less than 3 months old.',
    '2026-08-20', 'Support Team',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'META-G01:v1',
    version_number = 1
WHERE id = 'META-G01' AND current_version_id IS NULL;

-- Guide: ZOOM-G01
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'ZOOM-G01', 'ZOOM-002', 'zoom', NULL, 1,
    'How to resolve: Zoom Meeting Not Starting', 'Follow the documented solution for Zoom Meeting Not Starting.', 'Verified', 'Easy', '5 min',
    ARRAY['Check if integration is toggled on in Settings.'], ARRAY['Zoom Account Connected', 'API Keys refreshed'], 'The customer may need to re-authorize the OAuth connection.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Disconnect and Reconnect Zoom","description":"Navigate to Integrations -> Zoom. Click \"Disconnect\", then click \"Connect with Zoom\" to authenticate again.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Zoom OAuth window redirects back to CRM successfully."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Most common cause is an expired Zoom access token.', '[]'::jsonb,
    'Support Team', 'Support Team', 'Support Team',
    '2026-08-25', '2026-08-25'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'ZOOM-G01:v1', 'ZOOM-G01', 1, 'Existing Guide captured as initial version.',
    'How to resolve: Zoom Meeting Not Starting', 'Follow the documented solution for Zoom Meeting Not Starting.', 'Verified', 'Easy', '5 min',
    ARRAY['Check if integration is toggled on in Settings.'], ARRAY['Zoom Account Connected', 'API Keys refreshed'], 'The customer may need to re-authorize the OAuth connection.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Disconnect and Reconnect Zoom","description":"Navigate to Integrations -> Zoom. Click \"Disconnect\", then click \"Connect with Zoom\" to authenticate again.","estimatedTime":"2 min","screenshot":"","importantNote":"","successIndicator":"Zoom OAuth window redirects back to CRM successfully."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Most common cause is an expired Zoom access token.',
    '2026-08-25', 'Support Team',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'ZOOM-G01:v1',
    version_number = 1
WHERE id = 'ZOOM-G01' AND current_version_id IS NULL;

-- Guide: WA-G01
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'WA-G01', 'WA-004', 'whatsapp', NULL, 1,
    'How to migrate WhatsApp Business from another BSP', 'Detailed instructions explaining how to transfer a WhatsApp Business phone number from an external BSP (Business Solution Provider) like Twilio or Wati to Iceberg Digital''s Meta Business account.', 'Verified', 'Medium', '20 min',
    ARRAY['Check if source BSP has any contract locks.', 'Disable any active auto-reply bots on the source number.'], ARRAY['Phone number active', 'Access to source BSP', 'WABA Admin Access on target WABA'], 'No message history will be migrated. Template messages must be recreated on the new WABA.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Obtain migration consent","description":"Verify client has signed off and owns the number. Get source WABA ID.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Migration consent documented."},{"number":2,"title":"Initiate migration in WhatsApp Manager","description":"Navigate to WhatsApp Manager -> Phone Numbers -> Migrate. Enter the phone number and source WABA ID.","estimatedTime":"10 min","screenshot":"","importantNote":"","successIndicator":"Migration status pending OTP verification."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    ARRAY['WA-001'], 'Ensure the customer understands templates do not migrate.', '[]'::jsonb,
    'Tarik Deniz', 'Tarik Deniz', 'Tarik Deniz',
    '2026-08-21', '2026-08-21'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'WA-G01:v1', 'WA-G01', 1, 'Existing Guide captured as initial version.',
    'How to migrate WhatsApp Business from another BSP', 'Detailed instructions explaining how to transfer a WhatsApp Business phone number from an external BSP (Business Solution Provider) like Twilio or Wati to Iceberg Digital''s Meta Business account.', 'Verified', 'Medium', '20 min',
    ARRAY['Check if source BSP has any contract locks.', 'Disable any active auto-reply bots on the source number.'], ARRAY['Phone number active', 'Access to source BSP', 'WABA Admin Access on target WABA'], 'No message history will be migrated. Template messages must be recreated on the new WABA.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Obtain migration consent","description":"Verify client has signed off and owns the number. Get source WABA ID.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Migration consent documented."},{"number":2,"title":"Initiate migration in WhatsApp Manager","description":"Navigate to WhatsApp Manager -> Phone Numbers -> Migrate. Enter the phone number and source WABA ID.","estimatedTime":"10 min","screenshot":"","importantNote":"","successIndicator":"Migration status pending OTP verification."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    ARRAY['WA-001'], 'Ensure the customer understands templates do not migrate.',
    '2026-08-21', 'Tarik Deniz',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'WA-G01:v1',
    version_number = 1
WHERE id = 'WA-G01' AND current_version_id IS NULL;

-- Guide: WA-G02
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'WA-G02', 'WA-005', 'whatsapp', NULL, 1,
    'How to configure a new WhatsApp number', 'Standard onboarding workflow for setting up a brand new, clean phone number for a customer''s WhatsApp Business API.', 'Verified', 'Easy', '10 min',
    ARRAY['Ensure the number can receive external SMS.'], ARRAY['Brand new number', 'WABA Admin Access'], 'Do not use a number that is currently used on a mobile phone.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Add to WABA","description":"Go to WABA -> Phone Numbers -> Add Phone Number. Fill out display name and category.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Number shows in WABA as pending verification."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Ensure display name matches branding guidelines.', '[]'::jsonb,
    'Support Team', 'Support Team', 'Support Team',
    '2026-08-25', '2026-08-25'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'WA-G02:v1', 'WA-G02', 1, 'Existing Guide captured as initial version.',
    'How to configure a new WhatsApp number', 'Standard onboarding workflow for setting up a brand new, clean phone number for a customer''s WhatsApp Business API.', 'Verified', 'Easy', '10 min',
    ARRAY['Ensure the number can receive external SMS.'], ARRAY['Brand new number', 'WABA Admin Access'], 'Do not use a number that is currently used on a mobile phone.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Add to WABA","description":"Go to WABA -> Phone Numbers -> Add Phone Number. Fill out display name and category.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Number shows in WABA as pending verification."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Ensure display name matches branding guidelines.',
    '2026-08-25', 'Support Team',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'WA-G02:v1',
    version_number = 1
WHERE id = 'WA-G02' AND current_version_id IS NULL;

-- Guide: LIFE-G01
INSERT INTO public.guides (
    id, issue_id, playbook_id, current_version_id, version_number,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    revision_history, author, created_by, updated_by, created_at, updated_at
) VALUES (
    'LIFE-G01', 'LIFE-003', 'lifesycle', NULL, 1,
    'Property matching issue configuration', 'Guide for diagnosing why certain property listings fail to match with leads in the Lifesycle integration.', 'Verified', 'Medium', '15 min',
    ARRAY['Obtain the ID of the property and lead that failed to match.'], ARRAY['Lifesycle Admin permissions', 'Lead criteria log'], 'Check budget buffer sizes in Lifesycle settings.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check budget criteria","description":"Compare lead budget max to property asking price. Ensure it falls within the tolerance limit.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Tolerance match verified."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Most match failures are due to location radius boundary settings.', '[]'::jsonb,
    'Support Team', 'Support Team', 'Support Team',
    '2026-08-15', '2026-08-15'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.guide_versions (
    id, guide_id, version_number, change_summary,
    title, summary, status, difficulty, estimated_time,
    before_you_start, requirements, important_information,
    video, video_storage_key, pdf, pdf_storage_key,
    steps, common_problems, faq, related_items, internal_notes,
    created_at, created_by, restored_from_version_id
) VALUES (
    'LIFE-G01:v1', 'LIFE-G01', 1, 'Existing Guide captured as initial version.',
    'Property matching issue configuration', 'Guide for diagnosing why certain property listings fail to match with leads in the Lifesycle integration.', 'Verified', 'Medium', '15 min',
    ARRAY['Obtain the ID of the property and lead that failed to match.'], ARRAY['Lifesycle Admin permissions', 'Lead criteria log'], 'Check budget buffer sizes in Lifesycle settings.',
    '', NULL, '', NULL,
    '[{"number":1,"title":"Check budget criteria","description":"Compare lead budget max to property asking price. Ensure it falls within the tolerance limit.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Tolerance match verified."}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '{}', 'Most match failures are due to location radius boundary settings.',
    '2026-08-15', 'Support Team',
    NULL
) ON CONFLICT (id) DO NOTHING;
UPDATE public.guides
SET current_version_id = 'LIFE-G01:v1',
    version_number = 1
WHERE id = 'LIFE-G01' AND current_version_id IS NULL;

-- 4. SEED SOPS
INSERT INTO public.sops (
    id, playbook_id, title, owner, status, estimated_time,
    purpose, when_to_use, requirements, responsible_team,
    checklist, steps, escalation_rules, completion_criteria,
    related_issues, related_guides, internal_notes, revision_history,
    created_at, updated_at
) VALUES (
    'WA-SOP01', 'whatsapp', 'WhatsApp Customer Onboarding Process', 'Onboarding Team',
    'Verified', '45 min', 'Standardize the customer onboarding flow when introducing them to the WhatsApp Business API.', 'Use this SOP every time a customer upgrades their subscription to include the WhatsApp Business channel.',
    ARRAY['Meta Business Manager Admin permissions', 'Verified customer email address', 'Credit card for Meta billing (if high volume)'], 'Support & Onboarding Team', ARRAY['Customer information received', 'Business verification checked', 'WABA setup completed', 'Phone verification completed', 'Embedded Signup triggered', 'Testing & sign-off completed'],
    '[{"number":1,"title":"Verify customer contract details","description":"Ensure the client has signed the WhatsApp Addendum and provided their Facebook Business ID.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Facebook ID matched to Salesforce record."},{"number":2,"title":"Trigger Meta Business Invitation","description":"Send WABA ownership invitation from our partner dashboard to client BM.","estimatedTime":"10 min","screenshot":"","importantNote":"","successIndicator":"Client BM displays invitation under requests."},{"number":3,"title":"Assist customer with Embedded Signup","description":"Guide customer through the Embedded Signup flow to link their phone number and select display name.","estimatedTime":"15 min","screenshot":"","importantNote":"","successIndicator":"WABA created successfully."},{"number":4,"title":"Send initial test WhatsApp message","description":"Trigger a welcome template message from CRM to customer''s personal number to confirm outbound is working.","estimatedTime":"5 min","screenshot":"","importantNote":"","successIndicator":"Customer replies \"Received\"."}]'::jsonb, 'If business verification fails more than twice, escalate to the Compliance Officer. If OTP fails for 24 hours, escalate to the WhatsApp Lead Support.', 'Onboarding is complete when the WhatsApp number status is "Connected", display name is approved, and the welcome message is successfully received and replied to.',
    ARRAY['WA-001', 'WA-002', 'WA-003'], ARRAY['WA-G02'], 'Ensure Meta billing credentials are set up if they plan to send over 1,000 marketing messages per month.',
    '[]'::jsonb, NOW(), '2026-08-25'
) ON CONFLICT (id) DO NOTHING;

