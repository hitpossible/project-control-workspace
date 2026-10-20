-- =====================================================================
-- Master data & configuration defaults (editable in Admin)
-- =====================================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO app_settings(`key`, value, description) VALUES
  ('project_code_format', '"SYS-{TYPE}-{YYYY}-{SEQ:3}"', 'Tokens: {TYPE} {YYYY} {YY} {SEQ:n}'),
  ('request_no_format',   '"REQ-SYS-{YYYY}-{SEQ:4}"',    'Tokens: {YYYY} {YY} {SEQ:n}'),
  ('kpi_excluded_delay_categories', '["Waiting User","Vendor","Approval Delay","Requirement Change"]',
   'Late tasks with these delay categories are excused from individual on-time KPI (PRD §23 fairness)'),
  ('system_service_department', '"SYSTEM"', 'Department that receives requests (Received Request By / Approved Request By GM)');

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

INSERT IGNORE INTO notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) VALUES
  ('comment_mention', 'Mentioned in a comment',               '["explicit"]', '["in_app","email"]', NULL, NULL, '[]'),
  ('comment_added',   'New comment on my Task / Bug',         '["explicit"]', '["in_app"]',         NULL, NULL, '[]');

-- ---------------------------------------------------------------------
-- Company organisation: departments, sections, positions
-- (matched by name against AD at login — keep names as AD sends them)
-- ---------------------------------------------------------------------
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (1,'K1AC00','ACCOUNT & FINANCIAL',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (2,'K1GA00','GENERAL ADMINISTRATION',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (3,'K1BM00','BUSINESS MANAGEMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (4,'K1IT00','INFORMATION TECHNOLOGY',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (5,'K1SS00','SYSTEM',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (6,'K1EE00','EMPLOYEE EXPERIENCE ENGAGEMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (7,'K1EX00','EXECUTIVE',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (8,'K1CG00','CORPORATE GOVERNANCE',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (9,'K1IC00','INTERNAL CONTROL',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (10,'K1MA01','MANUFACTURING 1',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (11,'K1PD01','PRODUCTION 1',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (12,'K1PD02','PRODUCTION 2',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (13,'K1PD05','PRODUCTION 5',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (14,'K1TP00','TBKK PRODUCTION SYSTEM',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (15,'K1GC00','GRAVITY DIE CASTING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (16,'K1MA02','MANUFACTURING 2',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (17,'K1PD03','PRODUCTION 3',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (18,'K1MA03','MANUFACTURING 3',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (19,'K1PD07','PRODUCTION 7',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (20,'K1ND00','NEW BUSINESS DEVELOPMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (21,'K1OV00','OVERSEA TRAINING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (22,'K1PJ00','PROJECT CONTROL',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (23,'K1PU00','PURCHASING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (24,'K1QC00','QUALITY CONTROL',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (25,'K1QI00','QUALITY IMPROVEMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (26,'K1TL00','TOOLING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (27,'K1QA00','QUALITY ASSURANCE',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (28,'K1RD00','RESEARCH & DEVELOPMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (29,'K1SC00','SUPPLY CHAIN MANAGEMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (30,'K1SH00','SAFETY HEALTH & ENVIRONMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (31,'K1SM00','SALES & MARKETING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (32,'K1CE00','CASTING ENGINEERING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (33,'K1MN00','MAINTENANCE',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (34,'K1PE00','PRODUCTION ENGINEERING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (35,'K1TE00','TECHNOLOGY ENGINEERING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (36,'K2MA03','MANUFACTURING 3',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (37,'K2PE00','PRODUCTION ENGINEERING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (38,'K2QA00','QUALITY ASSURANCE',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (39,'K2QC00','QUALITY CONTROL',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (40,'K2SC00','SUPPLY CHAIN MANAGEMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (41,'M1AM00','ADMINISTRATIVE',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (42,'M1MA00','MANUFACTURING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (43,'M1PU00','PURCHASE',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (44,'M1QC00','QUALITY CONTROL',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (45,'M1RD00','RESEARCH&DEVELOPMENT',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (46,'M1SM00','SALES & MARKETING',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (47,'O1GA00','GENERAL ADMINISTRATION',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (48,'K2PD06','PRODUCTION 6',1);
INSERT IGNORE INTO `departments` (`id`, `code`, `name`, `is_active`) VALUES (49,'K1PD04','PRODUCTION 4',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (1,1,'K1AC00','ACC',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (2,1,'K1FN00','FN',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (3,2,'K1GA00','GA',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (4,2,'O1DV00','DRIVER',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (5,2,'O1MD00','MAID',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (6,3,'K1CM00','CM',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (7,4,'K1IT00','IT',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (8,5,'K1SS00','SYS',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (9,6,'K1ED00','EED',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (10,6,'K1EE00','EEE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (11,6,'K1EG00','EEG',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (12,6,'K1EM00','EEM',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (13,7,'K1EX00','EXE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (14,8,'K1CG00','CG',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (15,9,'K1CG00','CG',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (16,9,'K1QS00','QMS',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (17,10,'K1MA01','MA1',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (18,11,'K1A000','PD1',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (19,11,'K1B000','PD1B',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (20,12,'K1M000','PD2',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (21,13,'K1F000','PD5F',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (22,13,'K1G000','PD5G',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (23,14,'K1TP00','TPS',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (24,15,'K1GC00','GDC',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (25,16,'K1MA02','MA2',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (26,17,'K1CH00','PD3C',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (27,18,'K1MA03','MA3',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (28,19,'K1C000','PD7G',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (29,19,'K1I000','PD7B',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (30,19,'K1T000','PD7T',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (31,20,'K1ND00','ND',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (32,21,'K1OV00','OVT',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (33,22,'K1PJ00','PJC',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (34,23,'K1PU00','PUR',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (35,23,'K1SQ00','SQE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (36,24,'K1QC00','QC',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (37,24,'K1QG00','QG',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (38,25,'K1FC00','FC',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (39,25,'K1QI00','QI',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (40,26,'K1TL00','TL',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (41,27,'K1QA00','QA',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (42,28,'K1RD00','RD',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (43,29,'K1LG00','LG',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (44,29,'K1PS00','PC',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (45,29,'K1SC00','SCM',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (46,30,'K1SH00','SHE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (47,31,'K1SM00','SM',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (48,32,'K1CE00','CE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (49,33,'K1MN00','MTN',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (50,33,'K1UT00','UT',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (51,34,'K1PE00','PE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (52,35,'K1TE00','TE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (53,36,'K2MA03','MA3',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (54,37,'K2MN00','MTN',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (55,37,'K2PE00','PE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (56,37,'K2TL00','TL',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (57,38,'K2QA00','QA',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (58,39,'K2QC00','QC',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (59,39,'K2QG00','QG',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (60,40,'K2SC00','SCM',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (61,41,'M1AM00','ADM',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (62,42,'M1MA00','MANUFACTURING',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (63,42,'M1MOA0','MOLD ASSY',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (64,42,'M1MOM0','MOLD MAKING',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (65,43,'M1PU00','PURCHASE',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (66,44,'M1QC00','QUALITY CONTROL',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (67,45,'M1RD00','DESIGN',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (68,46,'M1SM00','SALE&MARKETING',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (69,47,'K1GA00','GA',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (70,47,'O1DV00','DRIVER',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (71,47,'O1MD00','MAID',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (72,47,'O1SC00','SECURITY',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (73,48,'K2M000','PD6',1);
INSERT IGNORE INTO `sections` (`id`, `department_id`, `code`, `name`, `is_active`) VALUES (74,49,'K1D000','PD4',1);
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (1,'ASSISTANT GENERAL MANAGER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (2,'ASSISTANT MANAGER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (3,'DIRECTOR');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (17,'DRIVER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (18,'ENGINEER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (4,'EXECUTIVE DIRECTOR');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (19,'EXPERT');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (5,'FACTORY MANAGER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (6,'GENERAL MANAGER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (7,'GROUP LEADER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (20,'MAID');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (8,'MANAGER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (9,'MANAGING DIRECTOR');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (21,'NURSE');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (22,'OFFICER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (10,'PRESIDENT');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (11,'SECTION CHIEF');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (23,'SECURITY');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (12,'SECURITY SUPERVISOR');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (13,'SENIOR ENGINEER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (14,'SENIOR OFFICER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (24,'SKILL TECHNICIAN');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (25,'SKILL WORKER');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (32,'SPECIALIST');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (26,'STAFF');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (27,'STUDENT');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (28,'STUDENT (INTERNSHIP)');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (33,'STUDENT (PROJECT)');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (29,'SUBCONTRACT');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (15,'SUPERVISOR');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (30,'TECHNICIAN');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (16,'UNIT CHIEF');
INSERT IGNORE INTO `positions` (`id`, `name`) VALUES (31,'WORKER');
