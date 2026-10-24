import type { RouteStep } from './approval';
import type { AiAnalysis, AiCoverage, ChatMessage, ClarifyCriterion } from './clarify';

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

export type PositionLevel = 'staff' | 'supervisor' | 'manager' | 'gm' | 'factory_manager' | 'president';

export interface Profile {
  id: number;
  /** AD / company login name */
  username: string | null;
  employee_id: string | null;
  full_name: string;
  email: string | null;
  department_id: number | null;
  section_id: number | null;
  position_id: number | null;
  /** names joined from departments / sections / positions (not columns of profiles) */
  department?: string | null;
  section?: string | null;
  position?: string | null;
  telephone: string | null;
  extension: string | null;
  roles: Role[];
  is_active: boolean;
  last_login_at?: string | null;
}

export interface Department {
  id: number;
  code: string | null;
  name: string;
  is_active: boolean;
}

export interface Position {
  id: number;
  name: string;
}

export interface Section {
  id: number;
  department_id: number;
  code: string | null;
  name: string;
  is_active: boolean;
}

export interface ProjectType {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

/** Kind of request document — own number format (running number) and approval route */
export interface DocumentType {
  id: number;
  code: string;
  name: string;
  form_no: string | null;
  request_no_format: string;
  approval_route: RouteStep[];
  /** what the AI asks the requestor about before submit; empty = no AI questions */
  clarify_criteria: ClarifyCriterion[] | null;
  sort_order: number;
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

export interface AiClarification {
  /** ClarifyCriterion.key the question is about */
  criterion?: string | null;
  question: string;
  /** null = skipped */
  answer: string | null;
  asked_at: string;
}

export interface ProjectRequest {
  id: number;
  request_no: string | null;
  document_type_id: number;
  status: string;
  requestor_id: number;
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
  /** legacy free text, no longer on the form */
  benefit: string | null;
  reduction_time_from: number | null;
  reduction_time_to: number | null;
  reduction_man_from: number | null;
  reduction_man_to: number | null;
  reduction_cost_from: number | null;
  reduction_cost_to: number | null;
  /** legacy: follow-up questions from the form-style AI dialog, with the requestor's answers */
  ai_clarifications: AiClarification[] | null;
  /** the AI's last check of the document type's criteria */
  ai_coverage: AiCoverage | null;
  /** the requestor's conversation with the AI before submit */
  ai_chat: ChatMessage[] | null;
  /** the AI's initial analysis for System Service, written after submit */
  ai_analysis: AiAnalysis | null;
  /** legacy: approvers were picked per request before the fixed approval route */
  requestor_approver_id: number | null;
  authority_approver_id: number | null;
  project_type_id: number | null;
  template_id: number | null;
  proposed_leader_id: number | null;
  scope_assessment: string | null;
  /** System Service's effort estimate in man-days, entered at review */
  estimated_md: number | null;
  reviewed_by: number | null;
  project_id: number | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalStep {
  id: number;
  request_id: number;
  cycle: number;
  step_no: number;
  /** copied from the document type's route; requestor_approval / system_review / authority_approval = steps created before the fixed route */
  step_code: string;
  step_name: string;
  /** RouteStage; null = step created before stages (see stepStage) */
  stage: string | null;
  approver_id: number | null;
  /** picked approvers (any one may act); null = matched by approver_levels or legacy */
  approver_ids: number[] | null;
  approver_role: string;
  /** levels allowed to act; null = legacy step (approver_id / approver_role) */
  approver_levels: PositionLevel[] | null;
  approver_department: string | null;
  status: string;
  action: string | null;
  comment: string | null;
  acted_by: number | null;
  acted_at: string | null;
}

export interface ApprovalAction {
  id: number;
  request_id: number;
  step_id: number | null;
  step_code: string | null;
  action: string;
  comment: string | null;
  action_by: number | null;
  created_at: string;
}

export interface Project {
  id: number;
  project_code: string;
  project_name: string;
  project_type_id: number | null;
  template_id: number | null;
  request_id: number | null;
  leader_id: number | null;
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
  updated_by: number | null;
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
  id: number;
  project_id: number;
  user_id: number;
  member_role: string;
  notify: boolean;
}

export interface Activity {
  id: number;
  project_id: number;
  seq: number;
  name: string;
  pic_user_id: number | null;
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
  recovery_owner_id: number | null;
  recovery_due_date: string | null;
  recovery_reviewed_by: number | null;
  recovery_reviewed_at: string | null;
  is_milestone: boolean;
  updated_at: string;
  updated_by: number | null;
}

export interface InternalTask {
  id: number;
  task_no: string | null;
  project_id: number;
  activity_id: number;
  parent_task_id: number | null;
  seq: number;
  /** Kanban order within its status column; null = by due date */
  board_rank: number | null;
  name: string;
  task_type: string;
  owner_id: number;
  reviewer_id: number | null;
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
  created_by: number | null;
  updated_at: string;
  updated_by: number | null;
}

export interface TaskDependency {
  id: number;
  project_id: number;
  predecessor_id: number;
  successor_id: number;
  dep_type: string;
}

export interface Baseline {
  id: number;
  project_id: number;
  version_no: number;
  planned_start: string | null;
  planned_finish: string | null;
  target_date: string | null;
  reason: string | null;
  created_by: number | null;
  approved_by: number | null;
  created_at: string;
}

export interface BaselineItem {
  id: number;
  baseline_id: number;
  activity_id: number | null;
  seq: number;
  activity_name: string;
  pic: string | null;
  planned_start: string | null;
  planned_finish: string | null;
  is_milestone: boolean;
}

export type EntityType = 'request' | 'project' | 'activity' | 'task' | 'test_round' | 'bug' | 'fix' | 'retest';

export interface Evidence {
  id: number;
  project_id: number | null;
  request_id: number | null;
  entity_type: EntityType;
  entity_id: number;
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
  verified_by: number | null;
  requirement_id: number | null;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface Notification {
  id: number;
  user_id: number;
  event_code: string;
  project_id: number | null;
  request_id: number | null;
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
  entity_id: number | null;
  project_id: number | null;
  request_id: number | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Phase 2 — QA & Workflow Control
// ---------------------------------------------------------------------------
export interface TestRound {
  id: number;
  project_id: number;
  round_no: number;
  activity_id: number | null;
  title: string;
  test_type: string;
  tester_id: number | null;
  planned_date: string | null;
  due_date: string | null;
  actual_date: string | null;
  status: string;
  result: string | null;
  total_cases: number | null;
  passed_cases: number | null;
  failed_cases: number | null;
  summary: string | null;
  created_by: number | null;
  updated_at: string;
}

export interface Bug {
  id: number;
  bug_no: string;
  project_id: number;
  test_round_id: number | null;
  activity_id: number | null;
  task_id: number | null;
  title: string;
  description: string | null;
  steps_to_reproduce: string | null;
  expected_result: string | null;
  actual_result: string | null;
  severity: string;
  priority: string;
  reporter_id: number | null;
  assigned_dev_id: number | null;
  supervisor_id: number | null;
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
  id: number;
  bug_id: number;
  project_id: number;
  fix_cycle: number;
  fix_owner_id: number;
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
  id: number;
  bug_id: number;
  project_id: number;
  fix_id: number | null;
  retest_round: number;
  tester_id: number | null;
  due_date: string | null;
  status: string;
  result: string | null;
  comment: string | null;
  tested_at: string | null;
  created_at: string;
}

export interface EvidenceRequirement {
  id: number;
  project_id: number;
  entity_type: 'project' | 'activity' | 'task';
  entity_id: number;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  source: string;
  created_at: string;
}

export interface BaselineRevision {
  id: number;
  project_id: number;
  from_version: number;
  reason: string;
  impact: string | null;
  previous_target_date: string | null;
  proposed_target_date: string | null;
  plan_snapshot: { activity_id: number; name: string; plan_start: string | null; plan_finish: string | null }[];
  status: string;
  requested_by: number | null;
  requested_at: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_comment: string | null;
  baseline_id: number | null;
}

// ---------------------------------------------------------------------------
// Phase 3 — Management Intelligence
// ---------------------------------------------------------------------------
export interface KpiProject {
  project_id: number; project_code: string; project_name: string; leader_name: string | null; status: string; health: string;
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
  user_id: number; full_name: string; roles: string[];
  assigned_tasks: number; completed_tasks: number; on_time_tasks: number; late_tasks: number; excused_late: number;
  on_time_rate: number | null; avg_delay_days: number | null; overdue_tasks: number; open_tasks: number;
  bugs_assigned: number; fixes_ready: number; avg_fix_days: number | null; fix_first_time_pass_rate: number | null;
  evidence_completion: number | null; retests_done: number; avg_retest_turnaround_days: number | null;
}

export interface Insight {
  project_id: number | null; project_code: string | null; rule_code: string; severity: 'critical' | 'warning' | 'info';
  title: string; detail: string; entity_type: string; entity_id: number; link: string;
}

export interface InsightRule {
  code: string; name: string; description: string | null; severity: string; threshold: number | null;
  threshold_label: string | null; internal: boolean; is_active: boolean;
}

export interface WorkforcePlan {
  id: number; user_id: number; work_date: string; start_time: string | null; end_time: string | null; work_type: string;
  location: string | null; project_id: number | null; remark: string | null; created_by: number | null;
}

export interface KpiSnapshot {
  id: number; project_id: number; snapshot_date: string; progress: number; health: string; status: string;
  schedule_variance: number | null; overdue_tasks: number; open_bugs: number; evidence_completion: number | null; waiting_days: number;
}

export interface Comment {
  id: number; project_id: number; entity_type: 'task' | 'bug'; entity_id: number; body: string;
  mentions: number[]; created_by: number; created_at: string; edited_at: string | null;
}

// SRS sign-off (db/migrations/015_srs_signing.sql)
export type SrsStatus = 'draft' | 'signing' | 'signed' | 'rejected' | 'cancelled' | 'superseded';
export type SrsFieldKind = 'signature' | 'name' | 'date';

export interface SrsDocument {
  id: number;
  project_id: number;
  version_no: number;
  title: string;
  file_name: string;
  original_sha256: string;
  page_count: number;
  /** page size as displayed (points, rotation applied) */
  pages: { w: number; h: number }[];
  stamped_sha256: string | null;
  requirement_id: number | null;
  evidence_id: number | null;
  status: SrsStatus;
  sent_at: string | null;
  completed_at: string | null;
  created_by: number | null;
  created_at: string;
}

export interface SrsSigner {
  id: number;
  srs_id: number;
  project_id: number;
  signer_id: number;
  seq: number;
  role_label: string | null;
  status: 'pending' | 'signed' | 'rejected';
  signed_at: string | null;
  doc_sha256: string | null;
  comment: string | null;
  ip: string | null;
  user_agent: string | null;
}

/** box as fractions of the displayed page, origin top-left */
export interface SrsField {
  id: number;
  srs_id: number;
  signer_row_id: number;
  kind: SrsFieldKind;
  page_no: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
