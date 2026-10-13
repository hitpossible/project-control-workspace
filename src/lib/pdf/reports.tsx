// PDF reports (PRD §25.2) — generated client-side from Workspace data
import { Document, Font, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import dayjs from 'dayjs';
import { ACTIVITY_STATUSES, HEALTH_COLORS, INSIGHT_SEVERITIES, MEMBER_ROLES, PROJECT_STATUSES, optColor, optLabel } from '../constants';
import type { Activity, ProjectView } from '../types';
import type { ManagementReportData, ProjectReportData, ReportMeta, ReportType } from './data';

let fontsReady = false;
function registerFonts(origin: string) {
  if (fontsReady) return;
  Font.register({ family: 'Sarabun', fonts: [
    { src: `${origin}/fonts/sarabun-latin-400-normal.woff` },
    { src: `${origin}/fonts/sarabun-latin-700-normal.woff`, fontWeight: 700 },
  ] });
  Font.register({ family: 'SarabunThai', fonts: [
    { src: `${origin}/fonts/sarabun-thai-400-normal.woff` },
    { src: `${origin}/fonts/sarabun-thai-700-normal.woff`, fontWeight: 700 },
  ] });
  Font.registerHyphenationCallback((w) => [w]);
  fontsReady = true;
}

const C = { text: '#323338', muted: '#676879', grid: '#e6e9ef', primary: '#0073ea', bg: '#f5f6f8' };
const s = StyleSheet.create({
  page: { fontFamily: ['Sarabun', 'SarabunThai'], fontSize: 9, color: C.text, paddingTop: 28, paddingBottom: 40, paddingHorizontal: 30 },
  band: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: C.primary },
  brand: { fontSize: 9, color: C.primary, fontWeight: 700 },
  h1: { fontSize: 16, fontWeight: 700, marginTop: 2 },
  h2: { fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 5, color: C.primary },
  muted: { color: C.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  cell: { width: '25%', marginBottom: 5, paddingRight: 6 },
  label: { fontSize: 7.5, color: C.muted },
  tiles: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  tile: { flex: 1, borderWidth: 1, borderColor: C.grid, borderRadius: 4, padding: 6 },
  tileVal: { fontSize: 15, fontWeight: 700 },
  table: { borderWidth: 1, borderColor: C.grid, borderRadius: 3 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.grid },
  th: { backgroundColor: C.bg, fontWeight: 700, fontSize: 8, color: C.muted, padding: 4 },
  td: { padding: 4, fontSize: 8.5 },
  chip: { color: '#fff', fontSize: 7.5, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 2, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 16, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: C.muted, borderTopWidth: 1, borderTopColor: C.grid, paddingTop: 4 },
  sign: { flex: 1, borderWidth: 1, borderColor: C.grid, borderRadius: 4, padding: 8, height: 80, justifyContent: 'space-between' },
  lines: { borderBottomWidth: 1, borderBottomColor: C.grid, height: 16 },
});

const fd = (d: string | null | undefined) => (d ? dayjs(d).format('DD MMM YYYY') : '-');
const fs = (d: string | null | undefined) => (d ? dayjs(d).format('DD MMM') : '-');
const textOn = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.75 ? C.text : '#fff';
};

function Chip({ list, value, width }: { list: { value: string; label: string; color?: string }[]; value: string; width?: number }) {
  const c = optColor(list, value);
  return <Text style={[s.chip, { backgroundColor: c, color: textOn(c), width }]}>{optLabel(list, value)}</Text>;
}

function Header({ title, subtitle, meta }: { title: string; subtitle: string; meta: ReportMeta }) {
  return (
    <>
      <View style={s.band} fixed>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>TBKK · SYSTEM SERVICE · PROJECT CONTROL WORKSPACE</Text>
          <Text style={s.h1}>{title}</Text>
          <Text style={s.muted}>{subtitle}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.label}>Generated</Text>
          <Text>{meta.generatedAt}</Text>
          <Text style={s.muted}>{meta.generatedBy}</Text>
        </View>
      </View>
      <View style={s.footer} fixed>
        <Text>Source: Project Control Workspace (master data) — this file is an output, not the master record.</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
      </View>
    </>
  );
}

function Field({ label, children, width = '25%' }: { label: string; children: React.ReactNode; width?: string }) {
  return (
    <View style={[s.cell, { width }]}>
      <Text style={s.label}>{label}</Text>
      <Text>{children || '-'}</Text>
    </View>
  );
}

function Tile({ label, value, color, hint }: { label: string; value: string | number; color?: string; hint?: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.tileVal, color ? { color } : {}]}>{value}</Text>
      {hint ? <Text style={[s.label, { fontSize: 7 }]}>{hint}</Text> : null}
    </View>
  );
}

function ProjectFacts({ p, meta }: { p: ProjectView; meta: ReportMeta }) {
  return (
    <View style={s.grid}>
      <Field label="Project Code">{p.project_code}</Field>
      <Field label="Project Type">{p.project_type_name}</Field>
      <Field label="Project Leader">{p.leader_name}</Field>
      <Field label="Requestor Department">{p.requestor_department ?? p.department}</Field>
      <Field label="Start / Target">{`${fd(p.start_date)} – ${fd(p.target_date)}`}</Field>
      <Field label="Forecast">{fd(p.forecast_date)}</Field>
      <Field label="Baseline">{p.baseline_version ? `V${p.baseline_version} · finish ${fd(p.baseline_finish)}` : 'Not set'}</Field>
      <Field label="Sponsor">{p.sponsor}</Field>
      <Field label="Next Action" width="50%">{p.next_action}</Field>
      <Field label="Remark" width="50%">{p.remark}</Field>
      {meta ? null : null}
    </View>
  );
}

function StatusTiles({ p }: { p: ProjectView }) {
  const sv = p.schedule_variance;
  return (
    <View style={s.tiles}>
      <View style={s.tile}><Text style={s.label}>Status</Text><View style={{ marginTop: 3 }}><Chip list={PROJECT_STATUSES} value={p.status} width={70} /></View></View>
      <Tile label="Health" value={p.health.toUpperCase()} color={HEALTH_COLORS[p.health]} />
      <Tile label="Progress" value={`${Math.round(p.progress)}%`} color="#00a35c" />
      <Tile label="Schedule Variance" value={sv == null ? '-' : `${sv > 0 ? '+' : ''}${sv}d`} color={(sv ?? 0) > 0 ? '#e2445c' : '#00a35c'} />
      <Tile label="Overdue Activities" value={p.overdue_activities} color={p.overdue_activities ? '#e2445c' : undefined} />
    </View>
  );
}

/** User Control Plan with a mini timeline column */
function PlanTable({ acts, name, withBars = true }: { acts: Activity[]; name: (id: string | null) => string; withBars?: boolean }) {
  const dates = acts.flatMap((a) => [a.plan_start, a.plan_finish, a.actual_finish, a.forecast_finish]).filter(Boolean) as string[];
  const min = dates.length ? dayjs(dates.reduce((a, b) => (a < b ? a : b))) : dayjs();
  const max = dates.length ? dayjs(dates.reduce((a, b) => (a > b ? a : b))) : dayjs();
  const span = Math.max(max.diff(min, 'day') + 1, 1);
  const pos = (d: string) => (dayjs(d).diff(min, 'day') / span) * 100;
  const today = pos(dayjs().format('YYYY-MM-DD'));
  return (
    <View style={s.table}>
      <View style={s.tr}>
        <Text style={[s.th, { width: '22%' }]}>Activity</Text>
        <Text style={[s.th, { width: '12%' }]}>PIC</Text>
        <Text style={[s.th, { width: '13%' }]}>Plan</Text>
        <Text style={[s.th, { width: '7%' }]}>Prog.</Text>
        <Text style={[s.th, { width: '12%' }]}>Status</Text>
        {withBars ? <Text style={[s.th, { width: '16%' }]}>{`Timeline ${fs(min.format())}–${fs(max.format())}`}</Text> : null}
        <Text style={[s.th, { width: withBars ? '18%' : '34%' }]}>Next Action / Recovery</Text>
      </View>
      {acts.map((a) => {
        const late = a.plan_finish && dayjs(a.plan_finish).isBefore(dayjs(), 'day') && !['completed', 'cancelled'].includes(a.status);
        return (
          <View key={a.id} style={[s.tr, late ? { backgroundColor: '#fff1f0' } : {}]} wrap={false}>
            <Text style={[s.td, { width: '22%', fontWeight: 700 }]}>{`${a.is_milestone ? '(M) ' : ''}${a.name}`}</Text>
            <Text style={[s.td, { width: '12%' }]}>{a.pic_user_id ? name(a.pic_user_id) : a.pic_label ?? '-'}</Text>
            <Text style={[s.td, { width: '13%' }, late ? { color: '#e2445c' } : {}]}>{`${fs(a.plan_start)} – ${fs(a.plan_finish)}`}</Text>
            <Text style={[s.td, { width: '7%' }]}>{`${Math.round(a.progress)}%`}</Text>
            <View style={[s.td, { width: '12%' }]}><Chip list={ACTIVITY_STATUSES} value={a.status} /></View>
            {withBars ? (
              <View style={[s.td, { width: '16%', justifyContent: 'center' }]}>
                <View style={{ height: 10, position: 'relative', backgroundColor: '#f5f6f8' }}>
                  {a.plan_start && a.plan_finish ? <View style={{ position: 'absolute', top: 1, height: 4, left: `${pos(a.plan_start)}%`, width: `${Math.max(pos(a.plan_finish) - pos(a.plan_start), 1.5)}%`, backgroundColor: '#c3c6d4' }} /> : null}
                  {a.actual_start ? <View style={{ position: 'absolute', top: 5, height: 4, left: `${pos(a.actual_start)}%`, width: `${Math.max(pos(a.actual_finish ?? dayjs().format('YYYY-MM-DD')) - pos(a.actual_start), 1.5) * (a.progress / 100 || 0.05)}%`, backgroundColor: optColor(ACTIVITY_STATUSES, a.status) }} /> : null}
                  {today >= 0 && today <= 100 ? <View style={{ position: 'absolute', top: 0, bottom: 0, width: 1, left: `${today}%`, backgroundColor: C.primary }} /> : null}
                </View>
              </View>
            ) : null}
            <Text style={[s.td, { width: withBars ? '18%' : '34%' }]}>{[a.next_action, a.recovery_plan && `Recovery: ${a.recovery_plan}`].filter(Boolean).join('\n') || '-'}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Insights({ items }: { items: ProjectReportData['insights'] }) {
  if (!items.length) return <Text style={s.muted}>No open issues — project is on track.</Text>;
  return (
    <View>
      {items.map((i, n) => (
        <View key={n} style={{ flexDirection: 'row', marginBottom: 3 }} wrap={false}>
          <Text style={{ width: 52, fontSize: 7.5, fontWeight: 700, color: optColor(INSIGHT_SEVERITIES, i.severity) }}>{i.severity.toUpperCase()}</Text>
          <Text style={{ flex: 1 }}><Text style={{ fontWeight: 700 }}>{`${i.project_code ? `${i.project_code} · ` : ''}${i.title}`}</Text>{` — ${i.detail}`}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Report documents
// ---------------------------------------------------------------------------
function StatusReport({ d, meta }: { d: ProjectReportData; meta: ReportMeta }) {
  const p = d.project;
  const delayed = d.activities.filter((a) => a.delay_reason || a.recovery_plan);
  return (
    <Document title={`${p.project_code} Project Status`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header title={`Project Status Report — ${p.project_code}`} subtitle={p.project_name} meta={meta} />
        <StatusTiles p={p} />
        <ProjectFacts p={p} meta={meta} />
        <Text style={s.h2} minPresenceAhead={70}>User Control Plan</Text>
        <PlanTable acts={d.activities} name={meta.name} />
        {delayed.length ? (
          <>
            <Text style={s.h2} minPresenceAhead={70}>Delay & Recovery Plan</Text>
            <View style={s.table}>
              <View style={s.tr}>
                {['Activity', 'Category', 'Reason', 'Impact', 'Recovery Plan', 'Owner / Due'].map((h, i) => <Text key={h} style={[s.th, { width: ['16%', '11%', '20%', '16%', '23%', '14%'][i] }]}>{h}</Text>)}
              </View>
              {delayed.map((a) => (
                <View key={a.id} style={s.tr} wrap={false}>
                  <Text style={[s.td, { width: '16%', fontWeight: 700 }]}>{a.name}</Text>
                  <Text style={[s.td, { width: '11%' }]}>{a.delay_category ?? '-'}</Text>
                  <Text style={[s.td, { width: '20%' }]}>{a.delay_reason ?? '-'}</Text>
                  <Text style={[s.td, { width: '16%' }]}>{a.delay_impact ?? '-'}</Text>
                  <Text style={[s.td, { width: '23%' }]}>{a.recovery_plan ?? '-'}</Text>
                  <Text style={[s.td, { width: '14%' }]}>{`${a.recovery_owner_id ? meta.name(a.recovery_owner_id) : '-'}\n${fd(a.recovery_due_date)}${a.forecast_finish ? `\nFC ${fd(a.forecast_finish)}` : ''}`}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
        <Text style={s.h2} minPresenceAhead={70}>Issues & Insights</Text>
        <Insights items={d.insights} />
        {d.kpi ? (
          <>
            <Text style={s.h2} minPresenceAhead={70}>Project KPI</Text>
            <View style={s.tiles}>
              <Tile label="Evidence completion" value={d.kpi.evidence_completion == null ? '-' : `${d.kpi.evidence_completion}%`} hint={`${d.kpi.evidence_done}/${d.kpi.evidence_total} mandatory`} />
              <Tile label="Reschedules" value={d.kpi.reschedules} />
              <Tile label="Waiting days" value={d.kpi.waiting_days} />
              <Tile label="Open bugs" value={d.kpi.open_bugs} color={d.kpi.open_bugs ? '#e2445c' : undefined} />
              <Tile label="Bug closure" value={d.kpi.bug_closure_rate == null ? '-' : `${d.kpi.bug_closure_rate}%`} />
              <Tile label="Retest pass rate" value={d.kpi.retest_pass_rate == null ? '-' : `${d.kpi.retest_pass_rate}%`} />
            </View>
          </>
        ) : null}
      </Page>
    </Document>
  );
}

function MeetingReport({ d, meta }: { d: ProjectReportData; meta: ReportMeta }) {
  const p = d.project;
  const userItems = d.activities.filter((a) => (a.pic_label ?? '').toLowerCase().includes('user') || a.status === 'waiting');
  const upcoming = d.activities.filter((a) => a.plan_finish && !['completed', 'cancelled'].includes(a.status) && dayjs(a.plan_finish).diff(dayjs(), 'day') <= 30);
  return (
    <Document title={`${p.project_code} User Meeting`}>
      <Page size="A4" style={s.page}>
        <Header title={`User Progress Meeting — ${p.project_code}`} subtitle={p.project_name} meta={meta} />
        <View style={s.grid}>
          <Field label="Meeting date">{dayjs().format('DD MMM YYYY')}</Field>
          <Field label="Project Leader">{p.leader_name}</Field>
          <Field label="Target / Forecast">{`${fd(p.target_date)} / ${fd(p.forecast_date)}`}</Field>
          <Field label="Overall">{`${optLabel(PROJECT_STATUSES, p.status)} · ${Math.round(p.progress)}%`}</Field>
        </View>
        <Text style={s.h2} minPresenceAhead={70}>1. Progress overview</Text>
        <PlanTable acts={d.activities} name={meta.name} withBars={false} />
        <Text style={s.h2} minPresenceAhead={70}>2. Items requiring User action</Text>
        {userItems.length ? userItems.map((a) => (
          <Text key={a.id} style={{ marginBottom: 2 }}>{`• ${a.name} (${fs(a.plan_start)} – ${fs(a.plan_finish)}) — ${a.next_action ?? a.status_note ?? optLabel(ACTIVITY_STATUSES, a.status)}`}</Text>
        )) : <Text style={s.muted}>None</Text>}
        <Text style={s.h2} minPresenceAhead={70}>3. Upcoming milestones / due within 30 days</Text>
        {upcoming.length ? upcoming.map((a) => <Text key={a.id} style={{ marginBottom: 2 }}>{`• ${a.is_milestone ? '(M) ' : ''}${a.name} — ${fd(a.plan_finish)} (${a.pic_user_id ? meta.name(a.pic_user_id) : a.pic_label ?? '-'})`}</Text>) : <Text style={s.muted}>None</Text>}
        <Text style={s.h2} minPresenceAhead={70}>4. Issues</Text>
        <Insights items={d.insights.filter((i) => i.severity !== 'info')} />
        <Text style={s.h2} minPresenceAhead={70}>5. Decisions / Action items</Text>
        {[0, 1, 2, 3, 4].map((i) => <View key={i} style={s.lines} />)}
        <Text style={s.h2} minPresenceAhead={70}>Attendees</Text>
        {d.members.map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
            <View style={{ width: 8, height: 8, borderWidth: 1, borderColor: C.muted, marginRight: 5 }} />
            <Text>{`${meta.name(m.user_id)} — ${optLabel(MEMBER_ROLES, m.member_role)}`}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}

function ClosureReport({ d, meta }: { d: ProjectReportData; meta: ReportMeta }) {
  const p = d.project;
  const v1 = d.baselines[0];
  const last = d.baselines[d.baselines.length - 1];
  const v1Items = d.baselineItems.filter((i) => i.baseline_id === v1?.id);
  const live = d.activities.filter((a) => a.status !== 'cancelled');
  const allDone = live.length > 0 && live.every((a) => a.actual_finish);
  const finish = allDone ? live.map((a) => a.actual_finish!).sort().pop()! : null;
  const ok = (r: { id: string }) => d.evidence.some((e) => e.requirement_id === r.id && e.verification_status !== 'rejected');
  return (
    <Document title={`${p.project_code} Project Closure`}>
      <Page size="A4" style={s.page}>
        <Header title={`Project Closure Report — ${p.project_code}`} subtitle={p.project_name} meta={meta} />
        <View style={s.tiles}>
          <Tile label="Status" value={optLabel(PROJECT_STATUSES, p.status)} color={optColor(PROJECT_STATUSES, p.status)} />
          <Tile label="Actual finish" value={finish ? fd(finish) : 'In progress'} />
          <Tile label="Baseline V1 finish" value={fd(v1?.planned_finish)} />
          <Tile label="Final variance vs V1" value={finish && v1?.planned_finish ? `${dayjs(finish).diff(v1.planned_finish, 'day')}d` : '-'} />
          <Tile label="Baseline versions" value={last ? `V${last.version_no}` : '-'} />
        </View>
        <ProjectFacts p={p} meta={meta} />
        <Text style={s.h2} minPresenceAhead={70}>Baseline V1 vs Actual</Text>
        <View style={s.table}>
          <View style={s.tr}>
            {['Activity', 'Baseline V1 Start', 'Baseline V1 Finish', 'Actual Start', 'Actual Finish', 'Variance'].map((h, i) => <Text key={h} style={[s.th, { width: ['30%', '14%', '14%', '14%', '14%', '14%'][i] }]}>{h}</Text>)}
          </View>
          {d.activities.map((a) => {
            const b = v1Items.find((i) => i.activity_id === a.id);
            const v = a.actual_finish && b?.planned_finish ? dayjs(a.actual_finish).diff(b.planned_finish, 'day') : null;
            return (
              <View key={a.id} style={s.tr} wrap={false}>
                <Text style={[s.td, { width: '30%', fontWeight: 700 }]}>{a.name}</Text>
                <Text style={[s.td, { width: '14%' }]}>{fd(b?.planned_start)}</Text>
                <Text style={[s.td, { width: '14%' }]}>{fd(b?.planned_finish)}</Text>
                <Text style={[s.td, { width: '14%' }]}>{fd(a.actual_start)}</Text>
                <Text style={[s.td, { width: '14%' }]}>{a.status === 'cancelled' ? 'Cancelled' : fd(a.actual_finish)}</Text>
                <Text style={[s.td, { width: '14%', color: (v ?? 0) > 0 ? '#e2445c' : C.text }]}>{v == null ? '-' : `${v > 0 ? '+' : ''}${v}d`}</Text>
              </View>
            );
          })}
        </View>
        <Text style={s.h2} minPresenceAhead={70}>Evidence Checklist</Text>
        <View style={s.grid}>
          {d.requirements.map((r) => (
            <View key={r.id} style={{ width: '50%', marginBottom: 3, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderWidth: 1, borderColor: ok(r) ? '#00a35c' : '#e2445c', backgroundColor: ok(r) ? '#00a35c' : '#fff', marginRight: 4 }} />
              <Text>{`${r.name}${r.is_mandatory ? '' : ' (optional)'}${ok(r) ? '' : ' — missing'}`}</Text>
            </View>
          ))}
          {d.requirements.length === 0 ? <Text style={s.muted}>No checklist</Text> : null}
        </View>
        <Text style={s.h2} minPresenceAhead={70}>Quality summary</Text>
        <View style={s.tiles}>
          <Tile label="Bugs (closed / total)" value={d.bugTotals ? `${d.bugTotals.closed} / ${d.bugTotals.total}` : `${d.kpi?.bugs_closed ?? 0} / ${d.kpi?.bugs_total ?? 0}`} />
          <Tile label="Open bugs" value={d.qa?.open_bugs ?? d.kpi?.open_bugs ?? 0} color={(d.qa?.open_bugs ?? 0) > 0 ? '#e2445c' : undefined} />
          <Tile label="Retest pass rate" value={d.kpi?.retest_pass_rate == null ? '-' : `${d.kpi.retest_pass_rate}%`} />
          <Tile label="Evidence completion" value={d.kpi?.evidence_completion == null ? '-' : `${d.kpi.evidence_completion}%`} />
        </View>
        <Text style={s.h2} minPresenceAhead={70}>Lessons learned</Text>
        {[0, 1, 2].map((i) => <View key={i} style={s.lines} />)}
        <Text style={s.h2} minPresenceAhead={70}>Acceptance & Sign-off</Text>
        <View style={{ flexDirection: 'row', gap: 8 }} wrap={false}>
          {[['Project Leader', p.leader_name], ['Requestor / User', ''], ['System Service Manager', ''], ['Authority Approver', '']].map(([role, nm]) => (
            <View key={role} style={s.sign}>
              <Text style={s.label}>{role}</Text>
              <View>
                <View style={{ borderBottomWidth: 1, borderBottomColor: C.text, marginBottom: 2 }} />
                <Text style={{ fontSize: 7.5 }}>{`(${nm || '                              '})`}</Text>
                <Text style={{ fontSize: 7, color: C.muted }}>Date ____/____/______</Text>
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

function ManagementReport({ d, meta }: { d: ManagementReportData; meta: ReportMeta }) {
  const active = d.projects.filter((p) => !['completed', 'cancelled'].includes(p.status));
  const count = (st: string) => d.projects.filter((p) => p.status === st).length;
  const t = d.team;
  return (
    <Document title="Management Report">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header title="Management Report — System Service Projects" subtitle={`Period ${fd(d.from)} – ${fd(d.to)}`} meta={meta} />
        <View style={s.tiles}>
          <Tile label="Total projects" value={d.projects.length} />
          <Tile label="Working on it" value={count('in_progress')} color="#fdab3d" />
          <Tile label="Planning / Waiting" value={count('planning') + count('waiting') + count('on_hold')} color="#a25ddc" />
          <Tile label="Delayed / At risk" value={count('delayed') + count('at_risk')} color="#e2445c" />
          <Tile label="Done" value={count('completed')} color="#00a35c" />
          <Tile label="Health RED" value={active.filter((p) => p.health === 'red').length} color="#e2445c" />
        </View>
        {t ? (
          <View style={s.tiles}>
            <Tile label="On-time completion" value={t.on_time_rate == null ? '-' : `${t.on_time_rate}%`} />
            <Tile label="Avg schedule variance" value={t.avg_schedule_variance == null ? '-' : `${t.avg_schedule_variance}d`} />
            <Tile label="Avg waiting days" value={t.avg_waiting_days ?? '-'} />
            <Tile label="Evidence completion" value={t.evidence_completion_rate == null ? '-' : `${t.evidence_completion_rate}%`} />
            <Tile label="Bugs reported / closed" value={`${t.bugs_reported} / ${t.bugs_closed}`} />
            <Tile label="Retest pass rate" value={t.retest_pass_rate == null ? '-' : `${t.retest_pass_rate}%`} />
          </View>
        ) : null}
        <Text style={s.h2} minPresenceAhead={70}>Project Portfolio</Text>
        <View style={s.table}>
          <View style={s.tr}>
            {['Project', 'Leader', 'Dept.', 'Target', 'Forecast', 'Var.', 'Progress', 'Status', 'Health', 'Next Action'].map((h, i) =>
              <Text key={h} style={[s.th, { width: ['22%', '10%', '8%', '7%', '7%', '5%', '6%', '9%', '5%', '21%'][i] }]}>{h}</Text>)}
          </View>
          {d.projects.map((p) => (
            <View key={p.id} style={s.tr} wrap={false}>
              <Text style={[s.td, { width: '22%' }]}><Text style={{ fontWeight: 700 }}>{p.project_code}</Text>{`\n${p.project_name}`}</Text>
              <Text style={[s.td, { width: '10%' }]}>{p.leader_name ?? '-'}</Text>
              <Text style={[s.td, { width: '8%' }]}>{p.requestor_department ?? p.department ?? '-'}</Text>
              <Text style={[s.td, { width: '7%' }]}>{fs(p.target_date)}</Text>
              <Text style={[s.td, { width: '7%' }, p.forecast_date && p.target_date && p.forecast_date > p.target_date ? { color: '#e2445c' } : {}]}>{fs(p.forecast_date)}</Text>
              <Text style={[s.td, { width: '5%' }]}>{p.schedule_variance == null ? '-' : `${p.schedule_variance > 0 ? '+' : ''}${p.schedule_variance}`}</Text>
              <Text style={[s.td, { width: '6%' }]}>{`${Math.round(p.progress)}%`}</Text>
              <View style={[s.td, { width: '9%' }]}><Chip list={PROJECT_STATUSES} value={p.status} /></View>
              <View style={[s.td, { width: '5%', alignItems: 'center' }]}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: HEALTH_COLORS[p.health] }} /></View>
              <Text style={[s.td, { width: '21%' }]}>{p.next_action ?? '-'}</Text>
            </View>
          ))}
        </View>
        <Text style={s.h2} minPresenceAhead={70}>Projects Need Attention</Text>
        <Insights items={d.insights} />
      </Page>
    </Document>
  );
}

export const REPORT_LABELS: Record<ReportType, string> = {
  status: 'Project Status Report',
  meeting: 'User Meeting Report',
  closure: 'Project Closure Report',
  management: 'Management Report',
};

export async function renderReport(type: ReportType, data: ProjectReportData | ManagementReportData, meta: ReportMeta, origin: string): Promise<Blob> {
  registerFonts(origin);
  const doc = type === 'management' ? <ManagementReport d={data as ManagementReportData} meta={meta} />
    : type === 'meeting' ? <MeetingReport d={data as ProjectReportData} meta={meta} />
    : type === 'closure' ? <ClosureReport d={data as ProjectReportData} meta={meta} />
    : <StatusReport d={data as ProjectReportData} meta={meta} />;
  return pdf(doc).toBlob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
