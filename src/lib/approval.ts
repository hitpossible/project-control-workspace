import type { Opt } from './constants';
import type { ApprovalStep, PositionLevel, Profile } from './types';

/**
 * Approval levels, lowest → highest ("X up" = X and every level after it).
 * A user's level comes from their position (positions.name, synced from AD); other positions cannot approve.
 */
export const POSITION_LEVELS: (Opt & { position: string })[] = [
  { value: 'staff', label: 'Staff', position: 'STAFF' },
  { value: 'supervisor', label: 'Supervisor', position: 'SUPERVISOR' },
  { value: 'manager', label: 'Manager', position: 'MANAGER' },
  { value: 'gm', label: 'GM', position: 'GENERAL MANAGER' },
  { value: 'factory_manager', label: 'Factory Manager', position: 'FACTORY MANAGER' },
  { value: 'president', label: 'President', position: 'PRESIDENT' },
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
export const ROUTE_STAGES: { value: RouteStage; label: string; group: string; status: string }[] = [
  { value: 'requestor', label: 'Requestor side', group: 'Requestor Approval', status: 'waiting_requestor_approval' },
  { value: 'receive', label: 'Receive', group: 'System Service Approval', status: 'waiting_system_review' },
  { value: 'authority', label: 'System Service side', group: 'System Service Approval', status: 'waiting_authority_approval' },
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

/** Problems that make a route unusable (empty = ok); the same check runs on save in Admin and on submit */
export function routeProblems(route: RouteStep[]): string[] {
  const out: string[] = [];
  if (!route.length) out.push('the route has no steps');
  if (route.filter((s) => s.stage === 'receive').length !== 1) out.push('the route needs exactly one Receive step');
  const order = route.map((s) => ROUTE_STAGES.findIndex((x) => x.value === s.stage));
  if (order.some((o, i) => o < 0 || (i > 0 && o < order[i - 1]))) out.push('steps must go Requestor side → Receive → System Service side');
  if (route.some((s) => !s.step_name?.trim())) out.push('every step needs a name');
  if (new Set(route.map((s) => s.step_code)).size !== route.length) out.push('step codes must be unique');
  if (route.some((s) => s.stage === 'requestor' && !s.levels?.length)) out.push('every Requestor side step needs a position level');
  return out;
}

/** Stage of a saved step (steps created before stages existed are mapped by code) */
export function stepStage(s: Pick<ApprovalStep, 'stage' | 'step_code'>): RouteStage {
  if (s.stage) return s.stage as RouteStage;
  if (['requestor_check', 'requestor_approve', 'requestor_approval'].includes(s.step_code)) return 'requestor';
  if (['ss_receive', 'system_review'].includes(s.step_code)) return 'receive';
  return 'authority';
}

/** Request status while this step waits */
export const statusForStep = (s: Pick<ApprovalStep, 'stage' | 'step_code'>) => ROUTE_STAGES.find((x) => x.value === stepStage(s))!.status;

/** Heading the step is grouped under in the approval timeline */
export const stepGroup = (s: Pick<ApprovalStep, 'stage' | 'step_code'>) => ROUTE_STAGES.find((x) => x.value === stepStage(s))!.group;

/** Request number format tokens: {DOC} = document type code */
export function formatPrefix(format: string, doc: string, year: string) {
  return format.replaceAll('{DOC}', doc).replaceAll('{YYYY}', year).replaceAll('{YY}', year.slice(2)).replace(/\{SEQ:\d+\}/g, '#');
}

export const levelLabel = (v: string | null | undefined) => POSITION_LEVELS.find((l) => l.value === v)?.label ?? v ?? '-';

/** "Manager up · Production" style description of who may act on a step */
export function stepAudience(s: Pick<ApprovalStep, 'approver_levels' | 'approver_department'>) {
  const levels = s.approver_levels ?? [];
  const who = levels.length === 1 ? levelLabel(levels[0]) : `${levelLabel(levels[0])} up`;
  return s.approver_department ? `${who} · ${s.approver_department}` : who;
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
