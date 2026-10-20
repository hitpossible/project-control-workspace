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

const andUp = (level: PositionLevel) =>
  POSITION_LEVELS.slice(POSITION_LEVELS.findIndex((l) => l.value === level)).map((l) => l.value as PositionLevel);

export interface RouteStep {
  step_code: string;
  step_name: string;
  group: string;
  levels: PositionLevel[];
  /** whose department the approver must belong to; null = any */
  department: 'requestor' | 'system_service' | null;
}

/** The approval route every request follows (FM-SYS-004) */
export const APPROVAL_ROUTE: RouteStep[] = [
  { step_code: 'requestor_check', step_name: 'Checked By', group: 'Requestor Approval', levels: andUp('manager'), department: 'requestor' },
  { step_code: 'requestor_approve', step_name: 'Approved By', group: 'Requestor Approval', levels: andUp('gm'), department: 'requestor' },
  { step_code: 'ss_receive', step_name: 'Received Request By', group: 'System Service Approval', levels: andUp('supervisor'), department: 'system_service' },
  { step_code: 'ss_gm_approve', step_name: 'Approved Request By', group: 'System Service Approval', levels: andUp('gm'), department: 'system_service' },
  { step_code: 'ss_fm_approve', step_name: 'Approved Request By', group: 'System Service Approval', levels: ['factory_manager'], department: null },
  { step_code: 'final_approve', step_name: 'Final Approved By', group: 'System Service Approval', levels: ['president'], department: null },
];

/** Step where System Service fills in Project Type / Template / Project Leader */
export const RECEIVE_STEPS = ['ss_receive', 'system_review'];

export const levelLabel = (v: string | null | undefined) => POSITION_LEVELS.find((l) => l.value === v)?.label ?? v ?? '-';

/** "Manager up · Production" style description of who may act on a step */
export function stepAudience(s: Pick<ApprovalStep, 'approver_levels' | 'approver_department'>) {
  const levels = s.approver_levels ?? [];
  const who = levels.length === 1 ? levelLabel(levels[0]) : `${levelLabel(levels[0])} up`;
  return s.approver_department ? `${who} · ${s.approver_department}` : who;
}

export function routeGroup(code: string) {
  return APPROVAL_ROUTE.find((s) => s.step_code === code)?.group ?? null;
}

/** Same rule as the server (rpc/requests.ts): may `me` act on this step? */
export function canActOnStep(
  s: Pick<ApprovalStep, 'approver_id' | 'approver_role' | 'approver_levels' | 'approver_department'>,
  me: Pick<Profile, 'id' | 'roles' | 'position' | 'department'> | null | undefined,
  requestorId?: number | null,
) {
  if (!me) return false;
  if (s.approver_levels) {
    const level = levelOfPosition(me.position);
    return me.id !== requestorId && !!level && s.approver_levels.includes(level)
      && (!s.approver_department || s.approver_department === me.department);
  }
  return s.approver_id ? s.approver_id === me.id : me.roles.includes(s.approver_role as never);
}
