'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import AuditHistory from '@/components/AuditHistory';
import { useApp } from '@/components/AppProvider';
import { HealthDot, PageHeader, PriorityChip, entityKey, toId } from '@/components/common';
import ReportButton from '@/components/ReportButton';
import BaselineTab from '@/components/project/BaselineTab';
import DesignTab from '@/components/project/DesignTab';
import EvidenceTab from '@/components/project/EvidenceTab';
import InternalTab from '@/components/project/InternalTab';
import OverviewTab from '@/components/project/OverviewTab';
import PlanTab from '@/components/project/PlanTab';
import { CloseProjectButton, ProjectStatusMenu } from '@/components/project/ProjectStatus';
import QaTab from '@/components/project/QaTab';
import TeamTab from '@/components/project/TeamTab';
import type { ProjectData } from '@/components/project/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errMsg } from '@/lib/format';
import { exportProjectExcel } from '@/lib/exportExcel';
import { dbClient } from '@/lib/db/client';
import type { Activity, Baseline, BaselineItem, BaselineRevision, Bug, BugFix, Evidence, EvidenceRequirement, InternalTask, ProjectMember, ProjectView, Retest, TaskDependency, TestRound } from '@/lib/types';

function Workspace() {
  const tp = useTranslations('project');
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const db = dbClient();
  const { me, profiles, profileName, notify, hasRole } = useApp();
  const [data, setData] = useState<ProjectData | null>(null);
  const [perm, setPerm] = useState({ internal: false, manage: false });
  const [missing, setMissing] = useState(false);
  const tab = params.get('tab') ?? 'overview';

  const load = useCallback(async () => {
    const [pv, internal, manage] = await Promise.all([
      db.from('v_projects').select('*').eq('id', id).maybeSingle(),
      db.rpc('can_view_internal', { p_project_id: id }),
      db.rpc('can_manage_project', { p_project_id: id }),
    ]);
    if (!pv.data) return setMissing(true);
    const canInternal = !!internal.data;
    setPerm({ internal: canInternal, manage: !!manage.data });
    const none = Promise.resolve({ data: [] });
    const [acts, mem, bl, tasks, deps, reqs, ev, rounds, bugs, fixes, retests, revs] = await Promise.all([
      db.from('activities').select('*').eq('project_id', id).order('seq').order('plan_start'),
      db.from('project_members').select('*').eq('project_id', id).order('member_role'),
      db.from('project_baselines').select('*').eq('project_id', id).order('version_no', { ascending: false }),
      canInternal ? db.from('internal_tasks').select('*').eq('project_id', id).order('seq').order('task_no') : none,
      canInternal ? db.from('task_dependencies').select('*').eq('project_id', id) : none,
      db.from('evidence_requirements').select('*').eq('project_id', id).order('created_at'),
      db.from('evidence').select('*').eq('project_id', id),
      canInternal ? db.from('test_rounds').select('*').eq('project_id', id).order('round_no') : none,
      canInternal ? db.from('bugs').select('*').eq('project_id', id).order('created_at', { ascending: false }) : none,
      canInternal ? db.from('bug_fixes').select('*').eq('project_id', id).order('fix_cycle') : none,
      canInternal ? db.from('retests').select('*').eq('project_id', id).order('retest_round') : none,
      db.from('baseline_revisions').select('*').eq('project_id', id).order('requested_at', { ascending: false }),
    ]);
    const baselines = (bl.data ?? []) as Baseline[];
    const items = baselines.length
      ? ((await db.from('project_baseline_items').select('*').in('baseline_id', baselines.map((b) => b.id)).order('seq')).data ?? []) as BaselineItem[]
      : [];
    setData({
      project: pv.data as ProjectView,
      activities: (acts.data ?? []) as Activity[],
      members: (mem.data ?? []) as ProjectMember[],
      baselines,
      baselineItems: items,
      revisions: (revs.data ?? []) as BaselineRevision[],
      tasks: (tasks.data ?? []) as InternalTask[],
      deps: (deps.data ?? []) as TaskDependency[],
      requirements: (reqs.data ?? []) as EvidenceRequirement[],
      evidence: (ev.data ?? []) as Evidence[],
      rounds: (rounds.data ?? []) as TestRound[],
      bugs: (bugs.data ?? []) as Bug[],
      fixes: (fixes.data ?? []) as BugFix[],
      retests: (retests.data ?? []) as Retest[],
    });
  }, [db, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const memberProfiles = useMemo(() => {
    if (!data) return [];
    const ids = new Set([...data.members.map((m) => m.user_id), data.project.leader_id]);
    const list = profiles.filter((p) => ids.has(p.id));
    // System staff can be assigned even if not yet a member
    return list.length ? [...list, ...profiles.filter((p) => !ids.has(p.id) && p.roles.some((r) => ['developer', 'qa', 'project_leader', 'supervisor'].includes(r)))] : profiles;
  }, [data, profiles]);

  if (missing) return <Alert><AlertDescription>{tp('notFound')}</AlertDescription></Alert>;
  if (!data || !me) return null;
  const p = data.project;

  const setTab = (t: string) => router.replace(`/projects/${id}?tab=${t}`, { scroll: false });

  const tabs = [
    { v: 'overview', l: tp('tab.overview') },
    { v: 'plan', l: tp('tab.plan') },
    ...(perm.internal ? [{ v: 'internal', l: tp('tab.internal') }] : []),
    ...(perm.internal ? [{ v: 'qa', l: `${tp('tab.qa')}${p.open_bugs ? ` (${p.open_bugs})` : ''}` }] : []),
    ...(perm.internal ? [{ v: 'design', l: tp('tab.design') }] : []),
    { v: 'team', l: tp('tab.team') },
    { v: 'baseline', l: `${tp('tab.baseline')}${p.baseline_version ? ` (V${p.baseline_version})` : ''}` },
    { v: 'evidence', l: tp('tab.evidence') },
    ...(perm.internal ? [{ v: 'history', l: tp('tab.history') }] : []),
  ];

  // keyed by entityKey(): ids are per table, so activity 5 and task 5 are different things
  const names: Record<string, string> = Object.fromEntries([
    ...data.activities.map((a) => [entityKey('activity', a.id), a.name]),
    ...data.tasks.map((t) => [entityKey('task', t.id), `${t.task_no} ${t.name}`]),
    ...data.bugs.map((b) => [entityKey('bug', b.id), `${b.bug_no} ${b.title}`]),
    ...data.rounds.map((r) => [entityKey('test_round', r.id), `${tp('round', { no: r.round_no })} ${r.title}`]),
    [entityKey('project', p.id), p.project_code],
  ]);

  const ctx = { data, perm, reload: load, memberProfiles };
  const exportXlsx = async (includeInternal: boolean) => {
    try {
      await exportProjectExcel({ project: p, activities: data.activities, tasks: includeInternal ? data.tasks : undefined, bugs: includeInternal ? data.bugs : undefined, members: data.members, name: profileName, exportedBy: me.full_name, includeInternal });
    } catch (e) { notify(errMsg(e), 'error'); }
  };

  return (
    <>
      <PageHeader
        title={<span className="inline-flex items-center gap-2.5"><HealthDot value={p.health} />{p.project_code} — {p.project_name}</span>}
        subtitle={
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusMenu data={data} perm={perm} reload={load} />
            <PriorityChip value={p.priority} />
            <span className="text-xs">{p.project_type_name} · {tp('leader', { name: p.leader_name ?? '-' })}</span>
            {p.request_id && p.request_no && <span className="text-xs">· {tp('request')} <Link href={`/requests/${p.request_id}`} className="font-semibold text-primary">{p.request_no}</Link></span>}
          </div>
        }
        actions={<>
          <ReportButton projectId={p.id} code={p.project_code} />
          <Button variant="outline" onClick={() => exportXlsx(false)}><Download /> {tp('exportUserPlan')}</Button>
          {perm.internal && (hasRole('project_leader', 'supervisor', 'manager') || perm.manage) && (
            <Button onClick={() => exportXlsx(true)}><Download /> {tp('exportFull')}</Button>
          )}
          <CloseProjectButton data={data} perm={perm} reload={load} />
        </>}
      />
      <Tabs value={tabs.some((t) => t.v === tab) ? tab : 'overview'} onValueChange={setTab} className="no-print mb-5">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-grid">
          {tabs.map((t) => <TabsTrigger key={t.v} value={t.v} className="flex-none px-3">{t.l}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {/* keyed so the panel eases in on every tab switch */}
      <div key={tab} className="motion-rise">
      {tab === 'overview' && <OverviewTab {...ctx} />}
      {tab === 'plan' && <PlanTab {...ctx} />}
      {tab === 'internal' && perm.internal && <InternalTab {...ctx} focusTask={toId(params.get('task'))} focusPanel={params.get('panel')} />}
      {tab === 'qa' && perm.internal && <QaTab {...ctx} focusBug={toId(params.get('bug'))} focusPanel={params.get('panel')} />}
      {tab === 'design' && perm.internal && <DesignTab {...ctx} />}
      {tab === 'team' && <TeamTab {...ctx} />}
      {tab === 'baseline' && <BaselineTab {...ctx} />}
      {tab === 'evidence' && <EvidenceTab {...ctx} names={names} />}
      {tab === 'history' && perm.internal && <AuditHistory projectId={p.id} names={names} />}
      </div>
    </>
  );
}

export default function ProjectWorkspacePage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
