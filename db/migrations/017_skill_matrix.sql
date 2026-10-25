-- =====================================================================
-- Skill matrix: each developer's level per skill (1–5), what each project needs,
-- and from that a ranked list of who fits a project best (rpc recommend_members).
--   self_level      the person's own assessment
--   verified_level  confirmed by a Supervisor / Manager — wins over self_level when set
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE skills (
  id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  category     ENUM('frontend','backend','database','mobile','devops','integration','domain','other') NOT NULL DEFAULT 'other',
  description  VARCHAR(300) NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY skills_name_uq (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE profile_skills (
  id              INT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         INT         NOT NULL,
  skill_id        INT         NOT NULL,
  self_level      TINYINT     NULL,
  verified_level  TINYINT     NULL,
  verified_by     INT         NULL,
  verified_at     DATETIME(3) NULL,
  note            VARCHAR(300) NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY profile_skills_uq (user_id, skill_id),
  KEY profile_skills_skill_idx (skill_id),
  CONSTRAINT profile_skills_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT profile_skills_skill_fk FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  CONSTRAINT profile_skills_verifier_fk FOREIGN KEY (verified_by) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT profile_skills_self_chk CHECK (self_level IS NULL OR self_level BETWEEN 1 AND 5),
  CONSTRAINT profile_skills_verified_chk CHECK (verified_level IS NULL OR verified_level BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_skill_requirements (
  id              INT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id      INT         NOT NULL,
  skill_id        INT         NOT NULL,
  required_level  TINYINT     NOT NULL DEFAULT 3,
  -- importance 1 (nice to have) … 5 (core of the project)
  weight          TINYINT     NOT NULL DEFAULT 3,
  -- a candidate below required_level on a mandatory skill is listed after everyone who meets it
  is_mandatory    TINYINT(1)  NOT NULL DEFAULT 0,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY project_skill_req_uq (project_id, skill_id),
  CONSTRAINT project_skill_req_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_skill_req_skill_fk FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  CONSTRAINT project_skill_req_level_chk CHECK (required_level BETWEEN 1 AND 5),
  CONSTRAINT project_skill_req_weight_chk CHECK (weight BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO skills (name, category) VALUES
  ('React / Next.js', 'frontend'), ('TypeScript', 'frontend'), ('HTML / CSS', 'frontend'),
  ('Node.js', 'backend'), ('C# / .NET', 'backend'), ('Java', 'backend'), ('Python', 'backend'), ('PHP', 'backend'),
  ('MySQL', 'database'), ('SQL Server', 'database'), ('Oracle', 'database'),
  ('Flutter', 'mobile'), ('Android', 'mobile'),
  ('Docker', 'devops'), ('Linux server', 'devops'), ('CI/CD', 'devops'),
  ('REST API', 'integration'), ('SAP integration', 'integration'), ('PLC / machine interface', 'integration'),
  ('Production / MES', 'domain'), ('Quality / QC', 'domain'), ('Warehouse / logistics', 'domain'), ('HR / payroll', 'domain'), ('Accounting', 'domain');
