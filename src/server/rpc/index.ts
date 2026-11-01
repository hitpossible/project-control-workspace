import { AppError, type Ctx } from '../db';
import { missingEvidence, projectQaStats } from '../logic/project';
import { canApproveBaseline, canManageProject, canQa, canViewInternal, canViewProject, hasRole } from '../perms';
import { cancelBaselineRevision, createBaseline, decideBaselineRevision, requestBaselineRevision, reviewRecoveryPlan } from './baseline';
import { smartInsights } from './insights';
import { kpiIndividual, kpiProjects, kpiTeam, triggerKpiSnapshot } from './kpi';
import { agreeChangeRequest, assessChangeRequest, decideChangeRequest, implementChangeRequest, submitChangeRequest, withdrawChangeRequest } from './change-requests';
import { decideClosure, requestClosure, withdrawClosure } from './closure';
import { myPendingActions } from '../pending-actions';
import { assignBug, cancelBug, markFixReady, recordRetest, reportBug, startFix } from './qa';
import { actOnApproval, cancelRequest, convertRequestToProject, saveReview, submitRequest } from './requests';
import { triggerNotificationScan } from './scan';
import { cancelSrs, rejectSrs, saveSrsLayout, sendSrs } from '../srs';
import { globalSearch } from './search';
import { recommendMembers } from './skills';

/* eslint-disable @typescript-eslint/no-explicit-any -- args come from JSON and are validated by each function */
type Fn = (ctx: Ctx, args: any) => Promise<unknown>;

const projectGuard = (fn: (ctx: Ctx, pid: number) => Promise<unknown>): Fn => async (ctx, a) => {
  if (!a?.p_project_id) throw new AppError('p_project_id is required');
  return fn(ctx, Number(a.p_project_id));
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
  // Change requests (scope change after the project started)
  submit_change_request: submitChangeRequest,
  assess_change_request: assessChangeRequest,
  agree_change_request: agreeChangeRequest,
  decide_change_request: decideChangeRequest,
  implement_change_request: implementChangeRequest,
  withdraw_change_request: withdrawChangeRequest,
  my_pending_actions: (ctx) => myPendingActions(ctx),
  // Closure sign-off (projects from a request complete when the requestor accepts)
  request_closure: requestClosure,
  decide_closure: decideClosure,
  withdraw_closure: withdrawClosure,
  // SRS sign-off (upload and signing are routes under /api/srs: they carry a file / the signer's IP)
  srs_save_layout: saveSrsLayout,
  srs_send: sendSrs,
  srs_reject: rejectSrs,
  srs_cancel: cancelSrs,
  // Jobs
  trigger_notification_scan: (ctx) => triggerNotificationScan(ctx),
  trigger_kpi_snapshot: (ctx) => triggerKpiSnapshot(ctx),
  // Intelligence
  kpi_projects: (ctx) => kpiProjects(ctx),
  kpi_team: kpiTeam,
  kpi_individual: kpiIndividual,
  smart_insights: smartInsights,
  recommend_members: recommendMembers,
  project_qa_stats: projectGuard(async (ctx, pid) => {
    if (!(await canViewProject(ctx, pid))) throw new AppError('Not allowed', 403);
    return [await projectQaStats(ctx, pid)];
  }),
  global_search: globalSearch,
  // Permission helpers used by the UI
  has_role: async (ctx, a) => hasRole(ctx, String(a?.p_role ?? '')),
  can_view_internal: projectGuard(canViewInternal),
  can_manage_project: projectGuard(canManageProject),
  can_qa: projectGuard(canQa),
  can_approve_baseline: projectGuard(canApproveBaseline),
  missing_evidence: async (ctx, a) => missingEvidence(ctx, String(a.p_entity_type), Number(a.p_entity_id)),
};
