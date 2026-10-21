-- =====================================================================
-- Approval route: the System Service steps go to people picked in Admin
-- (replaces matching them by position within one "System Service department")
-- =====================================================================
INSERT IGNORE INTO app_settings(`key`, value, description) VALUES
  ('approval_route_approvers', '{}', 'Picked approver (profile id) per fixed approval step: ss_receive, ss_gm_approve, ss_fm_approve, final_approve');

DELETE FROM app_settings WHERE `key` = 'system_service_department';
