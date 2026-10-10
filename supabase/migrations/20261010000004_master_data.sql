-- =====================================================================
-- Master data & configuration defaults (editable in Admin)
-- =====================================================================
insert into public.app_settings(key, value, description) values
  ('project_code_format', '"SYS-{TYPE}-{YYYY}-{SEQ:3}"', 'Tokens: {TYPE} {YYYY} {YY} {SEQ:n}'),
  ('request_no_format',   '"REQ-SYS-{YYYY}-{SEQ:4}"',    'Tokens: {YYYY} {YY} {SEQ:n}')
on conflict (key) do nothing;

insert into public.project_types(code, name) values
  ('APP',   'Internal Application'),
  ('WEB',   'Web Development'),
  ('INFRA', 'Infrastructure'),
  ('AUTO',  'Automation'),
  ('ERP',   'ERP Enhancement'),
  ('SUP',   'Support Improvement')
on conflict (code) do nothing;

insert into public.project_templates(code, name, project_type_id, description, default_activities, evidence_checklist) values
('WEB_DEV', 'Web Development', (select id from public.project_types where code = 'WEB'),
 'Standard web / application development lifecycle',
 '[
   {"name":"Requirement","pic_label":"System","duration_days":5,"tasks":[
      {"name":"Requirement workshop","task_type":"design","duration_days":2},
      {"name":"Requirement document","task_type":"doc","duration_days":3}]},
   {"name":"Design","pic_label":"System","duration_days":5,"tasks":[
      {"name":"Design Database","task_type":"design","duration_days":3},
      {"name":"UI / Flow design","task_type":"design","duration_days":2}]},
   {"name":"Development","pic_label":"System","duration_days":15,"tasks":[
      {"name":"Develop Backend API","task_type":"dev","duration_days":7},
      {"name":"Develop Frontend","task_type":"dev","duration_days":6},
      {"name":"Unit Test","task_type":"qa","duration_days":1},
      {"name":"Code Review","task_type":"review","duration_days":1}]},
   {"name":"System Test (QA)","pic_label":"System","duration_days":5,"tasks":[
      {"name":"Test Round 1","task_type":"qa","duration_days":3},
      {"name":"FM-SYS-007 Test Result","task_type":"doc","duration_days":2}]},
   {"name":"UAT","pic_label":"User","duration_days":5},
   {"name":"Go-live","pic_label":"System","duration_days":1,"is_milestone":true,"tasks":[
      {"name":"Deployment","task_type":"deploy","duration_days":1}]},
   {"name":"Closure","pic_label":"System","duration_days":2}
 ]'::jsonb,
 '["Approved Request","Requirement","Design","Unit Test","FM-SYS-007 Test Result","Screenshot","UAT Result","Deployment Evidence","User Acceptance","Closure Document"]'::jsonb),
('INTERNAL_APP', 'Internal Application', (select id from public.project_types where code = 'APP'),
 'Internal tool / small application',
 '[
   {"name":"Requirement","pic_label":"System","duration_days":3},
   {"name":"Development","pic_label":"System","duration_days":10,"tasks":[
      {"name":"Develop","task_type":"dev","duration_days":8},
      {"name":"Unit Test","task_type":"qa","duration_days":2}]},
   {"name":"UAT","pic_label":"User","duration_days":3},
   {"name":"Go-live","pic_label":"System","duration_days":1,"is_milestone":true}
 ]'::jsonb, '[]'::jsonb),
('INFRA', 'Infrastructure', (select id from public.project_types where code = 'INFRA'),
 'Infrastructure / network / server work',
 '[
   {"name":"Survey & Requirement","pic_label":"System","duration_days":3},
   {"name":"Procurement","pic_label":"Vendor","duration_days":10},
   {"name":"Installation & Configuration","pic_label":"System","duration_days":5,"tasks":[
      {"name":"Install","task_type":"deploy","duration_days":3},
      {"name":"Configure","task_type":"deploy","duration_days":2}]},
   {"name":"Testing","pic_label":"System","duration_days":3},
   {"name":"Handover","pic_label":"System","duration_days":1,"is_milestone":true}
 ]'::jsonb, '[]'::jsonb),
('AUTOMATION', 'Automation', (select id from public.project_types where code = 'AUTO'),
 'RPA / script / process automation',
 '[
   {"name":"Process Analysis","pic_label":"System","duration_days":3},
   {"name":"Development","pic_label":"System","duration_days":7},
   {"name":"Testing","pic_label":"System","duration_days":3},
   {"name":"UAT","pic_label":"User","duration_days":3},
   {"name":"Go-live","pic_label":"System","duration_days":1,"is_milestone":true}
 ]'::jsonb, '[]'::jsonb),
('ERP_ENH', 'ERP Enhancement', (select id from public.project_types where code = 'ERP'),
 'ERP customization / enhancement',
 '[
   {"name":"Requirement","pic_label":"System","duration_days":5},
   {"name":"Development","pic_label":"System","duration_days":10},
   {"name":"System Test (QA)","pic_label":"System","duration_days":5},
   {"name":"UAT","pic_label":"User","duration_days":5},
   {"name":"Go-live","pic_label":"System","duration_days":1,"is_milestone":true}
 ]'::jsonb, '[]'::jsonb),
('SUPPORT_IMP', 'Support Improvement', (select id from public.project_types where code = 'SUP'),
 'Improvement of existing support process',
 '[
   {"name":"Analysis","pic_label":"System","duration_days":3},
   {"name":"Implementation","pic_label":"System","duration_days":5},
   {"name":"Verification","pic_label":"User","duration_days":2}
 ]'::jsonb, '[]'::jsonb)
on conflict (code) do nothing;

insert into public.notification_rules(event_code, name, recipient_roles, channels, escalation_days) values
  ('approval_waiting',          'Approval waiting for action',      array['explicit'],                                   array['in_app','email'], null),
  ('request_approved',          'Request approved',                 array['explicit'],                                   array['in_app','email'], null),
  ('request_reject',            'Request rejected',                 array['explicit'],                                   array['in_app','email'], null),
  ('request_send_back',         'Request sent back',                array['explicit'],                                   array['in_app','email'], null),
  ('request_request_more_info', 'More information requested',       array['explicit'],                                   array['in_app','email'], null),
  ('project_converted',         'Project created from request',     array['explicit','leader'],                          array['in_app','email'], null),
  ('baseline_set',              'Baseline set',                     array['leader','supervisor','manager'],              array['in_app'],         null),
  ('task_assigned',             'Assigned Task',                    array['explicit'],                                   array['in_app','email'], null),
  ('task_due_tomorrow',         'Task due tomorrow',                array['explicit','supervisor'],                      array['in_app','email'], null),
  ('task_overdue',              'Task overdue (escalation)',        array['explicit','leader','supervisor'],             array['in_app','email'], 2),
  ('activity_delayed',          'Activity Delayed',                 array['explicit','leader','supervisor'],             array['in_app','email'], null),
  ('project_need_attention',    'Project Need Attention',           array['explicit','leader','supervisor','manager'],   array['in_app','email'], null)
on conflict (event_code) do nothing;

-- Hourly scan (local Supabase ships pg_cron)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('pcw-notification-scan', '0 * * * *', 'select public.run_notification_scan()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;
