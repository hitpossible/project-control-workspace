// Loads report data from the Workspace (master data) — respects the viewer's access policies
import type { DbClient } from '@/lib/db/client';
import type {
  Activity, Baseline, BaselineItem, Evidence, EvidenceRequirement, Insight, KpiProject, KpiTeam, ProjectMember, ProjectView,
} from '../types';

export type ReportType = 'status' | 'meeting' | 'closure' | 'management';

export interface QaStats { open_bugs: number; critical_bugs: number; high_bugs: number; retest_pending: number; retest_overdue: number; fix_overdue: number; evidence_missing: number }

export interface ProjectReportData {
  project: ProjectView;
  activities: Activity[];
  members: ProjectMember[];
  baselines: Baseline[];
  baselineItems: BaselineItem[];
  insights: Insight[];
  kpi: KpiProject | null;
  requirements: EvidenceRequirement[];
  evidence: Evidence[];
  qa: QaStats | null;
  bugTotals: { total: number; closed: number } | null;
}

export interface ManagementReportData {
  from: string;
  to: string;
  projects: ProjectView[];
  team: KpiTeam | null;
  kpis: KpiProject[];
  insights: Insight[];
}

export interface ReportMeta {
  generatedBy: string;
  generatedAt: string;
  name: (id: string | null | undefined) => string;
}

export async function loadProjectReport(db: DbClient, projectId: string): Promise<ProjectReportData> {
  const [pv, acts, mem, bl, ins, kp, reqs, ev, qa, bugs] = await Promise.all([
    db.from('v_projects').select('*').eq('id', projectId).single(),
    db.from('activities').select('*').eq('project_id', projectId).order('seq'),
    db.from('project_members').select('*').eq('project_id', projectId),
    db.from('project_baselines').select('*').eq('project_id', projectId).order('version_no'),
    db.rpc('smart_insights', { p_project_id: projectId }),
    db.rpc('kpi_projects'),
    db.from('evidence_requirements').select('*').eq('project_id', projectId).order('created_at'),
    db.from('evidence').select('*').eq('project_id', projectId),
    db.rpc('project_qa_stats', { p_project_id: projectId }),
    db.from('bugs').select('status').eq('project_id', projectId),
  ]);
  if (pv.error) throw pv.error;
  const baselines = (bl.data ?? []) as Baseline[];
  const items = baselines.length
    ? ((await db.from('project_baseline_items').select('*').in('baseline_id', baselines.map((b) => b.id)).order('seq')).data ?? []) as BaselineItem[]
    : [];
  const bugRows = (bugs.data ?? []) as { status: string }[];
  return {
    project: pv.data as ProjectView,
    activities: (acts.data ?? []) as Activity[],
    members: (mem.data ?? []) as ProjectMember[],
    baselines,
    baselineItems: items,
    insights: (ins.data ?? []) as Insight[],
    kpi: ((kp.data ?? []) as KpiProject[]).find((k) => k.project_id === projectId) ?? null,
    requirements: (reqs.data ?? []) as EvidenceRequirement[],
    evidence: (ev.data ?? []) as Evidence[],
    qa: ((qa.data ?? []) as QaStats[])[0] ?? null,
    bugTotals: bugRows.length ? { total: bugRows.filter((b) => b.status !== 'cancelled').length, closed: bugRows.filter((b) => b.status === 'closed').length } : null,
  };
}

export async function loadManagementReport(db: DbClient, from: string, to: string): Promise<ManagementReportData> {
  const [pv, team, kp, ins] = await Promise.all([
    db.from('v_projects').select('*').order('project_code'),
    db.rpc('kpi_team', { p_from: from, p_to: to }),
    db.rpc('kpi_projects'),
    db.rpc('smart_insights', { p_project_id: null }),
  ]);
  return {
    from, to,
    projects: (pv.data ?? []) as ProjectView[],
    team: (team.data ?? null) as KpiTeam | null,
    kpis: (kp.data ?? []) as KpiProject[],
    insights: ((ins.data ?? []) as Insight[]).filter((i) => i.severity !== 'info'),
  };
}
