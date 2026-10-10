import { AppError, type Ctx } from '../db';
import { missingEvidence, projectQaStats } from '../logic/project';
import { canApproveBaseline, canManageProject, canQa, canViewInternal, canViewProject, hasRole } from '../perms';
import { cancelBaselineRevision, createBaseline, decideBaselineRevision, requestBaselineRevision, reviewRecoveryPlan } from './baseline';
import { smartInsights } from './insights';
import { kpiIndividual, kpiProjects, kpiTeam, triggerKpiSnapshot } from './kpi';
import { assignBug, cancelBug, markFixReady, recordRetest, reportBug, startFix } from './qa';
import { actOnApproval, cancelRequest, convertRequestToProject, saveReview, submitRequest } from './requests';
import { triggerNotificationScan } from './scan';

/* eslint-disable @typescript-eslint/no-explicit-any -- args come from JSON and are validated by each function */
type Fn = (ctx: Ctx, args: any) => Promise<unknown>;

const projectGuard = (fn: (ctx: Ctx, pid: string) => Promise<unknown>): Fn => async (ctx, a) => {
  if (!a?.p_project_id) throw new AppError('p_project_id is required');
  return fn(ctx, a.p_project_id);
};

/** Functions callable from the browser via POST /api/rpc/<name> (same names / args as the former Postgres RPCs) */
export const RPC: Record<string, Fn> = {
  // Request workflow
  submit_request: submitRequest,
  save_review: saveReview,
  act_on_approval: actOnApproval,
  cancel_request: cancelRequest,
  convert_request_to_project: convertRequestToProject,
  // Baseline / recovery
  create_baseline: createBaseline,
  request_baseline_revision: requestBaselineRevision,
  decide_baseline_revision: decideBaselineRevision,
  cancel_baseline_revision: cancelBaselineRevision,
  review_recovery_plan: reviewRecoveryPlan,
  // QA
  report_bug: reportBug,
  assign_bug: assignBug,
  start_fix: startFix,
  mark_fix_ready: markFixReady,
  record_retest: recordRetest,
  cancel_bug: cancelBug,
  // Jobs
  trigger_notification_scan: (ctx) => triggerNotificationScan(ctx),
  trigger_kpi_snapshot: (ctx) => triggerKpiSnapshot(ctx),
  // Intelligence
  kpi_projects: (ctx) => kpiProjects(ctx),
  kpi_team: kpiTeam,
  kpi_individual: kpiIndividual,
  smart_insights: smartInsights,
  project_qa_stats: projectGuard(async (ctx, pid) => {
    if (!(await canViewProject(ctx, pid))) throw new AppError('Not allowed', 403);
    return [await projectQaStats(ctx, pid)];
  }),
  // Permission helpers used by the UI
  has_role: async (ctx, a) => hasRole(ctx, String(a?.p_role ?? '')),
  can_view_internal: projectGuard(canViewInternal),
  can_manage_project: projectGuard(canManageProject),
  can_qa: projectGuard(canQa),
  can_approve_baseline: projectGuard(canApproveBaseline),
  missing_evidence: async (ctx, a) => missingEvidence(ctx, String(a.p_entity_type), String(a.p_entity_id)),
};
