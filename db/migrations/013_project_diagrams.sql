-- =====================================================================
-- Design diagrams: flowcharts and ER diagrams drawn by the project team on the
-- project's Design tab (React Flow). The company LLM can draft one from a prompt
-- and the request; the team then edits it like any other diagram.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE project_diagrams (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id  INT          NOT NULL,
  kind        ENUM('flowchart','er') NOT NULL,
  title       VARCHAR(200) NOT NULL,
  content     JSON         NOT NULL,          -- {nodes, edges} — see DiagramContent in src/lib/diagram.ts
  created_by  INT          NOT NULL,
  updated_by  INT          NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY project_diagrams_project_idx (project_id, updated_at),
  CONSTRAINT project_diagrams_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_diagrams_author_fk FOREIGN KEY (created_by) REFERENCES profiles(id),
  CONSTRAINT project_diagrams_editor_fk FOREIGN KEY (updated_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
