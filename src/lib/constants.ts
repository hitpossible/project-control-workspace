import enEnums from '@/i18n/messages/en/enums.json';
import type { ProjectRequest, Role } from './types';

export type EnumMessages = typeof enEnums;
/** Enum groups whose labels live in messages under enums.<ns>.<value> */
export type OptNs = { [K in keyof EnumMessages]: EnumMessages[K] extends Record<string, string> ? K : never }[keyof EnumMessages];

export type Opt = { value: string; color?: string };
/** Option list tagged with its message group — labels are never kept in code */
export type OptList = Opt[] & { ns: OptNs };

const opts = (ns: OptNs, items: Opt[]): OptList => Object.assign(items, { ns });

export const ROLES = opts('role', ([
  'requestor', 'requestor_approver', 'system_reviewer', 'authority_approver', 'project_leader',
  'developer', 'qa', 'supervisor', 'manager', 'management_view', 'admin',
] satisfies Role[]).map((value) => ({ value })));

export const SYSTEM_STAFF_ROLES: Role[] = ['system_reviewer', 'project_leader', 'developer', 'qa', 'supervisor', 'manager', 'admin'];

export const PRIORITIES = opts('priority', [
  { value: 'low', color: '#579bfc' },
  { value: 'medium', color: '#5559df' },
  { value: 'high', color: '#401694' },
  { value: 'critical', color: '#333333' },
]);

export const REQUEST_STATUSES = opts('requestStatus', [
  { value: 'draft', color: '#c4c4c4' },
  { value: 'submitted', color: '#579bfc' },
  { value: 'waiting_requestor_approval', color: '#fdab3d' },
  { value: 'waiting_system_review', color: '#fdab3d' },
  { value: 'need_more_information', color: '#a25ddc' },
  { value: 'waiting_authority_approval', color: '#fdab3d' },
  { value: 'approved', color: '#00c875' },
  { value: 'rejected', color: '#e2445c' },
  { value: 'converted', color: '#037f4c' },
  { value: 'cancelled', color: '#757575' },
]);

export const PROJECT_STATUSES = opts('projectStatus', [
  { value: 'draft', color: '#c4c4c4' },
  { value: 'planning', color: '#a25ddc' },
  { value: 'in_progress', color: '#fdab3d' },
  { value: 'waiting', color: '#ffcb00' },
  { value: 'on_hold', color: '#7f5347' },
  { value: 'at_risk', color: '#ff642e' },
  { value: 'delayed', color: '#e2445c' },
  { value: 'completed', color: '#00c875' },
  { value: 'cancelled', color: '#757575' },
]);

// Gantt status colors (PRD §13)
export const ACTIVITY_STATUSES = opts('activityStatus', [
  { value: 'not_started', color: '#c4c4c4' },
  { value: 'in_progress', color: '#fdab3d' },
  { value: 'waiting', color: '#ffcb00' },
  { value: 'delayed', color: '#e2445c' },
  { value: 'at_risk', color: '#ff642e' },
  { value: 'on_hold', color: '#7f5347' },
  { value: 'completed', color: '#00c875' },
  { value: 'cancelled', color: '#757575' },
]);

export const TASK_STATUSES = opts('taskStatus', [
  { value: 'todo', color: '#c4c4c4' },
  { value: 'in_progress', color: '#fdab3d' },
  { value: 'waiting', color: '#ffcb00' },
  { value: 'review', color: '#a25ddc' },
  { value: 'on_hold', color: '#7f5347' },
  { value: 'completed', color: '#00c875' },
  { value: 'cancelled', color: '#757575' },
]);

export const TASK_TYPES = opts('taskType', [
  { value: 'design' },
  { value: 'dev' },
  { value: 'qa' },
  { value: 'review' },
  { value: 'doc' },
  { value: 'deploy' },
  { value: 'support' },
  { value: 'other' },
]);

export const MEMBER_ROLES = opts('memberRole', [
  { value: 'leader' },
  { value: 'developer' },
  { value: 'qa' },
  { value: 'support' },
  { value: 'supervisor' },
  { value: 'manager' },
  { value: 'requestor_rep' },
]);

/** stored as the English text (delays.category) */
export const DELAY_CATEGORIES = opts('delayCategory', [{ value: 'Waiting User' }, { value: 'Requirement Change' }, { value: 'Resource Constraint' }, { value: 'Technical Issue' }, { value: 'Vendor' }, { value: 'Infrastructure' }, { value: 'Approval Delay' }, { value: 'Data Issue' }, { value: 'Testing Issue' }, { value: 'Other' }]);

export const EVIDENCE_TYPES = opts('evidenceType', [
  { value: 'document' },
  { value: 'excel' },
  { value: 'pdf' },
  { value: 'image' },
  { value: 'screenshot' },
  { value: 'log' },
  { value: 'email' },
  { value: 'meeting_note' },
  { value: 'url' },
  { value: 'sharepoint' },
  { value: 'git' },
  { value: 'build' },
  { value: 'other' },
]);

// Phase 2 — QA
export const SEVERITIES = opts('severity', [
  { value: 'low', color: '#579bfc' },
  { value: 'medium', color: '#fdab3d' },
  { value: 'high', color: '#ff642e' },
  { value: 'critical', color: '#bb3354' },
]);

export const BUG_STATUSES = opts('bugStatus', [
  { value: 'new', color: '#c4c4c4' },
  { value: 'assigned', color: '#579bfc' },
  { value: 'in_progress', color: '#fdab3d' },
  { value: 'fix_ready', color: '#a25ddc' },
  { value: 'retest', color: '#784bd1' },
  { value: 'reopened', color: '#e2445c' },
  { value: 'closed', color: '#00c875' },
  { value: 'cancelled', color: '#757575' },
]);

export const TEST_ROUND_STATUSES = opts('testRoundStatus', [
  { value: 'planned', color: '#c4c4c4' },
  { value: 'in_progress', color: '#fdab3d' },
  { value: 'completed', color: '#00c875' },
  { value: 'cancelled', color: '#757575' },
]);

export const TEST_RESULTS = opts('testResult', [
  { value: 'passed', color: '#00c875' },
  { value: 'failed', color: '#e2445c' },
  { value: 'partially_passed', color: '#fdab3d' },
  { value: 'blocked', color: '#333333' },
]);

export const TEST_TYPES = opts('testType', [
  { value: 'system' },
  { value: 'integration' },
  { value: 'regression' },
  { value: 'uat' },
  { value: 'smoke' },
  { value: 'performance' },
  { value: 'other' },
]);

/** stored as the English text */
export const ROOT_CAUSE_CATEGORIES = opts('rootCause', [{ value: 'Requirement' }, { value: 'Design' }, { value: 'Coding' }, { value: 'Data' }, { value: 'Configuration' }, { value: 'Environment' }, { value: 'Integration' }, { value: 'Third-party' }, { value: 'Other' }]);

export const REVISION_STATUSES = opts('revisionStatus', [
  { value: 'pending', color: '#fdab3d' },
  { value: 'approved', color: '#00c875' },
  { value: 'rejected', color: '#e2445c' },
  { value: 'cancelled', color: '#757575' },
]);

// Phase 3
export const WORK_TYPES = opts('workType', [
  { value: 'office', color: '#579bfc' },
  { value: 'onsite', color: '#a25ddc' },
  { value: 'wfh', color: '#66ccff' },
  { value: 'customer_site', color: '#784bd1' },
  { value: 'factory_support', color: '#fdab3d' },
  { value: 'training', color: '#037f4c' },
  { value: 'leave', color: '#e2445c' },
  { value: 'ot', color: '#333333' },
]);

export const INSIGHT_SEVERITIES = opts('insightSeverity', [
  { value: 'critical', color: '#e2445c' },
  { value: 'warning', color: '#fdab3d' },
  { value: 'info', color: '#579bfc' },
]);

export const HEALTH_COLORS: Record<string, string> = { green: '#00c875', yellow: '#fdab3d', red: '#e2445c' };

// monday.com group colors (board groups / avatars)
export const GROUP_COLORS = ['#579bfc', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#66ccff', '#ff642e', '#037f4c', '#bb3354', '#784bd1'];

/**
 * English label — for Excel / PDF exports and server code.
 * On screen use `useOptions().label` (src/i18n/useOptions.ts), which follows the UI language.
 */
export function optLabelEn(list: OptList, value: string | null | undefined) {
  if (!value) return '-';
  return (enEnums[list.ns] as Record<string, string>)[value] ?? value;
}

export function optColor(list: readonly Opt[], value: string | null | undefined) {
  return list.find((o) => o.value === value)?.color ?? '#9e9e9e';
}

/** Reduction rows on FM-SYS-004: current (From) → expected after the project (To); labels: enums.reduction.<key> */
export const REDUCTION_ROWS = [
  { key: 'time', from: 'reduction_time_from', to: 'reduction_time_to' },
  { key: 'man', from: 'reduction_man_from', to: 'reduction_man_to' },
  { key: 'cost', from: 'reduction_cost_from', to: 'reduction_cost_to' },
] as const satisfies readonly { key: keyof EnumMessages['reduction']; from: keyof ProjectRequest; to: keyof ProjectRequest }[];

export const SRS_STATUSES = opts('srsStatus', [
  { value: 'draft', color: '#c4c4c4' },
  { value: 'signing', color: '#fdab3d' },
  { value: 'signed', color: '#00c875' },
  { value: 'rejected', color: '#e2445c' },
  { value: 'cancelled', color: '#757575' },
  { value: 'superseded', color: '#a1a1a1' },
]);

export const SRS_SIGNER_STATUSES = opts('srsSignerStatus', [
  { value: 'pending', color: '#fdab3d' },
  { value: 'signed', color: '#00c875' },
  { value: 'rejected', color: '#e2445c' },
]);
