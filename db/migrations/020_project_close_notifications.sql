-- =====================================================================
-- Tell the requestor and the team when a project is closed as completed or cancelled
-- (sent by the projects afterUpdate hook in src/server/hooks.ts).
-- =====================================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) VALUES
  ('project_completed', 'Project closed as completed', '["explicit","leader","requestor_rep","supervisor","manager"]', '["in_app","email"]', NULL, NULL, '[]'),
  ('project_cancelled', 'Project cancelled',           '["explicit","leader","requestor_rep","supervisor","manager"]', '["in_app","email"]', NULL, NULL, '[]');
