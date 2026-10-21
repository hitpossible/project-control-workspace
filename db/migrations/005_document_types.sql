-- =====================================================================
-- Document types: each kind of request (Software Request first) has its own
-- request number format (own running number) and its own approval route
-- =====================================================================
SET NAMES utf8mb4;

-- approval_route: [{step_code, step_name, stage, levels?, approvers?}] — see RouteStep in src/lib/approval.ts
CREATE TABLE document_types (
  id                 INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code               VARCHAR(20)  NOT NULL,
  name               VARCHAR(150) NOT NULL,
  form_no            VARCHAR(50)  NULL,
  request_no_format  VARCHAR(100) NOT NULL,
  approval_route     JSON         NOT NULL,
  sort_order         INT          NOT NULL DEFAULT 0,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY document_types_code_uq (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Software Request takes over the old global number format and picked approvers
SET @fmt = COALESCE((SELECT JSON_UNQUOTE(value) FROM app_settings WHERE `key` = 'request_no_format'), 'REQ-SYS-{YYYY}-{SEQ:4}');
SET @picked = COALESCE((SELECT value FROM app_settings WHERE `key` = 'approval_route_approvers'), JSON_OBJECT());

INSERT INTO document_types(code, name, form_no, request_no_format, approval_route, sort_order) VALUES
('SWR', 'Software Request', 'FM-SYS-004', @fmt, JSON_ARRAY(
  JSON_OBJECT('step_code', 'requestor_check',   'step_name', 'Checked By',          'stage', 'requestor', 'levels', JSON_ARRAY('manager', 'gm', 'factory_manager', 'president')),
  JSON_OBJECT('step_code', 'requestor_approve', 'step_name', 'Approved By',         'stage', 'requestor', 'levels', JSON_ARRAY('gm', 'factory_manager', 'president')),
  JSON_OBJECT('step_code', 'ss_receive',        'step_name', 'Received Request By', 'stage', 'receive',   'approvers', CAST(COALESCE(JSON_EXTRACT(@picked, '$.ss_receive'), '[]') AS JSON)),
  JSON_OBJECT('step_code', 'ss_gm_approve',     'step_name', 'Approved Request By', 'stage', 'authority', 'approvers', CAST(COALESCE(JSON_EXTRACT(@picked, '$.ss_gm_approve'), '[]') AS JSON)),
  JSON_OBJECT('step_code', 'ss_fm_approve',     'step_name', 'Approved Request By', 'stage', 'authority', 'approvers', CAST(COALESCE(JSON_EXTRACT(@picked, '$.ss_fm_approve'), '[]') AS JSON)),
  JSON_OBJECT('step_code', 'final_approve',     'step_name', 'Final Approved By',   'stage', 'authority', 'approvers', CAST(COALESCE(JSON_EXTRACT(@picked, '$.final_approve'), '[]') AS JSON))
), 1);

ALTER TABLE project_requests ADD COLUMN document_type_id INT NULL AFTER request_no;
UPDATE project_requests SET document_type_id = (SELECT id FROM document_types WHERE code = 'SWR');
ALTER TABLE project_requests
  MODIFY document_type_id INT NOT NULL,
  ADD KEY project_requests_doctype_idx (document_type_id),
  ADD CONSTRAINT project_requests_doctype_fk FOREIGN KEY (document_type_id) REFERENCES document_types(id);

-- Stage of a step decides the request status while it waits: requestor / receive / authority
ALTER TABLE approval_steps ADD COLUMN stage VARCHAR(20) NULL AFTER step_name;
UPDATE approval_steps SET stage = CASE
  WHEN step_code IN ('requestor_check', 'requestor_approve', 'requestor_approval') THEN 'requestor'
  WHEN step_code IN ('ss_receive', 'system_review') THEN 'receive'
  ELSE 'authority' END;

DELETE FROM app_settings WHERE `key` IN ('request_no_format', 'approval_route_approvers');
