import enEnums from '@/i18n/messages/en/enums.json';
import type { Opt } from './constants';
import type { ApprovalStep, PositionLevel, Profile, ProjectRequest } from './types';

/**
 * Approval levels, lowest → highest ("X up" = X and every level after it).
 * A user's level comes from their position (positions.name, synced from AD); other positions cannot approve.
 * Labels: enums.positionLevel.<value>
 */
export const POSITION_LEVELS: (Opt & { position: string })[] = [
  { value: 'staff', position: 'STAFF' },
  { value: 'supervisor', position: 'SUPERVISOR' },
  { value: 'manager', position: 'MANAGER' },
  { value: 'gm', position: 'GENERAL MANAGER' },
  { value: 'factory_manager', position: 'FACTORY MANAGER' },
  { value: 'president', position: 'PRESIDENT' },
];

/** Approval level of a position name, or null */
export const levelOfPosition = (position: string | null | undefined): PositionLevel | null =>
  (POSITION_LEVELS.find((l) => l.position === position?.trim().toUpperCase())?.value as PositionLevel | undefined) ?? null;

/** Position names that hold one of the given levels */
export const positionsForLevels = (levels: string[]) => POSITION_LEVELS.filter((l) => levels.includes(l.value)).map((l) => l.position);

export const andUp = (level: PositionLevel) =>
  POSITION_LEVELS.slice(POSITION_LEVELS.findIndex((l) => l.value === level)).map((l) => l.value as PositionLevel);

/**
 * Stage of a step — decides the request status while it waits and who can be put on it:
 *   requestor: anyone at the step's levels in the requestor's department
 *   receive:   System Service receives the request and fills in Project Type / Template / Leader (exactly one per route)
 *   authority: System Service approvals
 * receive / authority steps go to the people picked in Admin → Document Types.
 */
export type RouteStage = 'requestor' | 'receive' | 'authority';
/** Labels: enums.routeStage / enums.routeGroup; `group` is the stored approver_role of the step */
export const ROUTE_STAGES: { value: RouteStage; group: string; status: string }[] = [
  { value: 'requestor', group: 'Requestor Approval', status: 'waiting_requestor_approval' },
  { value: 'receive', group: 'System Service Approval', status: 'waiting_system_review' },
  { value: 'authority', group: 'System Service Approval', status: 'waiting_authority_approval' },
];

/** One step of a document type's approval route (document_types.approval_route) */
export interface RouteStep {
  step_code: string;
  step_name: string;
  stage: RouteStage;
  /** requestor stage: levels allowed to act */
  levels?: PositionLevel[];
  /** receive / authority stage: picked approvers (profile ids) — any one of them may act */
  approvers?: number[] | number;
}

/** Picked approver ids of a step (also reads a single id) */
export const routeApprovers = (s: Pick<RouteStep, 'approvers'>): number[] =>
  s.approvers == null ? [] : (Array.isArray(s.approvers) ? s.approvers : [s.approvers]).map(Number);

/** Route a new document type starts with (same shape as Software Request) */
export const defaultRoute = (): RouteStep[] => [
  { step_code: 'requestor_check', step_name: 'Checked By', stage: 'requestor', levels: andUp('manager') },
  { step_code: 'requestor_approve', step_name: 'Approved By', stage: 'requestor', levels: andUp('gm') },
  { step_code: 'ss_receive', step_name: 'Received Request By', stage: 'receive', approvers: [] },
  { step_code: 'final_approve', step_name: 'Final Approved By', stage: 'authority', approvers: [] },
];

export type RouteProblem = keyof typeof enEnums.routeProblem;

/** Problems that make a route unusable (empty = ok); the same check runs on save in Admin and on submit. Text: enums.routeProblem.<code> */
export function routeProblems(route: RouteStep[]): RouteProblem[] {
  const out: RouteProblem[] = [];
  if (!route.length) out.push('noSteps');
  if (route.filter((s) => s.stage === 'receive').length !== 1) out.push('oneReceive');
  const order = route.map((s) => ROUTE_STAGES.findIndex((x) => x.value === s.stage));
  if (order.some((o, i) => o < 0 || (i > 0 && o < order[i - 1]))) out.push('stageOrder');
  if (route.some((s) => !s.step_name?.trim())) out.push('stepName');
  if (new Set(route.map((s) => s.step_code)).size !== route.length) out.push('uniqueCodes');
  if (route.some((s) => s.stage === 'requestor' && !s.levels?.length)) out.push('requestorLevel');
  return out;
}

/** English text of route problems (server errors) */
export const routeProblemsEn = (codes: RouteProblem[]) => codes.map((c) => enEnums.routeProblem[c]);

/** Stage of a saved step (steps created before stages existed are mapped by code) */
export function stepStage(s: Pick<ApprovalStep, 'stage' | 'step_code'>): RouteStage {
  if (s.stage) return s.stage as RouteStage;
  if (['requestor_check', 'requestor_approve', 'requestor_approval'].includes(s.step_code)) return 'requestor';
  if (['ss_receive', 'system_review'].includes(s.step_code)) return 'receive';
  return 'authority';
}

/** Request status while this step waits */
export const statusForStep = (s: Pick<ApprovalStep, 'stage' | 'step_code'>) => ROUTE_STAGES.find((x) => x.value === stepStage(s))!.status;

/** Heading the step is grouped under in the approval timeline (label: enums.routeGroup.<key>) */
export const stepGroup = (s: Pick<ApprovalStep, 'stage' | 'step_code'>): Exclude<RouteStage, 'authority'> => {
  const stage = stepStage(s);
  return stage === 'authority' ? 'receive' : stage; // receive + authority share the "System Service Approval" heading
};

/** Request number format tokens: {DOC} = document type code */
export function formatPrefix(format: string, doc: string, year: string) {
  return format.replaceAll('{DOC}', doc).replaceAll('{YYYY}', year).replaceAll('{YY}', year.slice(2)).replace(/\{SEQ:\d+\}/g, '#');
}

/** Who may act on a step: the lowest level, whether higher levels may too, and the department */
export function stepAudience(s: Pick<ApprovalStep, 'approver_levels' | 'approver_department'>) {
  const levels = s.approver_levels ?? [];
  return { level: levels[0] ?? null, andUp: levels.length > 1, department: s.approver_department ?? null };
}

/** Same rule as the server (convertRequestToProject): may `me` convert this approved request to a Controlled Project? */
export function canConvertRequest(
  r: Pick<ProjectRequest, 'status' | 'proposed_leader_id' | 'reviewed_by'>,
  me: Pick<Profile, 'id' | 'roles'> | null | undefined,
) {
  if (!me || r.status !== 'approved') return false;
  return me.roles.some((x) => x === 'admin' || x === 'system_reviewer') || r.proposed_leader_id === me.id || r.reviewed_by === me.id;
}

/** Same rule as the server (rpc/requests.ts): may `me` act on this step? */
export function canActOnStep(
  s: Pick<ApprovalStep, 'approver_id' | 'approver_ids' | 'approver_role' | 'approver_levels' | 'approver_department'>,
  me: Pick<Profile, 'id' | 'roles' | 'position' | 'department'> | null | undefined,
  requestorId?: number | null,
) {
  if (!me) return false;
  if (s.approver_levels) {
    const level = levelOfPosition(me.position);
    return me.id !== requestorId && !!level && s.approver_levels.includes(level)
      && (!s.approver_department || s.approver_department === me.department);
  }
  if (s.approver_ids?.length) return me.id !== requestorId && s.approver_ids.includes(me.id);
  return s.approver_id ? s.approver_id === me.id : me.roles.includes(s.approver_role as never);
}
