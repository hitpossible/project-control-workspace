-- =====================================================================
-- Requirement summary: one working summary per project of what the system must do — drafted by the AI from the
-- request, the clarification interview and the initial analysis, then edited by the team. Not the SRS (the formal,
-- signed document); this is what the team plans, estimates and staffs from (AI skill suggestions read it).
-- content: see RequirementSummary in src/lib/requirements.ts
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE project_requirement_summaries (
  id            INT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id    INT         NOT NULL,
  content       JSON        NOT NULL,
  -- the AI drafted the current text and nobody has saved an edit since
  ai_generated  TINYINT(1)  NOT NULL DEFAULT 0,
  created_by    INT         NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by    INT         NULL,
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY project_req_summary_uq (project_id),
  CONSTRAINT project_req_summary_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_req_summary_created_fk FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT project_req_summary_updated_fk FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
