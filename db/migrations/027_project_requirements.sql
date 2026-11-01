-- =====================================================================
-- Project requirements: what the system must do (functions / features), kept per project and converted into tasks.
--   draft → approved (leader reviews the wording / scope) → tasks are created from approved ones; dropped = no longer wanted.
--   internal_tasks.requirement_id traces each task back to the requirement it carries out (coverage = tasks completed).
--   Workflow in src/server/rpc/requirements.ts.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE project_requirements (
  id                  INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id          INT          NOT NULL,
  req_no              VARCHAR(20)  NOT NULL,          -- FR-001 per project
  title               VARCHAR(300) NOT NULL,
  description         TEXT         NULL,
  category            VARCHAR(100) NULL,              -- module / area, used to group the list
  priority            ENUM('must','should','could','wont') NOT NULL DEFAULT 'should',   -- MoSCoW
  acceptance_criteria TEXT         NULL,
  estimated_md        DECIMAL(6,1) NULL,
  status              ENUM('draft','approved','dropped') NOT NULL DEFAULT 'draft',
  seq                 INT          NOT NULL DEFAULT 0,
  created_by          INT          NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by          INT          NULL,
  UNIQUE KEY project_requirements_no_uq (project_id, req_no),
  KEY project_requirements_status_idx (project_id, status),
  CONSTRAINT project_requirements_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_requirements_createdby_fk FOREIGN KEY (created_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE internal_tasks
  ADD COLUMN requirement_id INT NULL AFTER parent_task_id,
  ADD KEY internal_tasks_requirement_idx (requirement_id),
  ADD CONSTRAINT internal_tasks_requirement_fk FOREIGN KEY (requirement_id) REFERENCES project_requirements(id) ON DELETE SET NULL;
