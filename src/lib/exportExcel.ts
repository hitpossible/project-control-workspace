// Excel export — always generated from Workspace data (Workspace = Source of Truth, Excel = Output)
import dayjs from 'dayjs';
import { ACTIVITY_STATUSES, BUG_STATUSES, INSIGHT_SEVERITIES, WORK_TYPES, MEMBER_ROLES, PROJECT_STATUSES, SEVERITIES, TASK_STATUSES, TASK_TYPES, optColor, optLabel } from './constants';
import type { Activity, Bug, Insight, InternalTask, KpiIndividual, KpiProject, KpiTeam, ProjectMember, ProjectView, WorkforcePlan } from './types';

type Wb = import('exceljs').Workbook;
type Ws = import('exceljs').Worksheet;

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();
const d = (v: string | null | undefined) => (v ? dayjs(v).toDate() : null);
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0D47A1' } };

function styleHeader(ws: Ws, rowNo: number) {
  const row = ws.getRow(rowNo);
  row.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF9FB3D9' } } };
  });
  row.height = 30;
}

function download(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function summarySheet(wb: Wb, p: ProjectView, members: ProjectMember[], name: (id: string | null) => string, exportedBy: string) {
  const ws = wb.addWorksheet('Project Summary');
  ws.columns = [{ width: 26 }, { width: 70 }];
  ws.mergeCells('A1:B1');
  ws.getCell('A1').value = `${p.project_code} — ${p.project_name}`;
  ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF0D47A1' } };
  const rows: [string, unknown][] = [
    ['Project Code', p.project_code],
    ['Project Name', p.project_name],
    ['Project Type', p.project_type_name],
    ['Request Reference', p.request_no],
    ['Project Leader', p.leader_name],
    ['Sponsor', p.sponsor],
    ['Requestor Department', p.requestor_department ?? p.department],
    ['Priority', p.priority],
    ['Start Date', d(p.start_date)],
    ['Target Date', d(p.target_date)],
    ['Baseline Finish', d(p.baseline_finish)],
    ['Forecast Finish', d(p.forecast_date)],
    ['Schedule Variance (days)', p.schedule_variance ?? '-'],
    ['Baseline Version', p.baseline_version ? `V${p.baseline_version}` : 'Not set'],
    ['Status', optLabel(PROJECT_STATUSES, p.status)],
    ['Health', p.health.toUpperCase()],
    ['Progress', Number(p.progress) / 100],
    ['Next Action', p.next_action],
    ['Remark', p.remark],
    ['Need Attention', p.attention.join('; ') || '-'],
  ];
  rows.forEach(([k, v], i) => {
    const r = ws.getRow(i + 3);
    r.getCell(1).value = k;
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F9' } };
    r.getCell(2).value = v as never;
    if (v instanceof Date) r.getCell(2).numFmt = 'dd-mmm-yyyy';
    if (k === 'Progress') r.getCell(2).numFmt = '0%';
    if (k === 'Health') r.getCell(2).font = { bold: true, color: { argb: argb({ GREEN: '#43a047', YELLOW: '#f9a825', RED: '#e53935' }[p.health.toUpperCase()] ?? '#000000') } };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });
  let r = rows.length + 5;
  ws.getCell(`A${r}`).value = 'Project Team';
  ws.getCell(`A${r}`).font = { bold: true, size: 12 };
  r++;
  members.forEach((m) => {
    ws.getCell(`A${r}`).value = optLabel(MEMBER_ROLES, m.member_role);
    ws.getCell(`B${r}`).value = name(m.user_id);
    r++;
  });
  r++;
  ws.getCell(`A${r}`).value = 'Exported';
  ws.getCell(`B${r}`).value = `${dayjs().format('DD MMM YYYY HH:mm')} by ${exportedBy} — generated from Project Control Workspace (master data)`;
  ws.getCell(`B${r}`).font = { italic: true, color: { argb: 'FF777777' } };
}

function planSheet(wb: Wb, p: ProjectView, acts: Activity[], picName: (a: Activity) => string) {
  const ws = wb.addWorksheet('User Control Plan', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
  const fixed = ['No', 'Activity', 'PIC', 'Plan Start', 'Plan Finish', 'Actual Start', 'Actual Finish', 'Progress', 'Status', 'Status Note', 'Next Action', 'Recovery Plan', 'Remark'];
  const widths = [5, 30, 16, 12, 12, 12, 12, 9, 13, 28, 28, 30, 24];

  const dates = acts.flatMap((a) => [a.plan_start, a.plan_finish, a.actual_start, a.actual_finish, a.forecast_finish]).filter(Boolean) as string[];
  const min = dayjs(dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : p.start_date ?? undefined).startOf('week').add(1, 'day');
  const maxD = dayjs(dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : p.target_date ?? undefined);
  const weeks: dayjs.Dayjs[] = [];
  for (let w = min; w.isBefore(maxD.add(7, 'day')) && weeks.length < 80; w = w.add(7, 'day')) weeks.push(w);

  ws.mergeCells(1, 1, 1, fixed.length);
  ws.getCell(1, 1).value = `Action Plan & Result — ${p.project_code} ${p.project_name}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF0D47A1' } };
  ws.mergeCells(2, 1, 2, fixed.length);
  ws.getCell(2, 1).value = `Leader: ${p.leader_name ?? '-'}   Target: ${p.target_date ? dayjs(p.target_date).format('DD MMM YYYY') : '-'}   Forecast: ${p.forecast_date ? dayjs(p.forecast_date).format('DD MMM YYYY') : '-'}   Progress: ${Math.round(p.progress)}%   Status: ${optLabel(PROJECT_STATUSES, p.status)}`;

  // month header (row 3) + week header (row 4)
  weeks.forEach((w, i) => {
    const c = ws.getCell(3, fixed.length + 1 + i);
    if (i === 0 || w.month() !== weeks[i - 1].month()) {
      c.value = w.format('MMM YY');
      c.font = { bold: true, size: 9 };
    }
  });
  const header = ws.getRow(4);
  fixed.forEach((h, i) => (header.getCell(i + 1).value = h));
  weeks.forEach((w, i) => (header.getCell(fixed.length + 1 + i).value = w.format('D')));
  styleHeader(ws, 4);
  widths.forEach((wd, i) => (ws.getColumn(i + 1).width = wd));
  weeks.forEach((_, i) => (ws.getColumn(fixed.length + 1 + i).width = 3.6));

  const todayIdx = weeks.findIndex((w) => !dayjs().isBefore(w) && dayjs().isBefore(w.add(7, 'day')));

  acts.forEach((a, idx) => {
    const r = ws.getRow(5 + idx);
    const vals = [idx + 1, a.name, picName(a), d(a.plan_start), d(a.plan_finish), d(a.actual_start), d(a.actual_finish),
      Number(a.progress) / 100, optLabel(ACTIVITY_STATUSES, a.status), a.status_note, a.next_action, a.recovery_plan, a.remark];
    vals.forEach((v, i) => (r.getCell(i + 1).value = v as never));
    [4, 5, 6, 7].forEach((c) => (r.getCell(c).numFmt = 'dd-mmm-yy'));
    r.getCell(8).numFmt = '0%';
    const color = optColor(ACTIVITY_STATUSES, a.status);
    r.getCell(9).font = { bold: true, color: { argb: argb(color) } };
    for (let c = 1; c <= fixed.length; c++) r.getCell(c).alignment = { vertical: 'middle', wrapText: c >= 10 || c === 2 };
    const overdue = a.plan_finish && dayjs(a.plan_finish).isBefore(dayjs(), 'day') && !['completed', 'cancelled'].includes(a.status);
    if (overdue) r.getCell(2).font = { bold: true, color: { argb: 'FFE53935' } };

    weeks.forEach((w, i) => {
      const cell = r.getCell(fixed.length + 1 + i);
      const wEnd = w.add(6, 'day');
      const inRange = (s: string | null, e: string | null) => !!s && !!e && !dayjs(s).isAfter(wEnd) && !dayjs(e).isBefore(w);
      const plan = inRange(a.plan_start, a.plan_finish);
      const actual = inRange(a.actual_start, a.actual_finish ?? (a.actual_start ? dayjs().format('YYYY-MM-DD') : null));
      const forecast = a.forecast_finish && a.plan_finish && dayjs(a.forecast_finish).isAfter(a.plan_finish) && inRange(dayjs(a.plan_finish).add(1, 'day').format('YYYY-MM-DD'), a.forecast_finish);
      if (actual) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(color) } };
      else if (forecast) cell.fill = { type: 'pattern', pattern: 'lightUp', fgColor: { argb: 'FFE53935' } };
      else if (plan) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC5D5F0' } };
      if (a.is_milestone && a.plan_finish && !dayjs(a.plan_finish).isBefore(w) && !dayjs(a.plan_finish).isAfter(wEnd)) {
        cell.value = '◆';
        cell.alignment = { horizontal: 'center' };
      }
      cell.border = {
        left: i === todayIdx ? { style: 'medium', color: { argb: 'FFE53935' } } : { style: 'hair', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } },
      };
    });
    r.height = 30;
  });
  const legendRow = 6 + acts.length;
  ws.getCell(legendRow, 2).value = 'Legend: light blue = Plan, solid = Actual (status color), hatched red = Forecast / Recovery, ◆ = Milestone, red line = this week';
  ws.getCell(legendRow, 2).font = { italic: true, size: 9, color: { argb: 'FF777777' } };
}

function taskSheet(wb: Wb, acts: Activity[], tasks: InternalTask[], name: (id: string | null) => string) {
  const ws = wb.addWorksheet('Task List', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Task No', key: 'no', width: 9 }, { header: 'Activity', key: 'act', width: 22 }, { header: 'Task', key: 'name', width: 34 },
    { header: 'Type', key: 'type', width: 9 }, { header: 'Owner', key: 'owner', width: 18 }, { header: 'Reviewer', key: 'rev', width: 18 },
    { header: 'Planned Start', key: 'ps', width: 12 }, { header: 'Due Date', key: 'due', width: 12 }, { header: 'Actual Finish', key: 'af', width: 12 },
    { header: 'Progress', key: 'prog', width: 9 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Overdue', key: 'od', width: 9 },
    { header: 'Delay Reason', key: 'dr', width: 28 }, { header: 'Recovery Action', key: 'ra', width: 28 },
  ];
  styleHeader(ws, 1);
  const actName = new Map(acts.map((a) => [a.id, a.name]));
  const order = [...tasks].sort((a, b) => (actName.get(a.activity_id) ?? '').localeCompare(actName.get(b.activity_id) ?? '') || (a.task_no ?? '').localeCompare(b.task_no ?? ''));
  order.forEach((t) => {
    const od = dayjs(t.due_date).isBefore(dayjs(), 'day') && !['completed', 'cancelled'].includes(t.status);
    const row = ws.addRow({
      no: t.task_no, act: actName.get(t.activity_id), name: (t.parent_task_id ? '   └ ' : '') + t.name, type: optLabel(TASK_TYPES, t.task_type),
      owner: name(t.owner_id), rev: t.reviewer_id ? name(t.reviewer_id) : '', ps: d(t.planned_start), due: d(t.due_date), af: d(t.actual_finish),
      prog: Number(t.progress) / 100, status: optLabel(TASK_STATUSES, t.status), od: od ? 'YES' : '', dr: t.delay_reason, ra: t.recovery_action,
    });
    ['ps', 'due', 'af'].forEach((k) => (row.getCell(k).numFmt = 'dd-mmm-yy'));
    row.getCell('prog').numFmt = '0%';
    if (od) row.eachCell((c) => (c.font = { color: { argb: 'FFE53935' } }));
  });
  ws.autoFilter = { from: 'A1', to: 'N1' };
}

function bugSheet(wb: Wb, bugs: Bug[], name: (id: string | null) => string) {
  const ws = wb.addWorksheet('Bug List', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Bug No', key: 'no', width: 10 }, { header: 'Title', key: 'title', width: 40 }, { header: 'Severity', key: 'sev', width: 10 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Developer', key: 'dev', width: 18 }, { header: 'Reporter', key: 'rep', width: 18 },
    { header: 'Fix Due', key: 'due', width: 12 }, { header: 'Reopened', key: 'reopen', width: 9 }, { header: 'Root Cause', key: 'rc', width: 30 },
    { header: 'Closed', key: 'closed', width: 12 },
  ];
  styleHeader(ws, 1);
  bugs.forEach((b) => {
    const row = ws.addRow({
      no: b.bug_no, title: b.title, sev: optLabel(SEVERITIES, b.severity), status: optLabel(BUG_STATUSES, b.status),
      dev: b.assigned_dev_id ? name(b.assigned_dev_id) : '', rep: b.reporter_id ? name(b.reporter_id) : '', due: d(b.due_date),
      reopen: b.reopen_count, rc: [b.root_cause_category, b.root_cause].filter(Boolean).join(': '), closed: d(b.closed_at),
    });
    ['due', 'closed'].forEach((k) => (row.getCell(k).numFmt = 'dd-mmm-yy'));
    row.getCell('sev').font = { bold: true, color: { argb: argb(optColor(SEVERITIES, b.severity)) } };
  });
  ws.autoFilter = { from: 'A1', to: 'J1' };
}

export async function exportProjectExcel(opts: {
  project: ProjectView; activities: Activity[]; tasks?: InternalTask[]; bugs?: Bug[]; members: ProjectMember[];
  name: (id: string | null) => string; exportedBy: string; includeInternal: boolean;
}) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TBKK Project Control Workspace';
  wb.created = new Date();
  const acts = [...opts.activities].sort((a, b) => a.seq - b.seq);
  summarySheet(wb, opts.project, opts.members, opts.name, opts.exportedBy);
  planSheet(wb, opts.project, acts, (a) => (a.pic_user_id ? opts.name(a.pic_user_id) : a.pic_label ?? '-'));
  if (opts.includeInternal && opts.tasks) taskSheet(wb, acts, opts.tasks, opts.name);
  if (opts.includeInternal && opts.bugs?.length) bugSheet(wb, opts.bugs, opts.name);
  const buf = await wb.xlsx.writeBuffer();
  download(buf as ArrayBuffer, `${opts.project.project_code}_${opts.includeInternal ? 'Project' : 'UserControlPlan'}_${dayjs().format('YYYYMMDD')}.xlsx`);
}

export async function exportProjectListExcel(projects: ProjectView[], filename: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Project Status', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Project Code', key: 'code', width: 20 }, { header: 'Project Name', key: 'name', width: 38 }, { header: 'Type', key: 'type', width: 18 },
    { header: 'Leader', key: 'leader', width: 20 }, { header: 'Requestor Dept.', key: 'dept', width: 16 }, { header: 'Priority', key: 'prio', width: 9 },
    { header: 'Target Date', key: 'target', width: 12 }, { header: 'Forecast', key: 'fc', width: 12 }, { header: 'Variance (d)', key: 'sv', width: 11 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Health', key: 'health', width: 9 }, { header: 'Progress', key: 'prog', width: 9 },
    { header: 'Next Action', key: 'next', width: 36 }, { header: 'Need Attention', key: 'att', width: 40 },
  ];
  styleHeader(ws, 1);
  projects.forEach((p) => {
    const row = ws.addRow({
      code: p.project_code, name: p.project_name, type: p.project_type_name, leader: p.leader_name, dept: p.requestor_department ?? p.department,
      prio: p.priority, target: d(p.target_date), fc: d(p.forecast_date), sv: p.schedule_variance, status: optLabel(PROJECT_STATUSES, p.status),
      health: p.health.toUpperCase(), prog: Number(p.progress) / 100, next: p.next_action, att: p.attention.join('; '),
    });
    ['target', 'fc'].forEach((k) => (row.getCell(k).numFmt = 'dd-mmm-yy'));
    row.getCell('prog').numFmt = '0%';
    row.getCell('health').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb({ green: '#c8e6c9', yellow: '#fff59d', red: '#ffcdd2' }[p.health]) } };
  });
  ws.autoFilter = { from: 'A1', to: 'N1' };
  const buf = await wb.xlsx.writeBuffer();
  download(buf as ArrayBuffer, filename);
}


// ---------------------------------------------------------------------------
// Phase 3 exports
// ---------------------------------------------------------------------------
function simpleSheet(wb: Wb, name: string, cols: { header: string; key: string; width: number; fmt?: string }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(({ header, key, width }) => ({ header, key, width }));
  styleHeader(ws, 1);
  rows.forEach((r) => {
    const row = ws.addRow(r);
    cols.forEach((c) => { if (c.fmt) row.getCell(c.key).numFmt = c.fmt; });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

export async function exportKpiExcel(opts: { from: string; to: string; team: KpiTeam | null; projects: KpiProject[]; people: KpiIndividual[] }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  if (opts.team) {
    const ws = wb.addWorksheet('Team KPI');
    ws.columns = [{ width: 34 }, { width: 18 }];
    ws.getCell('A1').value = `Team KPI — System Service (${opts.from} → ${opts.to})`;
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0073EA' } };
    const t = opts.team;
    const rows: [string, unknown][] = [
      ['Total projects (period)', t.total_projects], ['Completed projects', t.completed_projects], ['On-time completion rate %', t.on_time_rate],
      ['Delayed projects (now)', t.delayed_projects], ['At-risk projects (now)', t.at_risk_projects], ['Avg schedule variance (days)', t.avg_schedule_variance],
      ['Avg waiting days', t.avg_waiting_days], ['Overdue tasks (now)', t.overdue_tasks], ['Evidence completion %', t.evidence_completion_rate],
      ['Tasks completed', t.tasks_completed], ['Task on-time rate %', t.task_on_time_rate], ['Bugs reported', t.bugs_reported],
      ['Bugs closed', t.bugs_closed], ['Avg bug resolution (days)', t.avg_bug_resolution_days], ['Retest pass rate %', t.retest_pass_rate],
    ];
    rows.forEach(([k, v], i) => { ws.getCell(`A${i + 3}`).value = k; ws.getCell(`A${i + 3}`).font = { bold: true }; ws.getCell(`B${i + 3}`).value = (v ?? '–') as never; });
  }
  simpleSheet(wb, 'Project KPI', [
    { header: 'Project Code', key: 'code', width: 20 }, { header: 'Project', key: 'name', width: 36 }, { header: 'Leader', key: 'leader', width: 18 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Health', key: 'health', width: 9 }, { header: 'Progress %', key: 'progress', width: 10 },
    { header: 'Schedule Variance (d)', key: 'sv', width: 12 }, { header: 'Reschedules', key: 'resch', width: 11 }, { header: 'Waiting Days', key: 'wait', width: 11 },
    { header: 'Overdue Tasks', key: 'od', width: 11 }, { header: 'Task On-time %', key: 'tot', width: 12 }, { header: 'Evidence %', key: 'ev', width: 10 },
    { header: 'Open Bugs', key: 'ob', width: 10 }, { header: 'Bug Closure %', key: 'bc', width: 12 }, { header: 'Retest Pass %', key: 'rp', width: 12 },
  ], opts.projects.map((p) => ({
    code: p.project_code, name: p.project_name, leader: p.leader_name, status: optLabel(PROJECT_STATUSES, p.status), health: p.health.toUpperCase(),
    progress: Number(p.progress), sv: p.schedule_variance, resch: p.reschedules, wait: Number(p.waiting_days), od: p.overdue_tasks,
    tot: p.tasks_on_time_rate, ev: p.evidence_completion, ob: p.open_bugs, bc: p.bug_closure_rate, rp: p.retest_pass_rate,
  })));
  if (opts.people.length) {
    simpleSheet(wb, 'Individual KPI', [
      { header: 'Name', key: 'name', width: 22 }, { header: 'Assigned Tasks', key: 'a', width: 12 }, { header: 'Completed', key: 'c', width: 11 },
      { header: 'On-time', key: 'ot', width: 9 }, { header: 'Late (counted)', key: 'l', width: 12 }, { header: 'Late (excused)', key: 'ex', width: 12 },
      { header: 'On-time %', key: 'r', width: 10 }, { header: 'Avg Delay (d)', key: 'd', width: 11 }, { header: 'Overdue', key: 'od', width: 9 },
      { header: 'Open Tasks', key: 'o', width: 10 }, { header: 'Bugs Assigned', key: 'b', width: 12 }, { header: 'Fixes Ready', key: 'f', width: 11 },
      { header: 'Avg Fix (d)', key: 'fd', width: 10 }, { header: 'First-time Pass %', key: 'fp', width: 14 }, { header: 'Evidence %', key: 'e', width: 10 },
      { header: 'Retests Done', key: 'rt', width: 11 }, { header: 'Retest Turnaround (d)', key: 'rtt', width: 16 },
    ], opts.people.map((x) => ({
      name: x.full_name, a: x.assigned_tasks, c: x.completed_tasks, ot: x.on_time_tasks, l: x.late_tasks, ex: x.excused_late, r: x.on_time_rate,
      d: x.avg_delay_days, od: x.overdue_tasks, o: x.open_tasks, b: x.bugs_assigned, f: x.fixes_ready, fd: x.avg_fix_days, fp: x.fix_first_time_pass_rate,
      e: x.evidence_completion, rt: x.retests_done, rtt: x.avg_retest_turnaround_days,
    })));
  }
  const buf = await wb.xlsx.writeBuffer();
  download(buf as ArrayBuffer, `KPI_${opts.from}_${opts.to}.xlsx`);
}

export async function exportInsightsExcel(rows: Insight[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = simpleSheet(wb, 'Smart Insights', [
    { header: 'Severity', key: 's', width: 10 }, { header: 'Project', key: 'p', width: 20 }, { header: 'Insight', key: 't', width: 44 },
    { header: 'Detail', key: 'd', width: 70 }, { header: 'Rule', key: 'r', width: 22 },
  ], rows.map((r) => ({ s: optLabel(INSIGHT_SEVERITIES, r.severity), p: r.project_code ?? 'Team', t: r.title, d: r.detail, r: r.rule_code })));
  ws.eachRow((row, i) => { if (i > 1) row.getCell('s').font = { bold: true, color: { argb: argb(optColor(INSIGHT_SEVERITIES, rows[i - 2].severity)) } }; });
  const buf = await wb.xlsx.writeBuffer();
  download(buf as ArrayBuffer, `Smart_Insights_${dayjs().format('YYYYMMDD')}.xlsx`);
}

export async function exportWorkforceExcel(opts: { from: string; to: string; plans: WorkforcePlan[]; people: { id: string; full_name: string }[]; projectCode: (id: string | null) => string }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const days: string[] = [];
  for (let d = dayjs(opts.from); !d.isAfter(opts.to); d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'));
  const ws = wb.addWorksheet('Workforce Plan', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  ws.getRow(1).values = ['Member', ...days.map((d) => dayjs(d).format('ddd DD MMM'))];
  styleHeader(ws, 1);
  ws.getColumn(1).width = 22;
  days.forEach((_, i) => (ws.getColumn(i + 2).width = 16));
  opts.people.forEach((p) => {
    const row = ws.addRow([p.full_name, ...days.map((d) => opts.plans.filter((x) => x.user_id === p.id && x.work_date === d)
      .map((x) => `${optLabel(WORK_TYPES, x.work_type)}${x.location ? ` @${x.location}` : ''}`).join('\n'))]);
    days.forEach((d, i) => {
      const first = opts.plans.find((x) => x.user_id === p.id && x.work_date === d);
      const cell = row.getCell(i + 2);
      cell.alignment = { wrapText: true, vertical: 'top' };
      if (first) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(optColor(WORK_TYPES, first.work_type)).replace(/^FF/, '40') } };
    });
  });
  simpleSheet(wb, 'Entries', [
    { header: 'Date', key: 'd', width: 12 }, { header: 'Member', key: 'm', width: 22 }, { header: 'Work Type', key: 't', width: 16 },
    { header: 'Start', key: 's', width: 8 }, { header: 'End', key: 'e', width: 8 }, { header: 'Location', key: 'l', width: 24 },
    { header: 'Project', key: 'p', width: 20 }, { header: 'Remark', key: 'r', width: 30 },
  ], opts.plans.map((x) => ({
    d: x.work_date, m: opts.people.find((p) => p.id === x.user_id)?.full_name, t: optLabel(WORK_TYPES, x.work_type), s: x.start_time?.slice(0, 5),
    e: x.end_time?.slice(0, 5), l: x.location, p: opts.projectCode(x.project_id), r: x.remark,
  })));
  const buf = await wb.xlsx.writeBuffer();
  download(buf as ArrayBuffer, `Workforce_${opts.from}_${opts.to}.xlsx`);
}
