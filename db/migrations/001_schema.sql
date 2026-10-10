-- =====================================================================
-- TBKK System Service Project Control Workspace — MySQL schema (5.7+ / 8.x)
--   * Timestamps are DATETIME(3) in UTC (the app sets session time_zone = '+00:00')
--   * Status / type values are ENUMs (MySQL 5.7 ignores CHECK constraints)
--   * JSON columns have no DB default (5.7) — defaults are applied by the app
--   * Row-level permissions, guards, audit and roll-ups live in src/server (was RLS + triggers)
-- =====================================================================
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- Users / profiles
-- roles: requestor, requestor_approver, system_reviewer, authority_approver,
--        project_leader, developer, qa, supervisor, manager, management_view, admin
-- ---------------------------------------------------------------------
CREATE TABLE profiles (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  username       VARCHAR(100) NULL,          -- AD / company login name
  password_hash  VARCHAR(100) NULL,          -- local login only (seed / break-glass accounts)
  employee_id    VARCHAR(50)  NULL,
  full_name      VARCHAR(200) NOT NULL,
  email          VARCHAR(191) NULL,
  department     VARCHAR(150) NULL,
  section        VARCHAR(150) NULL,
  telephone      VARCHAR(50)  NULL,
  extension      VARCHAR(20)  NULL,
  roles          JSON         NOT NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY profiles_username_uq (username),
  UNIQUE KEY profiles_email_uq (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Master data / configuration
-- ---------------------------------------------------------------------
CREATE TABLE app_settings (
  `key`        VARCHAR(100) NOT NULL PRIMARY KEY,
  value        JSON         NOT NULL,
  description  TEXT         NULL,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE doc_sequences (
  scope       VARCHAR(191) NOT NULL PRIMARY KEY,
  last_value  INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_types (
  id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(30)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY project_types_code_uq (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- default_activities: [{name, pic_label, duration_days, is_milestone, tasks:[{name, task_type, duration_days}]}]
CREATE TABLE project_templates (
  id                  INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                VARCHAR(50)  NOT NULL,
  name                VARCHAR(150) NOT NULL,
  project_type_id     INT          NULL,
  description         TEXT         NULL,
  default_activities  JSON         NOT NULL,
  evidence_checklist  JSON         NOT NULL,
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY project_templates_code_uq (code),
  CONSTRAINT project_templates_type_fk FOREIGN KEY (project_type_id) REFERENCES project_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Project Request (FM-SYS-004)
-- ---------------------------------------------------------------------
CREATE TABLE project_requests (
  id                     CHAR(36)     NOT NULL PRIMARY KEY,
  request_no             VARCHAR(50)  NULL,
  status                 ENUM('draft','submitted','waiting_requestor_approval','waiting_system_review',
                              'need_more_information','waiting_authority_approval','approved','rejected',
                              'converted','cancelled') NOT NULL DEFAULT 'draft',
  requestor_id           CHAR(36)     NOT NULL,
  req_employee_id        VARCHAR(50)  NULL,
  req_full_name          VARCHAR(200) NULL,
  req_department         VARCHAR(150) NULL,
  req_section            VARCHAR(150) NULL,
  req_email              VARCHAR(191) NULL,
  req_telephone          VARCHAR(50)  NULL,
  req_extension          VARCHAR(20)  NULL,
  project_name           VARCHAR(300) NOT NULL,
  description            TEXT         NULL,
  reason                 TEXT         NULL,
  expectation            TEXT         NULL,
  priority               ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  date_submitted         DATE         NULL,
  date_required          DATE         NULL,
  benefit                TEXT         NULL,
  requestor_approver_id  CHAR(36)     NULL,
  authority_approver_id  CHAR(36)     NULL,
  project_type_id        INT          NULL,
  template_id            INT          NULL,
  proposed_leader_id     CHAR(36)     NULL,
  scope_assessment       TEXT         NULL,
  reviewed_by            CHAR(36)     NULL,
  project_id             CHAR(36)     NULL,
  submitted_at           DATETIME(3)  NULL,
  created_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by             CHAR(36)     NULL,
  UNIQUE KEY project_requests_no_uq (request_no),
  KEY project_requests_requestor_idx (requestor_id),
  CONSTRAINT project_requests_requestor_fk FOREIGN KEY (requestor_id) REFERENCES profiles(id),
  CONSTRAINT project_requests_reqappr_fk FOREIGN KEY (requestor_approver_id) REFERENCES profiles(id),
  CONSTRAINT project_requests_authappr_fk FOREIGN KEY (authority_approver_id) REFERENCES profiles(id),
  CONSTRAINT project_requests_type_fk FOREIGN KEY (project_type_id) REFERENCES project_types(id),
  CONSTRAINT project_requests_tpl_fk FOREIGN KEY (template_id) REFERENCES project_templates(id),
  CONSTRAINT project_requests_leader_fk FOREIGN KEY (proposed_leader_id) REFERENCES profiles(id),
  CONSTRAINT project_requests_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Approval workflow
-- ---------------------------------------------------------------------
CREATE TABLE approval_steps (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  request_id     CHAR(36)     NOT NULL,
  cycle          INT          NOT NULL DEFAULT 1,
  step_no        INT          NOT NULL,
  step_code      ENUM('requestor_approval','system_review','authority_approval') NOT NULL,
  step_name      VARCHAR(100) NOT NULL,
  approver_id    CHAR(36)     NULL,           -- null = any user holding approver_role
  approver_role  VARCHAR(50)  NOT NULL,
  status         ENUM('pending','waiting','approved','rejected','sent_back','more_info','cancelled') NOT NULL DEFAULT 'pending',
  action         VARCHAR(30)  NULL,
  comment        TEXT         NULL,
  acted_by       CHAR(36)     NULL,
  acted_at       DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY approval_steps_uq (request_id, cycle, step_no),
  CONSTRAINT approval_steps_request_fk FOREIGN KEY (request_id) REFERENCES project_requests(id) ON DELETE CASCADE,
  CONSTRAINT approval_steps_approver_fk FOREIGN KEY (approver_id) REFERENCES profiles(id),
  CONSTRAINT approval_steps_actedby_fk FOREIGN KEY (acted_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE approval_actions (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  request_id  CHAR(36)    NOT NULL,
  step_id     CHAR(36)    NULL,
  step_code   VARCHAR(30) NULL,
  action      ENUM('submit','resubmit','approve','reject','send_back','request_more_info','cancel','convert') NOT NULL,
  comment     TEXT        NULL,
  action_by   CHAR(36)    NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY approval_actions_request_idx (request_id, created_at),
  CONSTRAINT approval_actions_request_fk FOREIGN KEY (request_id) REFERENCES project_requests(id) ON DELETE CASCADE,
  CONSTRAINT approval_actions_step_fk FOREIGN KEY (step_id) REFERENCES approval_steps(id) ON DELETE SET NULL,
  CONSTRAINT approval_actions_by_fk FOREIGN KEY (action_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Controlled Project
-- ---------------------------------------------------------------------
CREATE TABLE projects (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  project_code      VARCHAR(50)  NOT NULL,
  project_name      VARCHAR(300) NOT NULL,
  project_type_id   INT          NULL,
  template_id       INT          NULL,
  request_id        CHAR(36)     NULL,
  leader_id         CHAR(36)     NULL,
  sponsor           VARCHAR(200) NULL,
  department        VARCHAR(150) NULL,
  priority          ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  start_date        DATE         NULL,
  target_date       DATE         NULL,
  forecast_date     DATE         NULL,
  status            ENUM('draft','planning','in_progress','waiting','on_hold','at_risk','delayed','completed','cancelled') NOT NULL DEFAULT 'planning',
  progress          DECIMAL(5,2) NOT NULL DEFAULT 0,
  health            ENUM('green','yellow','red') NOT NULL DEFAULT 'green',
  next_action       TEXT         NULL,
  remark            TEXT         NULL,           -- high-level remark (visible to User / Management)
  baseline_version  INT          NOT NULL DEFAULT 0,
  created_by        CHAR(36)     NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by        CHAR(36)     NULL,
  UNIQUE KEY projects_code_uq (project_code),
  UNIQUE KEY projects_request_uq (request_id),
  CONSTRAINT projects_type_fk FOREIGN KEY (project_type_id) REFERENCES project_types(id),
  CONSTRAINT projects_tpl_fk FOREIGN KEY (template_id) REFERENCES project_templates(id),
  CONSTRAINT projects_request_fk FOREIGN KEY (request_id) REFERENCES project_requests(id),
  CONSTRAINT projects_leader_fk FOREIGN KEY (leader_id) REFERENCES profiles(id),
  CONSTRAINT projects_createdby_fk FOREIGN KEY (created_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE project_requests
  ADD CONSTRAINT project_requests_project_fk FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE project_members (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  project_id   CHAR(36)    NOT NULL,
  user_id      CHAR(36)    NOT NULL,
  member_role  ENUM('leader','developer','qa','support','supervisor','manager','requestor_rep') NOT NULL,
  notify       TINYINT(1)  NOT NULL DEFAULT 1,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY project_members_uq (project_id, user_id, member_role),
  KEY project_members_user_idx (user_id),
  CONSTRAINT project_members_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_members_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Baseline
-- ---------------------------------------------------------------------
CREATE TABLE project_baselines (
  id              CHAR(36)    NOT NULL PRIMARY KEY,
  project_id      CHAR(36)    NOT NULL,
  version_no      INT         NOT NULL,
  planned_start   DATE        NULL,
  planned_finish  DATE        NULL,
  target_date     DATE        NULL,
  reason          TEXT        NULL,
  created_by      CHAR(36)    NULL,
  approved_by     CHAR(36)    NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY project_baselines_uq (project_id, version_no),
  CONSTRAINT project_baselines_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_baselines_createdby_fk FOREIGN KEY (created_by) REFERENCES profiles(id),
  CONSTRAINT project_baselines_approvedby_fk FOREIGN KEY (approved_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_baseline_items (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  baseline_id     CHAR(36)     NOT NULL,
  activity_id     CHAR(36)     NULL,
  seq             INT          NOT NULL DEFAULT 0,
  activity_name   VARCHAR(300) NOT NULL,
  pic             VARCHAR(200) NULL,
  planned_start   DATE         NULL,
  planned_finish  DATE         NULL,
  is_milestone    TINYINT(1)   NOT NULL DEFAULT 0,
  KEY project_baseline_items_baseline_idx (baseline_id, seq),
  CONSTRAINT project_baseline_items_baseline_fk FOREIGN KEY (baseline_id) REFERENCES project_baselines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- User Control Plan (Activity)
-- ---------------------------------------------------------------------
CREATE TABLE activities (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  project_id            CHAR(36)     NOT NULL,
  seq                   INT          NOT NULL DEFAULT 0,
  name                  VARCHAR(300) NOT NULL,
  pic_user_id           CHAR(36)     NULL,
  pic_label             VARCHAR(100) NULL,          -- e.g. "System", "User", "Vendor"
  plan_start            DATE         NULL,
  plan_finish           DATE         NULL,
  actual_start          DATE         NULL,
  actual_finish         DATE         NULL,
  forecast_finish       DATE         NULL,          -- revised forecast (recovery)
  progress              DECIMAL(5,2) NOT NULL DEFAULT 0,
  status                ENUM('not_started','in_progress','waiting','delayed','at_risk','on_hold','completed','cancelled') NOT NULL DEFAULT 'not_started',
  status_note           TEXT         NULL,
  remark                TEXT         NULL,
  next_action           TEXT         NULL,
  delay_category        VARCHAR(100) NULL,
  delay_reason          TEXT         NULL,
  delay_impact          TEXT         NULL,
  recovery_plan         TEXT         NULL,
  recovery_owner_id     CHAR(36)     NULL,
  recovery_due_date     DATE         NULL,
  recovery_reviewed_by  CHAR(36)     NULL,
  recovery_reviewed_at  DATETIME(3)  NULL,
  is_milestone          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by            CHAR(36)     NULL,
  KEY activities_project_idx (project_id, seq),
  CONSTRAINT activities_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT activities_pic_fk FOREIGN KEY (pic_user_id) REFERENCES profiles(id),
  CONSTRAINT activities_recowner_fk FOREIGN KEY (recovery_owner_id) REFERENCES profiles(id),
  CONSTRAINT activities_recrev_fk FOREIGN KEY (recovery_reviewed_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Internal Execution Plan (Task / Sub-task)
-- ---------------------------------------------------------------------
CREATE TABLE internal_tasks (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  task_no           VARCHAR(20)  NULL,
  project_id        CHAR(36)     NOT NULL,
  activity_id       CHAR(36)     NOT NULL,
  parent_task_id    CHAR(36)     NULL,
  seq               INT          NOT NULL DEFAULT 0,
  name              VARCHAR(300) NOT NULL,
  task_type         ENUM('design','dev','qa','review','doc','deploy','support','other') NOT NULL DEFAULT 'dev',
  owner_id          CHAR(36)     NOT NULL,
  reviewer_id       CHAR(36)     NULL,
  priority          ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  planned_start     DATE         NULL,
  due_date          DATE         NOT NULL,
  actual_start      DATE         NULL,
  actual_finish     DATE         NULL,
  progress          DECIMAL(5,2) NOT NULL DEFAULT 0,
  status            ENUM('todo','in_progress','waiting','review','completed','on_hold','cancelled') NOT NULL DEFAULT 'todo',
  description       TEXT         NULL,
  technical_note    TEXT         NULL,
  internal_comment  TEXT         NULL,
  delay_category    VARCHAR(100) NULL,
  delay_reason      TEXT         NULL,
  recovery_action   TEXT         NULL,
  created_by        CHAR(36)     NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by        CHAR(36)     NULL,
  UNIQUE KEY internal_tasks_no_uq (project_id, task_no),
  KEY internal_tasks_activity_idx (activity_id, seq),
  KEY internal_tasks_owner_idx (owner_id, status),
  KEY internal_tasks_parent_idx (parent_task_id),
  CONSTRAINT internal_tasks_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT internal_tasks_activity_fk FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  CONSTRAINT internal_tasks_parent_fk FOREIGN KEY (parent_task_id) REFERENCES internal_tasks(id) ON DELETE CASCADE,
  CONSTRAINT internal_tasks_owner_fk FOREIGN KEY (owner_id) REFERENCES profiles(id),
  CONSTRAINT internal_tasks_reviewer_fk FOREIGN KEY (reviewer_id) REFERENCES profiles(id),
  CONSTRAINT internal_tasks_createdby_fk FOREIGN KEY (created_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_dependencies (
  id              CHAR(36)    NOT NULL PRIMARY KEY,
  project_id      CHAR(36)    NOT NULL,
  predecessor_id  CHAR(36)    NOT NULL,
  successor_id    CHAR(36)    NOT NULL,
  dep_type        VARCHAR(5)  NOT NULL DEFAULT 'FS',
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY task_dependencies_uq (predecessor_id, successor_id),
  CONSTRAINT task_dependencies_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT task_dependencies_pred_fk FOREIGN KEY (predecessor_id) REFERENCES internal_tasks(id) ON DELETE CASCADE,
  CONSTRAINT task_dependencies_succ_fk FOREIGN KEY (successor_id) REFERENCES internal_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- QA: Test Round · Bug · Fix · Retest
-- ---------------------------------------------------------------------
CREATE TABLE test_rounds (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  project_id    CHAR(36)     NOT NULL,
  round_no      INT          NOT NULL,
  activity_id   CHAR(36)     NULL,
  title         VARCHAR(300) NOT NULL,
  test_type     ENUM('system','integration','regression','uat','smoke','performance','other') NOT NULL DEFAULT 'system',
  tester_id     CHAR(36)     NULL,
  planned_date  DATE         NULL,
  due_date      DATE         NULL,
  actual_date   DATE         NULL,
  status        ENUM('planned','in_progress','completed','cancelled') NOT NULL DEFAULT 'planned',
  result        ENUM('passed','failed','partially_passed','blocked') NULL,
  total_cases   INT          NULL,
  passed_cases  INT          NULL,
  failed_cases  INT          NULL,
  summary       TEXT         NULL,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by    CHAR(36)     NULL,
  UNIQUE KEY test_rounds_uq (project_id, round_no),
  CONSTRAINT test_rounds_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT test_rounds_activity_fk FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL,
  CONSTRAINT test_rounds_tester_fk FOREIGN KEY (tester_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bugs (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  bug_no               VARCHAR(20)  NOT NULL,
  project_id           CHAR(36)     NOT NULL,
  test_round_id        CHAR(36)     NULL,
  activity_id          CHAR(36)     NULL,
  task_id              CHAR(36)     NULL,
  title                VARCHAR(300) NOT NULL,
  description          TEXT         NULL,
  steps_to_reproduce   TEXT         NULL,
  expected_result      TEXT         NULL,
  actual_result        TEXT         NULL,
  severity             ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  priority             ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  reporter_id          CHAR(36)     NULL,
  assigned_dev_id      CHAR(36)     NULL,
  supervisor_id        CHAR(36)     NULL,
  due_date             DATE         NULL,
  status               ENUM('new','assigned','in_progress','fix_ready','retest','reopened','closed','cancelled') NOT NULL DEFAULT 'new',
  root_cause           TEXT         NULL,
  root_cause_category  VARCHAR(100) NULL,
  reopen_count         INT          NOT NULL DEFAULT 0,
  closed_at            DATETIME(3)  NULL,
  cancel_reason        TEXT         NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by           CHAR(36)     NULL,
  UNIQUE KEY bugs_uq (project_id, bug_no),
  KEY bugs_project_idx (project_id, status),
  KEY bugs_dev_idx (assigned_dev_id, status),
  CONSTRAINT bugs_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT bugs_round_fk FOREIGN KEY (test_round_id) REFERENCES test_rounds(id) ON DELETE SET NULL,
  CONSTRAINT bugs_activity_fk FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL,
  CONSTRAINT bugs_task_fk FOREIGN KEY (task_id) REFERENCES internal_tasks(id) ON DELETE SET NULL,
  CONSTRAINT bugs_reporter_fk FOREIGN KEY (reporter_id) REFERENCES profiles(id),
  CONSTRAINT bugs_dev_fk FOREIGN KEY (assigned_dev_id) REFERENCES profiles(id),
  CONSTRAINT bugs_supervisor_fk FOREIGN KEY (supervisor_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bug_fixes (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  bug_id            CHAR(36)     NOT NULL,
  project_id        CHAR(36)     NOT NULL,
  fix_cycle         INT          NOT NULL,
  fix_owner_id      CHAR(36)     NOT NULL,
  fix_start_date    DATE         NOT NULL,
  fix_due_date      DATE         NULL,
  fix_description   TEXT         NULL,
  technical_note    TEXT         NULL,
  unit_test_result  TEXT         NULL,
  build_link        VARCHAR(500) NULL,
  commit_link       VARCHAR(500) NULL,
  fix_ready_at      DATETIME(3)  NULL,
  status            ENUM('in_progress','ready','verified','failed') NOT NULL DEFAULT 'in_progress',
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY bug_fixes_uq (bug_id, fix_cycle),
  CONSTRAINT bug_fixes_bug_fk FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE,
  CONSTRAINT bug_fixes_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT bug_fixes_owner_fk FOREIGN KEY (fix_owner_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE retests (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  bug_id        CHAR(36)    NOT NULL,
  project_id    CHAR(36)    NOT NULL,
  fix_id        CHAR(36)    NULL,
  retest_round  INT         NOT NULL,
  tester_id     CHAR(36)    NULL,
  due_date      DATE        NULL,
  status        ENUM('pending','done','cancelled') NOT NULL DEFAULT 'pending',
  result        ENUM('passed','failed','partially_passed','blocked') NULL,
  comment       TEXT        NULL,
  tested_at     DATETIME(3) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY retests_uq (bug_id, retest_round),
  KEY retests_tester_idx (tester_id, status),
  CONSTRAINT retests_bug_fk FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE,
  CONSTRAINT retests_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT retests_fix_fk FOREIGN KEY (fix_id) REFERENCES bug_fixes(id) ON DELETE SET NULL,
  CONSTRAINT retests_tester_fk FOREIGN KEY (tester_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Evidence checklist + Evidence (bound to an entity)
-- ---------------------------------------------------------------------
CREATE TABLE evidence_requirements (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  project_id    CHAR(36)     NOT NULL,
  entity_type   ENUM('project','activity','task') NOT NULL,
  entity_id     CHAR(36)     NOT NULL,
  name          VARCHAR(300) NOT NULL,
  description   TEXT         NULL,
  is_mandatory  TINYINT(1)   NOT NULL DEFAULT 1,
  source        ENUM('template','manual') NOT NULL DEFAULT 'manual',
  created_by    CHAR(36)     NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY evidence_req_entity_idx (entity_type, entity_id),
  KEY evidence_req_project_idx (project_id),
  CONSTRAINT evidence_req_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE evidence (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  project_id           CHAR(36)     NULL,
  request_id           CHAR(36)     NULL,
  entity_type          ENUM('request','project','activity','task','test_round','bug','fix','retest') NOT NULL,
  entity_id            CHAR(36)     NOT NULL,
  evidence_type        ENUM('document','excel','pdf','image','screenshot','log','email','meeting_note',
                            'url','sharepoint','git','build','other') NOT NULL,
  file_name            VARCHAR(500) NULL,
  storage_path         VARCHAR(500) NULL,         -- object key in MinIO bucket
  url                  VARCHAR(1000) NULL,
  mime_type            VARCHAR(150) NULL,
  file_size            BIGINT       NULL,
  description          TEXT         NULL,
  is_required          TINYINT(1)   NOT NULL DEFAULT 0,
  is_internal          TINYINT(1)   NOT NULL DEFAULT 1,
  verification_status  ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  verified_by          CHAR(36)     NULL,
  verified_at          DATETIME(3)  NULL,
  requirement_id       CHAR(36)     NULL,
  uploaded_by          CHAR(36)     NULL,
  uploaded_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY evidence_entity_idx (entity_type, entity_id),
  KEY evidence_project_idx (project_id),
  KEY evidence_request_idx (request_id),
  KEY evidence_requirement_idx (requirement_id),
  CONSTRAINT evidence_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT evidence_request_fk FOREIGN KEY (request_id) REFERENCES project_requests(id) ON DELETE CASCADE,
  CONSTRAINT evidence_requirement_fk FOREIGN KEY (requirement_id) REFERENCES evidence_requirements(id) ON DELETE SET NULL,
  CONSTRAINT evidence_verifiedby_fk FOREIGN KEY (verified_by) REFERENCES profiles(id),
  CONSTRAINT evidence_uploadedby_fk FOREIGN KEY (uploaded_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Baseline revision (re-plan) requests — approved by Manager / Supervisor
-- ---------------------------------------------------------------------
CREATE TABLE baseline_revisions (
  id                    CHAR(36)    NOT NULL PRIMARY KEY,
  project_id            CHAR(36)    NOT NULL,
  from_version          INT         NOT NULL,
  reason                TEXT        NOT NULL,
  impact                TEXT        NULL,
  previous_target_date  DATE        NULL,
  proposed_target_date  DATE        NULL,
  plan_snapshot         JSON        NOT NULL,
  status                ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_by          CHAR(36)    NULL,
  requested_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_by            CHAR(36)    NULL,
  decided_at            DATETIME(3) NULL,
  decision_comment      TEXT        NULL,
  baseline_id           CHAR(36)    NULL,
  -- only one pending revision per project (partial unique index emulation)
  pending_key           CHAR(36) AS (IF(status = 'pending', project_id, NULL)) STORED,
  UNIQUE KEY baseline_revisions_one_pending (pending_key),
  KEY baseline_revisions_project_idx (project_id),
  -- (MySQL forbids CASCADE on the base column of a stored generated column; projects are never hard-deleted)
  CONSTRAINT baseline_revisions_project_fk FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT baseline_revisions_reqby_fk FOREIGN KEY (requested_by) REFERENCES profiles(id),
  CONSTRAINT baseline_revisions_decby_fk FOREIGN KEY (decided_by) REFERENCES profiles(id),
  CONSTRAINT baseline_revisions_baseline_fk FOREIGN KEY (baseline_id) REFERENCES project_baselines(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Notification
--   recipient_roles: project member roles + 'explicit' (owner / approver passed by the event)
-- ---------------------------------------------------------------------
CREATE TABLE notification_rules (
  event_code           VARCHAR(60)  NOT NULL PRIMARY KEY,
  name                 VARCHAR(200) NOT NULL,
  recipient_roles      JSON         NOT NULL,
  channels             JSON         NOT NULL,
  escalation_days      INT          NULL,          -- repeat interval for overdue events
  escalate_after_days  INT          NULL,
  escalate_roles       JSON         NOT NULL,
  is_active            TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  event_code  VARCHAR(60)  NOT NULL,
  project_id  CHAR(36)     NULL,
  request_id  CHAR(36)     NULL,
  title       VARCHAR(500) NOT NULL,
  body        TEXT         NULL,
  link        VARCHAR(500) NULL,
  dedupe_key  VARCHAR(191) NULL,
  is_read     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY notifications_dedupe_uq (user_id, dedupe_key),  -- NULL keys never collide
  KEY notifications_user_idx (user_id, is_read, created_at),
  CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT notifications_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT notifications_request_fk FOREIGN KEY (request_id) REFERENCES project_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_outbox (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  notification_id  CHAR(36)     NULL,
  to_email         VARCHAR(191) NOT NULL,
  subject          VARCHAR(500) NOT NULL,
  body             TEXT         NULL,
  status           ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  error            TEXT         NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at          DATETIME(3)  NULL,
  KEY email_outbox_status_idx (status, created_at),
  CONSTRAINT email_outbox_notification_fk FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  table_name   VARCHAR(60)  NOT NULL,
  entity_id    VARCHAR(36)  NULL,
  project_id   CHAR(36)     NULL,
  request_id   CHAR(36)     NULL,
  action       VARCHAR(10)  NOT NULL,
  field        VARCHAR(60)  NULL,
  old_value    TEXT         NULL,
  new_value    TEXT         NULL,
  user_id      CHAR(36)     NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY audit_logs_project_idx (project_id, created_at),
  KEY audit_logs_entity_idx (entity_id, created_at),
  KEY audit_logs_request_idx (request_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Phase 3 — Management Intelligence
-- ---------------------------------------------------------------------
CREATE TABLE insight_rules (
  code             VARCHAR(60)  NOT NULL PRIMARY KEY,
  name             VARCHAR(200) NOT NULL,
  description      TEXT         NULL,
  severity         ENUM('critical','warning','info') NOT NULL DEFAULT 'warning',
  threshold        INT          NULL,
  threshold_label  VARCHAR(50)  NULL,
  internal         TINYINT(1)   NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workforce_plans (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  work_date   DATE         NOT NULL,
  start_time  TIME         NULL,
  end_time    TIME         NULL,
  work_type   ENUM('office','onsite','wfh','customer_site','factory_support','training','leave','ot') NOT NULL DEFAULT 'office',
  location    VARCHAR(200) NULL,
  project_id  CHAR(36)     NULL,
  remark      TEXT         NULL,
  created_by  CHAR(36)     NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY workforce_user_date_idx (user_id, work_date),
  KEY workforce_date_idx (work_date),
  CONSTRAINT workforce_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT workforce_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_kpi_snapshots (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  project_id           CHAR(36)     NOT NULL,
  snapshot_date        DATE         NOT NULL,
  progress             DECIMAL(5,2) NULL,
  health               VARCHAR(10)  NULL,
  status               VARCHAR(20)  NULL,
  schedule_variance    INT          NULL,
  overdue_tasks        INT          NULL,
  open_bugs            INT          NULL,
  evidence_completion  DECIMAL(5,1) NULL,
  waiting_days         DECIMAL(8,1) NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY project_kpi_snapshots_uq (project_id, snapshot_date),
  CONSTRAINT project_kpi_snapshots_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Applied migrations (used by scripts/migrate.ts)
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        VARCHAR(191) NOT NULL PRIMARY KEY,
  applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
