-- =====================================================================
-- Closure sign-off: a project that came from a request is completed only when the requestor accepts the delivery.
-- The leader sends a closure (handover summary); the requestor — or a requestor representative on the team —
-- accepts it (their saved signature is copied in at that moment) or asks for changes with a comment.
-- One round per send; only one pending round per project. Workflow in src/server/rpc/closure.ts.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE project_closures (
  id                INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id        INT          NOT NULL,
  round_no          INT          NOT NULL,
  summary           TEXT         NOT NULL,          -- what was delivered / handed over, from the leader
  status            ENUM('pending','accepted','changes_requested','withdrawn') NOT NULL DEFAULT 'pending',
  requested_by      INT          NOT NULL,
  requested_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_by        INT          NULL,
  decided_at        DATETIME(3)  NULL,
  decision_comment  TEXT         NULL,
  signature_path    VARCHAR(500) NULL,               -- acceptor's signature as it was when they accepted
  -- only one pending closure per project (partial unique index emulation, as baseline_revisions)
  pending_key       INT          AS (IF(status = 'pending', project_id, NULL)) STORED,
  UNIQUE KEY project_closures_round_uq (project_id, round_no),
  UNIQUE KEY project_closures_one_pending (pending_key),
  CONSTRAINT project_closures_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT project_closures_reqby_fk FOREIGN KEY (requested_by) REFERENCES profiles(id),
  CONSTRAINT project_closures_decby_fk FOREIGN KEY (decided_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) VALUES
  ('closure_requested',         'Project closure waiting for acceptance', '["explicit","requestor_rep"]', '["in_app","email"]', NULL, NULL, '[]'),
  ('closure_changes_requested', 'Requestor asked for changes at closure', '["explicit","leader"]',        '["in_app","email"]', NULL, NULL, '[]');
