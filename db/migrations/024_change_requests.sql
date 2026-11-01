-- =====================================================================
-- Change Requests: a change of scope after the project started, with its impact agreed and approved before work starts.
--   submitted → assessed (leader: effort / new target / impact) → agreed (requestor accepts the impact; skipped when the
--   project has no request) → approved (Manager / Supervisor) → implemented (leader)
--   rejected / withdrawn end it. Workflow in src/server/rpc/change-requests.ts.
-- A baseline revision may reference the approved CR it carries out: such revisions are not counted as reschedules,
-- and on-time completion is measured against the target the CR approved.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE change_requests (
  id                INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id        INT          NOT NULL,
  cr_no             VARCHAR(20)  NOT NULL,          -- CR-001 per project
  title             VARCHAR(300) NOT NULL,
  change_type       ENUM('add','modify','remove') NOT NULL DEFAULT 'add',
  description       TEXT         NOT NULL,          -- what should change
  reason            TEXT         NOT NULL,          -- why it is needed
  priority          ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status            ENUM('submitted','assessed','agreed','approved','implemented','rejected','withdrawn') NOT NULL DEFAULT 'submitted',
  -- impact assessment (leader)
  impact_md         DECIMAL(6,1) NULL,              -- extra effort in man-days (negative = saves effort)
  impact_target     DATE         NULL,              -- proposed new target date (NULL = target unchanged)
  impact_summary    TEXT         NULL,              -- affected activities, risks, cost
  assessed_by       INT          NULL,
  assessed_at       DATETIME(3)  NULL,
  -- requestor agreement
  agreed_by         INT          NULL,
  agreed_at         DATETIME(3)  NULL,
  -- approval / rejection
  decided_by        INT          NULL,
  decided_at        DATETIME(3)  NULL,
  decision_comment  TEXT         NULL,
  implemented_at    DATETIME(3)  NULL,
  implemented_note  TEXT         NULL,
  requested_by      INT          NOT NULL,
  requested_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by        INT          NULL,
  UNIQUE KEY change_requests_no_uq (project_id, cr_no),
  KEY change_requests_status_idx (project_id, status),
  CONSTRAINT change_requests_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT change_requests_reqby_fk FOREIGN KEY (requested_by) REFERENCES profiles(id),
  CONSTRAINT change_requests_assby_fk FOREIGN KEY (assessed_by) REFERENCES profiles(id),
  CONSTRAINT change_requests_agrby_fk FOREIGN KEY (agreed_by) REFERENCES profiles(id),
  CONSTRAINT change_requests_decby_fk FOREIGN KEY (decided_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE baseline_revisions
  ADD COLUMN change_request_id INT NULL AFTER reason,
  ADD CONSTRAINT baseline_revisions_cr_fk FOREIGN KEY (change_request_id) REFERENCES change_requests(id);

INSERT IGNORE INTO notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) VALUES
  ('cr_submitted', 'Change request submitted — assess impact',     '["explicit","leader"]',                      '["in_app","email"]', NULL, NULL, '[]'),
  ('cr_assessed',  'Change request impact — requestor to agree',   '["explicit","requestor_rep"]',               '["in_app","email"]', NULL, NULL, '[]'),
  ('cr_agreed',    'Change request waiting for approval',          '["explicit","manager","supervisor"]',        '["in_app","email"]', NULL, NULL, '[]'),
  ('cr_decided',   'Change request approved / rejected',           '["explicit","leader"]',                      '["in_app","email"]', NULL, NULL, '[]');
