-- =====================================================================
-- SRS sign-off in the system: the team uploads the SRS (PDF), places a signature / name / date box
-- for each signer on the pages, and each signer's signature is stamped into their boxes when they approve.
-- Fully signed → a verified evidence file on the chosen checklist item (usually "Requirement Document").
-- =====================================================================
SET NAMES utf8mb4;

-- the user's own signature image (PNG in MinIO), drawn once in "My signature"
ALTER TABLE profiles
  ADD COLUMN signature_path       VARCHAR(500) NULL,
  ADD COLUMN signature_updated_at DATETIME(3)  NULL;

CREATE TABLE srs_documents (
  id               INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id       INT          NOT NULL,
  version_no       INT          NOT NULL,
  title            VARCHAR(300) NOT NULL,
  file_name        VARCHAR(500) NOT NULL,
  original_path    VARCHAR(500) NOT NULL,          -- uploaded PDF, never changed
  original_sha256  CHAR(64)     NOT NULL,
  page_count       INT          NOT NULL,
  pages            JSON         NOT NULL,          -- [{w, h}] page size as displayed (points, rotation applied)
  stamped_path     VARCHAR(500) NULL,              -- original + signatures so far
  stamped_sha256   CHAR(64)     NULL,
  requirement_id   INT          NULL,              -- checklist item the signed SRS satisfies
  evidence_id      INT          NULL,              -- evidence created when fully signed
  status           ENUM('draft','signing','signed','rejected','cancelled','superseded') NOT NULL DEFAULT 'draft',
  sent_at          DATETIME(3)  NULL,
  completed_at     DATETIME(3)  NULL,
  created_by       INT          NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY srs_documents_version_uq (project_id, version_no),
  KEY srs_documents_status_idx (status),
  CONSTRAINT srs_documents_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT srs_documents_requirement_fk FOREIGN KEY (requirement_id) REFERENCES evidence_requirements(id) ON DELETE SET NULL,
  CONSTRAINT srs_documents_evidence_fk FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL,
  CONSTRAINT srs_documents_createdby_fk FOREIGN KEY (created_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE srs_signers (
  id               INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  srs_id           INT          NOT NULL,
  project_id       INT          NOT NULL,
  signer_id        INT          NOT NULL,
  seq              INT          NOT NULL DEFAULT 0,
  role_label       VARCHAR(100) NULL,              -- e.g. "Prepared by", "Approved by"
  status           ENUM('pending','signed','rejected') NOT NULL DEFAULT 'pending',
  signed_at        DATETIME(3)  NULL,
  signature_path   VARCHAR(500) NULL,              -- copy of the signature at signing time
  name_image_path  VARCHAR(500) NULL,              -- name + position rendered by the browser (Thai shaping)
  doc_sha256       CHAR(64)     NULL,              -- original file the signer approved
  comment          TEXT         NULL,
  ip               VARCHAR(64)  NULL,
  user_agent       VARCHAR(300) NULL,
  UNIQUE KEY srs_signers_uq (srs_id, signer_id),
  KEY srs_signers_signer_idx (signer_id, status),
  CONSTRAINT srs_signers_srs_fk FOREIGN KEY (srs_id) REFERENCES srs_documents(id) ON DELETE CASCADE,
  CONSTRAINT srs_signers_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT srs_signers_signer_fk FOREIGN KEY (signer_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- box position as a fraction of the displayed page (origin top-left), so it fits any screen size
CREATE TABLE srs_fields (
  id               INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  srs_id           INT          NOT NULL,
  signer_row_id    INT          NOT NULL,
  kind             ENUM('signature','name','date') NOT NULL DEFAULT 'signature',
  page_no          INT          NOT NULL,          -- 1-based
  x                DECIMAL(9,6) NOT NULL,
  y                DECIMAL(9,6) NOT NULL,
  w                DECIMAL(9,6) NOT NULL,
  h                DECIMAL(9,6) NOT NULL,
  KEY srs_fields_srs_idx (srs_id),
  CONSTRAINT srs_fields_srs_fk FOREIGN KEY (srs_id) REFERENCES srs_documents(id) ON DELETE CASCADE,
  CONSTRAINT srs_fields_signer_fk FOREIGN KEY (signer_row_id) REFERENCES srs_signers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) VALUES
  ('srs_sign_requested', 'SRS waiting for my signature', '["explicit"]',          '["in_app","email"]', NULL, NULL, '[]'),
  ('srs_signed',         'SRS fully signed',             '["explicit","leader"]', '["in_app","email"]', NULL, NULL, '[]'),
  ('srs_rejected',       'SRS sent back by a signer',    '["explicit","leader"]', '["in_app","email"]', NULL, NULL, '[]');
