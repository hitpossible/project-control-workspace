export type Role =
  | 'requestor'
  | 'requestor_approver'
  | 'system_reviewer'
  | 'authority_approver'
  | 'project_leader'
  | 'developer'
  | 'qa'
  | 'supervisor'
  | 'manager'
  | 'management_view'
  | 'admin';

export interface Profile {
  id: string;
  /** AD / company login name */
  username: string | null;
  employee_id: string | null;
  full_name: string;
  email: string | null;
  department: string | null;
  section: string | null;
  telephone: string | null;
  extension: string | null;
  roles: Role[];
  is_active: boolean;
  last_login_at?: string | null;
}

export interface ProjectType {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

export interface TemplateActivity {
  name: string;
  pic_label?: string;
  duration_days?: number;
  is_milestone?: boolean;
  tasks?: { name: string; task_type?: string; duration_days?: number }[];
}

export interface ProjectTemplate {
  id: number;
  code: string;
  name: string;
  project_type_id: number | null;
  description: string | null;
  default_activities: TemplateActivity[];
  evidence_checklist: string[];
  is_active: boolean;
}

export interface ProjectRequest {
  id: string;
  request_no: string | null;
  status: string;
  requestor_id: string;
  req_employee_id: string | null;
  req_full_name: string | null;
  req_department: string | null;
  req_section: string | null;
  req_email: string | null;
  req_telephone: string | null;
  req_extension: string | null;
  project_name: string;
  description: string | null;
  reason: string | null;
  expectation: string | null;
  priority: string;
  date_submitted: string | null;
  date_required: string | null;
  benefit: string | null;
  requestor_approver_id: string | null;
  authority_approver_id: string | null;
  project_type_id: number | null;
  template_id: number | null;
  proposed_leader_id: string | null;
  scope_assessment: string | null;
  reviewed_by: string | null;
  project_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalStep {
  id: string;
  request_id: string;
  cycle: number;
  step_no: number;
  step_code: 'requestor_approval' | 'system_review' | 'authority_approval';
  step_name: string;
  approver_id: string | null;
  approver_role: string;
  status: string;
  action: string | null;
  comment: string | null;
  acted_by: string | null;
  acted_at: string | null;
}

export interface ApprovalAction {
  id: string;
  request_id: string;
  step_id: string | null;
  step_code: string | null;
  action: string;
  comment: string | null;
  action_by: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  project_code: string;
  project_name: string;
  project_type_id: number | null;
  template_id: number | null;
  request_id: string | null;
  leader_id: string | null;
  sponsor: string | null;
  department: string | null;
  priority: string;
  start_date: string | null;
  target_date: string | null;
  forecast_date: string | null;
  status: string;
  progress: number;
  health: 'green' | 'yellow' | 'red';
  next_action: string | null;
  remark: string | null;
  baseline_version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ProjectView extends Project {
  project_type_code: string | null;
  project_type_name: string | null;
  leader_name: string | null;
  request_no: string | null;
  requestor_department: string | null;
  baseline_finish: string | null;
  schedule_variance: number | null;
  overdue_activities: number;
  delayed_without_recovery: number;
  activity_count: number;
  open_bugs: number;
  critical_bugs: number;
  retest_pending: number;
  retest_overdue: number;
  fix_overdue: number;
  evidence_missing: number;
  pending_revisions: number;
  attention: string[];
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  member_role: string;
  notify: boolean;
}

export interface Activity {
  id: string;
  project_id: string;
  seq: number;
  name: string;
  pic_user_id: string | null;
  pic_label: string | null;
  plan_start: string | null;
  plan_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  forecast_finish: string | null;
  progress: number;
  status: string;
  status_note: string | null;
  remark: string | null;
  next_action: string | null;
  delay_category: string | null;
  delay_reason: string | null;
  recovery_plan: string | null;
  delay_impact: string | null;
  recovery_owner_id: string | null;
  recovery_due_date: string | null;
  recovery_reviewed_by: string | null;
  recovery_reviewed_at: string | null;
  is_milestone: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface InternalTask {
  id: string;
  task_no: string | null;
  project_id: string;
  activity_id: string;
  parent_task_id: string | null;
  seq: number;
  name: string;
  task_type: string;
  owner_id: string;
  reviewer_id: string | null;
  priority: string;
  planned_start: string | null;
  due_date: string;
  actual_start: string | null;
  actual_finish: string | null;
  progress: number;
  status: string;
  description: string | null;
  technical_note: string | null;
  internal_comment: string | null;
  delay_category: string | null;
  delay_reason: string | null;
  recovery_action: string | null;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface TaskDependency {
  id: string;
  project_id: string;
  predecessor_id: string;
  successor_id: string;
  dep_type: string;
}

export interface Baseline {
  id: string;
  project_id: string;
  version_no: number;
  planned_start: string | null;
  planned_finish: string | null;
  target_date: string | null;
  reason: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
}

export interface BaselineItem {
  id: string;
  baseline_id: string;
  activity_id: string | null;
  seq: number;
  activity_name: string;
  pic: string | null;
  planned_start: string | null;
  planned_finish: string | null;
  is_milestone: boolean;
}

export type EntityType = 'request' | 'project' | 'activity' | 'task' | 'test_round' | 'bug' | 'fix' | 'retest';

export interface Evidence {
  id: string;
  project_id: string | null;
  request_id: string | null;
  entity_type: EntityType;
  entity_id: string;
  evidence_type: string;
  file_name: string | null;
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  file_size: number | null;
  description: string | null;
  is_required: boolean;
  is_internal: boolean;
  verification_status: string;
  verified_by: string | null;
  requirement_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  event_code: string;
  project_id: string | null;
  request_id: string | null;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationRule {
  event_code: string;
  name: string;
  recipient_roles: string[];
  channels: string[];
  escalation_days: number | null;
  escalate_after_days: number | null;
  escalate_roles: string[];
  is_active: boolean;
}

export interface AuditLog {
  id: number;
  table_name: string;
  entity_id: string | null;
  project_id: string | null;
  request_id: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Phase 2 — QA & Workflow Control
// ---------------------------------------------------------------------------
export interface TestRound {
  id: string;
  project_id: string;
  round_no: number;
  activity_id: string | null;
  title: string;
  test_type: string;
  tester_id: string | null;
  planned_date: string | null;
  due_date: string | null;
  actual_date: string | null;
  status: string;
  result: string | null;
  total_cases: number | null;
  passed_cases: number | null;
  failed_cases: number | null;
  summary: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface Bug {
  id: string;
  bug_no: string;
  project_id: string;
  test_round_id: string | null;
  activity_id: string | null;
  task_id: string | null;
  title: string;
  description: string | null;
  steps_to_reproduce: string | null;
  expected_result: string | null;
  actual_result: string | null;
  severity: string;
  priority: string;
  reporter_id: string | null;
  assigned_dev_id: string | null;
  supervisor_id: string | null;
  due_date: string | null;
  status: string;
  root_cause: string | null;
  root_cause_category: string | null;
  reopen_count: number;
  closed_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface BugFix {
  id: string;
  bug_id: string;
  project_id: string;
  fix_cycle: number;
  fix_owner_id: string;
  fix_start_date: string;
  fix_due_date: string | null;
  fix_description: string | null;
  technical_note: string | null;
  unit_test_result: string | null;
  build_link: string | null;
  commit_link: string | null;
  fix_ready_at: string | null;
  status: string;
  created_at: string;
}

export interface Retest {
  id: string;
  bug_id: string;
  project_id: string;
  fix_id: string | null;
  retest_round: number;
  tester_id: string | null;
  due_date: string | null;
  status: string;
  result: string | null;
  comment: string | null;
  tested_at: string | null;
  created_at: string;
}

export interface EvidenceRequirement {
  id: string;
  project_id: string;
  entity_type: 'project' | 'activity' | 'task';
  entity_id: string;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  source: string;
  created_at: string;
}

export interface BaselineRevision {
  id: string;
  project_id: string;
  from_version: number;
  reason: string;
  impact: string | null;
  previous_target_date: string | null;
  proposed_target_date: string | null;
  plan_snapshot: { activity_id: string; name: string; plan_start: string | null; plan_finish: string | null }[];
  status: string;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  baseline_id: string | null;
}

// ---------------------------------------------------------------------------
// Phase 3 — Management Intelligence
// ---------------------------------------------------------------------------
export interface KpiProject {
  project_id: string; project_code: string; project_name: string; leader_name: string | null; status: string; health: string;
  progress: number; start_date: string | null; target_date: string | null; forecast_date: string | null; baseline_finish: string | null;
  schedule_variance: number | null; completed_on: string | null; on_time: boolean | null; reschedules: number; waiting_days: number;
  tasks_total: number | null; tasks_completed: number | null; tasks_on_time_rate: number | null; overdue_tasks: number | null;
  evidence_total: number; evidence_done: number; evidence_completion: number | null;
  bugs_total: number; bugs_closed: number; bug_closure_rate: number | null; open_bugs: number;
  retests_done: number; retest_pass_rate: number | null;
}

export interface KpiTeam {
  total_projects: number; completed_projects: number; on_time_rate: number | null; delayed_projects: number; at_risk_projects: number;
  avg_schedule_variance: number | null; avg_waiting_days: number | null; overdue_tasks: number | null; evidence_completion_rate: number | null;
  tasks_completed: number | null; task_on_time_rate: number | null; bugs_reported: number; bugs_closed: number;
  avg_bug_resolution_days: number | null; retest_pass_rate: number | null;
}

export interface KpiIndividual {
  user_id: string; full_name: string; roles: string[];
  assigned_tasks: number; completed_tasks: number; on_time_tasks: number; late_tasks: number; excused_late: number;
  on_time_rate: number | null; avg_delay_days: number | null; overdue_tasks: number; open_tasks: number;
  bugs_assigned: number; fixes_ready: number; avg_fix_days: number | null; fix_first_time_pass_rate: number | null;
  evidence_completion: number | null; retests_done: number; avg_retest_turnaround_days: number | null;
}

export interface Insight {
  project_id: string | null; project_code: string | null; rule_code: string; severity: 'critical' | 'warning' | 'info';
  title: string; detail: string; entity_type: string; entity_id: string; link: string;
}

export interface InsightRule {
  code: string; name: string; description: string | null; severity: string; threshold: number | null;
  threshold_label: string | null; internal: boolean; is_active: boolean;
}

export interface WorkforcePlan {
  id: string; user_id: string; work_date: string; start_time: string | null; end_time: string | null; work_type: string;
  location: string | null; project_id: string | null; remark: string | null; created_by: string | null;
}

export interface KpiSnapshot {
  id: string; project_id: string; snapshot_date: string; progress: number; health: string; status: string;
  schedule_variance: number | null; overdue_tasks: number; open_bugs: number; evidence_completion: number | null; waiting_days: number;
}
