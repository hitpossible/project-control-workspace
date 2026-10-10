-- =====================================================================
-- Master data & configuration defaults (editable in Admin)
-- =====================================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO app_settings(`key`, value, description) VALUES
  ('project_code_format', '"SYS-{TYPE}-{YYYY}-{SEQ:3}"', 'Tokens: {TYPE} {YYYY} {YY} {SEQ:n}'),
  ('request_no_format',   '"REQ-SYS-{YYYY}-{SEQ:4}"',    'Tokens: {YYYY} {YY} {SEQ:n}'),
  ('kpi_excluded_delay_categories', '["Waiting User","Vendor","Approval Delay","Requirement Change"]',
   'Late tasks with these delay categories are excused from individual on-time KPI (PRD §23 fairness)');

INSERT IGNORE INTO project_types(code, name) VALUES
  ('APP',   'Internal Application'),
  ('WEB',   'Web Development'),
  ('INFRA', 'Infrastructure'),
  ('AUTO',  'Automation'),
  ('ERP',   'ERP Enhancement'),
  ('SUP',   'Support Improvement');

INSERT IGNORE INTO project_templates(code, name, project_type_id, description, default_activities, evidence_checklist) VALUES
('WEB_DEV', 'Web Development', (SELECT id FROM project_types WHERE code = 'WEB'),
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
 ]',
 '[
  {"name":"Approved Request","activity":"Requirement"},
  {"name":"Requirement Document","activity":"Requirement"},
  {"name":"Design Document","activity":"Design"},
  {"name":"Unit Test Log","activity":"Development"},
  {"name":"FM-SYS-007 Test Result","activity":"System Test (QA)"},
  {"name":"Test Screenshot","activity":"System Test (QA)","mandatory":false},
  {"name":"UAT Result","activity":"UAT"},
  {"name":"User Acceptance","activity":"UAT"},
  {"name":"Deployment Evidence","activity":"Go-live"},
  {"name":"Closure Document","activity":"Closure"}
 ]'),
('INTERNAL_APP', 'Internal Application', (SELECT id FROM project_types WHERE code = 'APP'),
 'Internal tool / small application',
 '[
   {"name":"Requirement","pic_label":"System","duration_days":3},
   {"name":"Development","pic_label":"System","duration_days":10,"tasks":[
      {"name":"Develop","task_type":"dev","duration_days":8},
      {"name":"Unit Test","task_type":"qa","duration_days":2}]},
   {"name":"UAT","pic_label":"User","duration_days":3},
   {"name":"Go-live","pic_label":"System","duration_days":1,"is_milestone":true}
 ]',
 '[
  {"name":"Requirement Document","activity":"Requirement"},
  {"name":"Unit Test Log","activity":"Development"},
  {"name":"UAT Result","activity":"UAT"},
  {"name":"Deployment Evidence","activity":"Go-live"}
 ]'),
('INFRA', 'Infrastructure', (SELECT id FROM project_types WHERE code = 'INFRA'),
 'Infrastructure / network / server work',
 '[
   {"name":"Survey & Requirement","pic_label":"System","duration_days":3},
   {"name":"Procurement","pic_label":"Vendor","duration_days":10},
   {"name":"Installation & Configuration","pic_label":"System","duration_days":5,"tasks":[
      {"name":"Install","task_type":"deploy","duration_days":3},
      {"name":"Configure","task_type":"deploy","duration_days":2}]},
   {"name":"Testing","pic_label":"System","duration_days":3},
   {"name":"Handover","pic_label":"System","duration_days":1,"is_milestone":true}
 ]',
 '[
  {"name":"Survey Report","activity":"Survey & Requirement"},
  {"name":"Installation Checklist","activity":"Installation & Configuration"},
  {"name":"Test Report","activity":"Testing"},
  {"name":"Handover Document","activity":"Handover"}
 ]'),
('AUTOMATION', 'Automation', (SELECT id FROM project_types WHERE code = 'AUTO'),
 'RPA / script / process automation',
 '[
   {"name":"Process Analysis","pic_label":"System","duration_days":3},
   {"name":"Development","pic_label":"System","duration_days":7},
   {"name":"Testing","pic_label":"System","duration_days":3},
   {"name":"UAT","pic_label":"User","duration_days":3},
   {"name":"Go-live","pic_label":"System","duration_days":1,"is_milestone":true}
 ]', '[]'),
('ERP_ENH', 'ERP Enhancement', (SELECT id FROM project_types WHERE code = 'ERP'),
 'ERP customization / enhancement',
 '[
   {"name":"Requirement","pic_label":"System","duration_days":5},
   {"name":"Development","pic_label":"System","duration_days":10},
   {"name":"System Test (QA)","pic_label":"System","duration_days":5},
   {"name":"UAT","pic_label":"User","duration_days":5},
   {"name":"Go-live","pic_label":"System","duration_days":1,"is_milestone":true}
 ]', '[]'),
('SUPPORT_IMP', 'Support Improvement', (SELECT id FROM project_types WHERE code = 'SUP'),
 'Improvement of existing support process',
 '[
   {"name":"Analysis","pic_label":"System","duration_days":3},
   {"name":"Implementation","pic_label":"System","duration_days":5},
   {"name":"Verification","pic_label":"User","duration_days":2}
 ]', '[]');

INSERT IGNORE INTO notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) VALUES
  ('approval_waiting',           'Approval waiting for action',      '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('request_approved',           'Request approved',                 '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('request_reject',             'Request rejected',                 '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('request_send_back',          'Request sent back',                '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('request_request_more_info',  'More information requested',       '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('project_converted',          'Project created from request',     '["explicit","leader"]',                        '["in_app","email"]', NULL, NULL, '[]'),
  ('baseline_set',               'Baseline set',                     '["leader","supervisor","manager"]',            '["in_app"]',         NULL, NULL, '[]'),
  ('task_assigned',              'Assigned Task',                    '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('task_due_tomorrow',          'Task due tomorrow',                '["explicit","supervisor"]',                    '["in_app","email"]', NULL, NULL, '[]'),
  ('task_overdue',               'Task overdue (escalation)',        '["explicit","leader","supervisor"]',           '["in_app","email"]', 2,    3,    '["manager"]'),
  ('activity_delayed',           'Activity Delayed',                 '["explicit","leader","supervisor"]',           '["in_app","email"]', NULL, NULL, '[]'),
  ('project_need_attention',     'Project Need Attention',           '["explicit","leader","supervisor","manager"]', '["in_app","email"]', NULL, NULL, '[]'),
  ('bug_reported',               'Bug Report Sent',                  '["explicit","supervisor","manager"]',          '["in_app","email"]', NULL, NULL, '[]'),
  ('bug_assigned',               'Bug assigned to developer',        '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('fix_due_tomorrow',           'Fix Due Tomorrow',                 '["explicit","supervisor"]',                    '["in_app","email"]', NULL, NULL, '[]'),
  ('fix_overdue',                'Fix Overdue (escalation)',         '["explicit","leader"]',                        '["in_app","email"]', 1,    3,    '["manager"]'),
  ('fix_ready',                  'Fix Ready → Tester / QA',          '["explicit","qa"]',                            '["in_app","email"]', NULL, NULL, '[]'),
  ('retest_due',                 'Retest Due',                       '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('retest_failed',              'Retest failed → bug reopened',     '["explicit","leader"]',                        '["in_app","email"]', NULL, NULL, '[]'),
  ('bug_closed',                 'Bug closed after retest',          '["explicit"]',                                 '["in_app"]',         NULL, NULL, '[]'),
  ('evidence_missing',           'Evidence Missing',                 '["explicit"]',                                 '["in_app","email"]', NULL, NULL, '[]'),
  ('baseline_revision_requested','Baseline revision requested',      '["explicit","manager","supervisor"]',          '["in_app","email"]', NULL, NULL, '[]'),
  ('baseline_revision_decided',  'Baseline revision decided',        '["explicit","leader"]',                        '["in_app","email"]', NULL, NULL, '[]');

INSERT IGNORE INTO insight_rules(code, name, description, severity, threshold, threshold_label, internal) VALUES
  ('no_target_date',       'No Required / Target Date',        'Active project without target date',                          'warning',  NULL, NULL, 0),
  ('no_leader',            'No Project Leader',                'Project has no leader',                                        'critical', NULL, NULL, 0),
  ('no_next_action',       'No Next Action',                   'Project or in-progress activity without next action',          'info',     NULL, NULL, 0),
  ('waiting_too_long',     'Waiting too long',                 'Activity / project in Waiting or On Hold longer than X days',  'warning',  7,    'days', 0),
  ('forecast_vs_baseline', 'Forecast exceeds Baseline',        'Forecast finish later than baseline by more than X days',      'warning',  0,    'days', 0),
  ('activity_overdue',     'Activity overdue',                 'Activity past plan finish and not completed',                  'warning',  NULL, NULL, 0),
  ('delay_no_recovery',    'Delay without Recovery Plan',      'Delayed / overdue activity without a recovery plan',           'critical', NULL, NULL, 0),
  ('recovery_not_reviewed','Recovery plan not reviewed',       'Recovery plan not reviewed by Supervisor/Manager within X days','info',    3,    'days', 0),
  ('evidence_missing',     'Mandatory evidence missing',       'Mandatory checklist items missing for finished / due items',   'warning',  NULL, NULL, 0),
  ('progress_stale',       'Progress not updated',             'In-progress activity not updated for more than X days',        'info',     7,    'days', 0),
  ('too_many_reschedules', 'Rescheduled too many times',       'Baseline revised more than X times',                           'warning',  2,    'revisions', 0),
  ('no_baseline',          'No baseline',                      'Project still without Baseline V1 after X days',               'warning',  14,   'days', 0),
  ('critical_bug_open',    'Critical bug open',                'Critical bug not closed',                                      'critical', NULL, NULL, 1),
  ('fix_overdue',          'Bug fix overdue',                  'Bug fix past due date',                                        'warning',  NULL, NULL, 1),
  ('retest_overdue',       'Retest overdue',                   'Retest past due date',                                         'warning',  NULL, NULL, 1),
  ('member_overloaded',    'Member overloaded',                'Person with more than X open tasks + bugs',                    'info',     8,    'open items', 1),
  ('owner_on_leave',       'Owner on leave on due date',       'Task owner / PIC planned leave on the due date (next X days)', 'warning',  14,   'days ahead', 1);
