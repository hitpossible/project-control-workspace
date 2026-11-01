-- =====================================================================
-- Git links on tasks and bugs: branch / commit / pull (merge) request URLs from GitHub or the company GitLab.
-- Added by people (task / bug dialog → Git) or by the AI assistant when it hands work over.
-- provider and kind are read from the URL (src/lib/git.ts); refs T{id} / B{id} tie branches and commits to the work.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE work_links (
  id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id   INT          NOT NULL,
  entity_type  ENUM('task','bug') NOT NULL,
  entity_id    INT          NOT NULL,
  kind         ENUM('branch','commit','pull_request','other') NOT NULL DEFAULT 'other',
  provider     ENUM('github','gitlab','other') NOT NULL DEFAULT 'other',
  url          VARCHAR(500) NOT NULL,
  title        VARCHAR(300) NULL,
  created_by   INT          NOT NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY work_links_uq (entity_type, entity_id, url(255)),
  KEY work_links_project_idx (project_id),
  CONSTRAINT work_links_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT work_links_author_fk FOREIGN KEY (created_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
