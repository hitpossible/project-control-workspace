-- =====================================================================
-- Master data: Departments and their Sections
-- profiles.department / profiles.section keep the names (renames are pushed to profiles by hooks.ts)
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE departments (
  id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY departments_name_uq (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sections (
  id             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  department_id  INT          NOT NULL,
  name           VARCHAR(150) NOT NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY sections_dept_name_uq (department_id, name),
  CONSTRAINT sections_department_fk FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Start from the values already typed into user profiles
INSERT IGNORE INTO departments(name)
  SELECT DISTINCT TRIM(department) FROM profiles WHERE TRIM(COALESCE(department, '')) <> '';

INSERT IGNORE INTO sections(department_id, name)
  SELECT DISTINCT d.id, TRIM(p.section) FROM profiles p JOIN departments d ON d.name = TRIM(p.department)
  WHERE TRIM(COALESCE(p.section, '')) <> '';
