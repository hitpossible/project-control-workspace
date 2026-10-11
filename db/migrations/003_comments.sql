-- =====================================================================
-- Comments with @mention on internal Tasks and Bugs
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE comments (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  project_id   CHAR(36)    NOT NULL,
  entity_type  ENUM('task','bug') NOT NULL,
  entity_id    CHAR(36)    NOT NULL,
  body         TEXT        NOT NULL,
  mentions     JSON        NOT NULL,          -- profile ids mentioned with @Name
  created_by   CHAR(36)    NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_at    DATETIME(3) NULL,
  KEY comments_entity_idx (entity_type, entity_id, created_at),
  KEY comments_project_idx (project_id),
  CONSTRAINT comments_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT comments_author_fk FOREIGN KEY (created_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) VALUES
  ('comment_mention', 'Mentioned in a comment',               '["explicit"]', '["in_app","email"]', NULL, NULL, '[]'),
  ('comment_added',   'New comment on my Task / Bug',         '["explicit"]', '["in_app"]',         NULL, NULL, '[]');
