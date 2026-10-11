import type { Role } from './types';

export type Opt = { value: string; label: string; color?: string };

export const ROLE_LABELS: Record<Role, string> = {
  requestor: 'Requestor',
  requestor_approver: 'Requestor Approver',
  system_reviewer: 'System Service Reviewer',
  authority_approver: 'Authority Approver',
  project_leader: 'Project Leader',
  developer: 'Developer',
  qa: 'QA / Tester',
  supervisor: 'Supervisor',
  manager: 'Manager',
  management_view: 'Management / User View',
  admin: 'Administrator',
};

export const SYSTEM_STAFF_ROLES: Role[] = ['system_reviewer', 'project_leader', 'developer', 'qa', 'supervisor', 'manager', 'admin'];

export const PRIORITIES: Opt[] = [
  { value: 'low', label: 'Low', color: '#579bfc' },
  { value: 'medium', label: 'Medium', color: '#5559df' },
  { value: 'high', label: 'High', color: '#401694' },
  { value: 'critical', label: 'Critical ⚠', color: '#333333' },
];

export const REQUEST_STATUSES: Opt[] = [
  { value: 'draft', label: 'Draft', color: '#c4c4c4' },
  { value: 'submitted', label: 'Submitted', color: '#579bfc' },
  { value: 'waiting_requestor_approval', label: 'Waiting Requestor Approval', color: '#fdab3d' },
  { value: 'waiting_system_review', label: 'Waiting System Review', color: '#fdab3d' },
  { value: 'need_more_information', label: 'Need More Information', color: '#a25ddc' },
  { value: 'waiting_authority_approval', label: 'Waiting Authority Approval', color: '#fdab3d' },
  { value: 'approved', label: 'Approved', color: '#00c875' },
  { value: 'rejected', label: 'Rejected', color: '#e2445c' },
  { value: 'converted', label: 'Converted to Project', color: '#037f4c' },
  { value: 'cancelled', label: 'Cancelled', color: '#757575' },
];

export const PROJECT_STATUSES: Opt[] = [
  { value: 'draft', label: 'Draft', color: '#c4c4c4' },
  { value: 'planning', label: 'Planning', color: '#a25ddc' },
  { value: 'in_progress', label: 'Working on it', color: '#fdab3d' },
  { value: 'waiting', label: 'Waiting', color: '#ffcb00' },
  { value: 'on_hold', label: 'On Hold', color: '#7f5347' },
  { value: 'at_risk', label: 'At Risk', color: '#ff642e' },
  { value: 'delayed', label: 'Delayed', color: '#e2445c' },
  { value: 'completed', label: 'Done', color: '#00c875' },
  { value: 'cancelled', label: 'Cancelled', color: '#757575' },
];

// Gantt status colors (PRD §13)
export const ACTIVITY_STATUSES: Opt[] = [
  { value: 'not_started', label: 'Not Started', color: '#c4c4c4' },
  { value: 'in_progress', label: 'Working on it', color: '#fdab3d' },
  { value: 'waiting', label: 'Waiting', color: '#ffcb00' },
  { value: 'delayed', label: 'Delayed', color: '#e2445c' },
  { value: 'at_risk', label: 'At Risk', color: '#ff642e' },
  { value: 'on_hold', label: 'On Hold', color: '#7f5347' },
  { value: 'completed', label: 'Done', color: '#00c875' },
  { value: 'cancelled', label: 'Cancelled', color: '#757575' },
];

export const TASK_STATUSES: Opt[] = [
  { value: 'todo', label: 'To Do', color: '#c4c4c4' },
  { value: 'in_progress', label: 'Working on it', color: '#fdab3d' },
  { value: 'waiting', label: 'Waiting', color: '#ffcb00' },
  { value: 'review', label: 'Review', color: '#a25ddc' },
  { value: 'on_hold', label: 'On Hold', color: '#7f5347' },
  { value: 'completed', label: 'Done', color: '#00c875' },
  { value: 'cancelled', label: 'Cancelled', color: '#757575' },
];

export const TASK_TYPES: Opt[] = [
  { value: 'design', label: 'Design' },
  { value: 'dev', label: 'Dev' },
  { value: 'qa', label: 'QA' },
  { value: 'review', label: 'Review' },
  { value: 'doc', label: 'Document' },
  { value: 'deploy', label: 'Deploy' },
  { value: 'support', label: 'Support' },
  { value: 'other', label: 'Other' },
];

export const MEMBER_ROLES: Opt[] = [
  { value: 'leader', label: 'Project Leader' },
  { value: 'developer', label: 'Developer' },
  { value: 'qa', label: 'QA' },
  { value: 'support', label: 'Support' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Manager' },
  { value: 'requestor_rep', label: 'Requestor Representative' },
];

export const DELAY_CATEGORIES = [
  'Waiting User',
  'Requirement Change',
  'Resource Constraint',
  'Technical Issue',
  'Vendor',
  'Infrastructure',
  'Approval Delay',
  'Data Issue',
  'Testing Issue',
  'Other',
];

export const EVIDENCE_TYPES: Opt[] = [
  { value: 'document', label: 'Document' },
  { value: 'excel', label: 'Excel' },
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: 'Image' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'log', label: 'Log File' },
  { value: 'email', label: 'Email' },
  { value: 'meeting_note', label: 'Meeting Note' },
  { value: 'url', label: 'URL' },
  { value: 'sharepoint', label: 'SharePoint Link' },
  { value: 'git', label: 'Git Repository / PR Link' },
  { value: 'build', label: 'Build Link' },
  { value: 'other', label: 'Other' },
];

// Phase 2 — QA
export const SEVERITIES: Opt[] = [
  { value: 'low', label: 'Low', color: '#579bfc' },
  { value: 'medium', label: 'Medium', color: '#fdab3d' },
  { value: 'high', label: 'High', color: '#ff642e' },
  { value: 'critical', label: 'Critical', color: '#bb3354' },
];

export const BUG_STATUSES: Opt[] = [
  { value: 'new', label: 'New', color: '#c4c4c4' },
  { value: 'assigned', label: 'Assigned', color: '#579bfc' },
  { value: 'in_progress', label: 'Fixing', color: '#fdab3d' },
  { value: 'fix_ready', label: 'Fix Ready', color: '#a25ddc' },
  { value: 'retest', label: 'Retest', color: '#784bd1' },
  { value: 'reopened', label: 'Reopened', color: '#e2445c' },
  { value: 'closed', label: 'Closed', color: '#00c875' },
  { value: 'cancelled', label: 'Cancelled', color: '#757575' },
];

export const TEST_ROUND_STATUSES: Opt[] = [
  { value: 'planned', label: 'Planned', color: '#c4c4c4' },
  { value: 'in_progress', label: 'Testing', color: '#fdab3d' },
  { value: 'completed', label: 'Completed', color: '#00c875' },
  { value: 'cancelled', label: 'Cancelled', color: '#757575' },
];

export const TEST_RESULTS: Opt[] = [
  { value: 'passed', label: 'Passed', color: '#00c875' },
  { value: 'failed', label: 'Failed', color: '#e2445c' },
  { value: 'partially_passed', label: 'Partially Passed', color: '#fdab3d' },
  { value: 'blocked', label: 'Blocked', color: '#333333' },
];

export const TEST_TYPES: Opt[] = [
  { value: 'system', label: 'System Test' },
  { value: 'integration', label: 'Integration' },
  { value: 'regression', label: 'Regression' },
  { value: 'uat', label: 'UAT' },
  { value: 'smoke', label: 'Smoke' },
  { value: 'performance', label: 'Performance' },
  { value: 'other', label: 'Other' },
];

export const ROOT_CAUSE_CATEGORIES = ['Requirement', 'Design', 'Coding', 'Data', 'Configuration', 'Environment', 'Integration', 'Third-party', 'Other'];

export const REVISION_STATUSES: Opt[] = [
  { value: 'pending', label: 'Waiting Approval', color: '#fdab3d' },
  { value: 'approved', label: 'Approved', color: '#00c875' },
  { value: 'rejected', label: 'Rejected', color: '#e2445c' },
  { value: 'cancelled', label: 'Cancelled', color: '#757575' },
];

// Phase 3
export const WORK_TYPES: Opt[] = [
  { value: 'office', label: 'Office', color: '#579bfc' },
  { value: 'onsite', label: 'Onsite', color: '#a25ddc' },
  { value: 'wfh', label: 'Work from Home', color: '#66ccff' },
  { value: 'customer_site', label: 'Customer Site', color: '#784bd1' },
  { value: 'factory_support', label: 'Factory Support', color: '#fdab3d' },
  { value: 'training', label: 'Training', color: '#037f4c' },
  { value: 'leave', label: 'Leave', color: '#e2445c' },
  { value: 'ot', label: 'OT Plan', color: '#333333' },
];

export const INSIGHT_SEVERITIES: Opt[] = [
  { value: 'critical', label: 'Critical', color: '#e2445c' },
  { value: 'warning', label: 'Warning', color: '#fdab3d' },
  { value: 'info', label: 'Info', color: '#579bfc' },
];

export const HEALTH_COLORS: Record<string, string> = { green: '#00c875', yellow: '#fdab3d', red: '#e2445c' };

// monday.com group colors (board groups / avatars)
export const GROUP_COLORS = ['#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#66ccff', '#ff642e', '#037f4c', '#bb3354', '#784bd1'];

export const APPROVAL_ACTION_LABELS: Record<string, string> = {
  submit: 'Submitted',
  resubmit: 'Re-submitted',
  approve: 'Approved',
  reject: 'Rejected',
  send_back: 'Sent Back',
  request_more_info: 'Requested More Information',
  cancel: 'Cancelled',
  convert: 'Converted to Project',
};

export function optLabel(list: Opt[], value: string | null | undefined) {
  return list.find((o) => o.value === value)?.label ?? value ?? '-';
}

export function optColor(list: Opt[], value: string | null | undefined) {
  return list.find((o) => o.value === value)?.color ?? '#9e9e9e';
}
