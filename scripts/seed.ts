// Seed demo users + run the real workflow (Request → Approval → Project → Plan) through the same
// workflow functions and access policies the API uses, acting as each user.
// Usage: npm run db:reset   (migrate --reset && tsx scripts/seed.ts)
import { config } from 'dotenv';
import { hashPassword, loadProfile } from '../src/server/users';
import { pool, uuid } from '../src/server/db';
import { localDb } from '../src/server/local-db';

config({ path: '.env.local', quiet: true });

/* eslint-disable @typescript-eslint/no-explicit-any -- demo data script */
export const SEED_PASSWORD = 'Tbkk@1234';

type Db = ReturnType<typeof localDb>;
const admin = localDb(null); // system (was the service-role client)

const USERS = [
  { key: 'admin',     email: 'admin@tbkk.test',      full_name: 'System Admin',        employee_id: 'A0001', department: 'System Service', section: 'System', roles: ['admin', 'requestor'] },
  { key: 'requestor', email: 'requestor@tbkk.test',  full_name: 'Somchai Jaidee',      employee_id: 'P1001', department: 'Production',     section: 'Assembly Line 2', roles: ['requestor'] },
  { key: 'reqmgr',    email: 'req.manager@tbkk.test',full_name: 'Suda Manee',          employee_id: 'P1002', department: 'Production',     section: 'Production Mgmt', roles: ['requestor', 'requestor_approver'] },
  { key: 'reviewer',  email: 'reviewer@tbkk.test',   full_name: 'Anan Reviewer',       employee_id: 'S2001', department: 'System Service', section: 'System', roles: ['system_reviewer', 'supervisor', 'requestor'] },
  { key: 'authority', email: 'authority@tbkk.test',  full_name: 'Kittipong Director',  employee_id: 'M3001', department: 'Management',     section: 'Director Office', roles: ['authority_approver', 'manager'] },
  { key: 'leader',    email: 'leader@tbkk.test',     full_name: 'Nattapong Leader',    employee_id: 'S2002', department: 'System Service', section: 'Application', roles: ['project_leader', 'developer', 'requestor'] },
  { key: 'dev1',      email: 'dev1@tbkk.test',       full_name: 'Pim Developer',       employee_id: 'S2003', department: 'System Service', section: 'Application', roles: ['developer'] },
  { key: 'dev2',      email: 'dev2@tbkk.test',       full_name: 'Tee Developer',       employee_id: 'S2004', department: 'System Service', section: 'Application', roles: ['developer'] },
  { key: 'qa',        email: 'qa@tbkk.test',         full_name: 'Mint QA',             employee_id: 'S2005', department: 'System Service', section: 'QA', roles: ['qa'] },
  { key: 'supervisor',email: 'supervisor@tbkk.test', full_name: 'Wichai Supervisor',   employee_id: 'S2006', department: 'System Service', section: 'System', roles: ['supervisor'] },
  { key: 'mgmt',      email: 'mgmt@tbkk.test',       full_name: 'Management Viewer',   employee_id: 'M3002', department: 'Management',     section: 'Planning', roles: ['management_view'] },
];

const ids: Record<string, string> = {};
const clients: Record<string, Db> = {};

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localIso(d);
};

function must({ data, error }: { data: any; error: { message: string } | null }, label: string): any {
  if (error) {
    console.error(`✗ ${label}:`, error.message);
    process.exit(1);
  }
  return data;
}

async function createUsers() {
  const hash = await hashPassword(SEED_PASSWORD);
  for (const u of USERS) {
    const id = uuid();
    must(await admin.from('profiles').insert({
      id, username: u.email.split('@')[0], email: u.email, full_name: u.full_name, employee_id: u.employee_id, department: u.department,
      section: u.section, roles: u.roles, telephone: '02-123-4567', extension: String(1000 + USERS.indexOf(u)),
    }), `create ${u.email}`);
    // local password for the demo accounts (real users sign in through AD)
    await pool().query('UPDATE profiles SET password_hash = ? WHERE id = ?', [hash, id]);
    ids[u.key] = id;
    clients[u.key] = localDb(await loadProfile(id));
  }
  console.log(`✓ ${USERS.length} users`);
}

async function newRequest(fields: Record<string, unknown>) {
  const u = USERS.find((x) => x.key === 'requestor')!;
  const req = must(
    await clients.requestor.from('project_requests').insert({
      req_employee_id: u.employee_id, req_full_name: u.full_name, req_department: u.department, req_section: u.section,
      req_email: u.email, req_telephone: '02-123-4567', req_extension: '1001',
      requestor_approver_id: ids.reqmgr, ...fields,
    }).select().single(),
    'insert request',
  );
  return req;
}

const submit = async (r: any) => must(await clients.requestor.rpc('submit_request', { p_request_id: r.id }), 'submit');

async function waitingStep(requestId: string) {
  return must(
    await admin.from('approval_steps').select('*').eq('request_id', requestId).eq('status', 'waiting').single(),
    'waiting step',
  );
}

async function approve(who: string, requestId: string, comment?: string) {
  const s = await waitingStep(requestId);
  return must(await clients[who].rpc('act_on_approval', { p_step_id: s.id, p_action: 'approve', p_comment: comment ?? null }), `approve by ${who}`);
}

async function review(requestId: string, typeCode: string, tplCode: string) {
  const type = must(await admin.from('project_types').select('id').eq('code', typeCode).single(), 'type');
  const tpl = must(await admin.from('project_templates').select('id').eq('code', tplCode).single(), 'tpl');
  must(await clients.reviewer.rpc('save_review', {
    p_request_id: requestId, p_project_type_id: type.id, p_template_id: tpl.id,
    p_proposed_leader_id: ids.leader, p_authority_approver_id: ids.authority,
    p_scope_assessment: 'Scope reviewed. Feasible with current System Service resources.',
  }), 'save_review');
}

async function fullyApprove(r: any, typeCode: string, tplCode: string) {
  await approve('reqmgr', r.id, 'Agree, please proceed.');
  await review(r.id, typeCode, tplCode);
  await approve('reviewer', r.id, 'Reviewed by System Service.');
  await approve('authority', r.id, 'Approved.');
}

async function convert(r: any, start: string, target: string, sponsor: string) {
  return must(await clients.reviewer.rpc('convert_request_to_project', {
    p_request_id: r.id, p_start_date: start, p_target_date: target, p_sponsor: sponsor,
  }), 'convert');
}

async function addMembers(projectId: string, list: [string, string][]) {
  must(await clients.leader.from('project_members').insert(list.map(([k, role]) => ({ project_id: projectId, user_id: ids[k], member_role: role }))), 'members');
}

async function main() {
  await createUsers();
  const L = clients.leader;

  // ---------------- Project A: in progress, Development delayed ----------------
  const rA = await newRequest({
    project_name: 'Production Downtime Tracking System',
    description: 'Web system to record machine downtime per line and shift, replacing the paper log sheet.',
    reason: 'Downtime data is recorded on paper and summarised manually in Excel every week.',
    expectation: 'Real-time downtime dashboard per line, reason code analysis and monthly report.',
    priority: 'high', date_required: day(30),
    benefit: 'Reduce 6 man-hours/week of manual summary; faster response to machine stops.',
  });
  await submit(rA);
  await fullyApprove(rA, 'WEB', 'WEB_DEV');
  const pA = await convert(rA, day(-30), day(30), 'Production Director');
  await addMembers(pA.id, [['dev1', 'developer'], ['dev2', 'developer'], ['qa', 'qa'], ['supervisor', 'supervisor'], ['authority', 'manager']]);

  const actsA = must(await L.from('activities').select('*').eq('project_id', pA.id).order('seq'), 'acts');
  must(await L.rpc('create_baseline', { p_project_id: pA.id, p_reason: null }), 'baseline A');
  const tasksA = must(await L.from('internal_tasks').select('*').eq('project_id', pA.id).order('seq'), 'tasks');
  const byName = (n: string) => tasksA.find((t: any) => t.name === n);
  const act = (n: string) => actsA.find((a: any) => a.name === n);

  // Evidence checklist (from template) — satisfy Requirement & Design before completing them
  const reqs = must(await L.from('evidence_requirements').select('*').eq('project_id', pA.id), 'reqs');
  const reqFor = (actName: string) => reqs.filter((r: any) => r.entity_type === 'activity' && r.entity_id === act(actName).id);
  for (const r of [...reqFor('Requirement'), ...reqFor('Design')]) {
    must(await L.from('evidence').insert({
      project_id: pA.id, entity_type: 'activity', entity_id: r.entity_id, requirement_id: r.id, evidence_type: 'sharepoint',
      url: `https://tbkk.sharepoint.com/sites/system/Downtime/${encodeURIComponent(r.name)}.pdf`, file_name: `${r.name} (signed)`,
      description: r.name, is_internal: false, verification_status: 'verified', uploaded_by: ids.leader,
    }), `evidence ${r.name}`);
  }
  for (const n of ['Requirement workshop', 'Requirement document', 'Design Database', 'UI / Flow design']) {
    const t = byName(n);
    must(await L.from('internal_tasks').update({ status: 'completed', actual_start: t.planned_start, actual_finish: t.due_date }).eq('id', t.id), `complete ${n}`);
  }
  must(await L.from('internal_tasks').update({ owner_id: ids.dev1, reviewer_id: ids.leader, progress: 70, status: 'in_progress', actual_start: byName('Develop Backend API').planned_start,
    technical_note: 'Shift aggregation in a MySQL view. Index on (line_id, started_at).',
    internal_comment: 'Shift calendar API from HR not ready, using static table for now.' }).eq('id', byName('Develop Backend API').id), 'be');
  must(await L.from('internal_tasks').update({ owner_id: ids.dev2, reviewer_id: ids.leader, progress: 40, status: 'in_progress', actual_start: day(-14),
    delay_category: 'Resource Constraint', delay_reason: 'Dev2 supported urgent ERP issue for 3 days.',
    recovery_action: 'Dev1 helps on dashboard components after API done.' }).eq('id', byName('Develop Frontend').id), 'fe');
  must(await L.from('internal_tasks').update({ owner_id: ids.dev1 }).eq('id', byName('Unit Test').id), 'ut');
  must(await L.from('internal_tasks').update({ owner_id: ids.leader }).eq('id', byName('Code Review').id), 'cr');
  must(await L.from('internal_tasks').update({ owner_id: ids.qa }).eq('id', byName('Test Round 1').id), 'qa1');
  must(await L.from('internal_tasks').update({ owner_id: ids.qa }).eq('id', byName('FM-SYS-007 Test Result').id), 'qa2');
  // sub-tasks under Backend API
  const be = byName('Develop Backend API');
  must(await L.from('internal_tasks').insert([
    { project_id: pA.id, activity_id: be.activity_id, parent_task_id: be.id, seq: 1, name: 'Downtime CRUD API', task_type: 'dev', owner_id: ids.dev1, planned_start: be.planned_start, due_date: be.due_date, status: 'completed', progress: 100, actual_start: be.planned_start, actual_finish: day(-12) },
    { project_id: pA.id, activity_id: be.activity_id, parent_task_id: be.id, seq: 2, name: 'Shift summary API', task_type: 'dev', owner_id: ids.dev1, planned_start: be.planned_start, due_date: be.due_date, status: 'in_progress', progress: 40, actual_start: day(-12), actual_finish: null },
  ]), 'subtasks');
  // dependency FE depends on BE
  must(await L.from('task_dependencies').insert({ project_id: pA.id, predecessor_id: be.id, successor_id: byName('Develop Frontend').id }), 'dep');

  must(await L.from('activities').update({ pic_user_id: ids.dev1, status_note: 'Backend API 70%, Frontend 40%',
    next_action: 'Complete shift summary API', delay_category: 'Resource Constraint',
    delay_reason: 'Developer pulled to urgent ERP support for 3 days', recovery_plan: 'Add Dev1 to frontend after API; OT 2 days',
    forecast_finish: day(4), delay_impact: 'System Test starts ~1 week late; Go-live date still achievable', recovery_owner_id: ids.leader,
    recovery_due_date: day(4) }).eq('id', act('Development').id), 'dev act');
  must(await L.from('activities').update({ next_action: 'Prepare UAT scenario with Production', remark: 'User to nominate 2 key users' }).eq('id', act('UAT').id), 'uat');
  must(await L.from('projects').update({ next_action: 'Finish Development and start QA round 1', remark: 'Development slightly behind plan; recovery in place.' }).eq('id', pA.id), 'pA');
  must(await L.from('evidence').insert([
    { project_id: pA.id, entity_type: 'task', entity_id: be.id, evidence_type: 'git', url: 'https://git.tbkk.local/sys/downtime/pull/12', file_name: 'PR #12 Downtime API', description: 'Backend API pull request', is_internal: true, verification_status: 'pending' },
  ]), 'evidence');

  // ---------------- Phase 2: QA cycle on Project A ----------------
  const QA = clients.qa;
  const round1 = must(await QA.from('test_rounds').insert({
    project_id: pA.id, activity_id: act('System Test (QA)').id, title: 'System Test Round 1 — Downtime entry & shift summary',
    test_type: 'system', tester_id: ids.qa, planned_date: day(-6), due_date: day(-2), actual_date: day(-5), status: 'completed',
    result: 'failed', total_cases: 42, passed_cases: 36, failed_cases: 6, summary: '6 failed cases; 4 bugs raised. Regression round planned after fixes.',
  }).select().single(), 'round1');
  must(await QA.from('test_rounds').insert({
    project_id: pA.id, activity_id: act('System Test (QA)').id, title: 'Regression Round 2', test_type: 'regression',
    tester_id: ids.qa, planned_date: day(1), due_date: day(3), status: 'planned',
  }), 'round2');
  const bug = async (title: string, severity: string, dev: string | null, extra: Record<string, any> = {}) => must(await QA.rpc('report_bug', {
    p_project_id: pA.id, p_title: title, p_description: extra.description ?? title, p_severity: severity, p_priority: severity,
    p_test_round_id: round1.id, p_activity_id: null, p_task_id: extra.task ?? null, p_steps: extra.steps ?? null,
    p_expected: extra.expected ?? null, p_actual: extra.actual ?? null, p_assigned_dev_id: dev ? ids[dev] : null, p_due_date: extra.due ?? null,
  }), `bug ${title}`);
  const startFix = async (who: string, b: any) => must(await clients[who].rpc('start_fix', { p_bug_id: b.id }), 'start_fix');
  const ready = async (who: string, f: any, desc: string) => must(await clients[who].rpc('mark_fix_ready', {
    p_fix_id: f.id, p_description: desc, p_unit_test_result: 'All unit tests passed (48/48)', p_technical_note: null,
    p_build_link: 'https://ci.tbkk.local/downtime/build/231', p_commit_link: 'https://git.tbkk.local/sys/downtime/commit/9f2c1ab', p_tester_id: null,
  }), 'fix_ready');

  // B1 critical → fix ready, waiting retest
  const b1 = await bug('Shift summary total wrong when downtime crosses midnight', 'critical', 'dev1', {
    task: be.id, steps: '1. Record downtime 23:30–00:30\n2. Open shift summary', expected: '60 minutes in night shift', actual: '-1380 minutes', due: day(1) });
  const f1 = await startFix('dev1', b1);
  await ready('dev1', f1, 'Split downtime records at shift boundary; use tz-aware interval');
  // B2 high → fix ready → retest failed → reopened
  const b2 = await bug('Dashboard line filter resets after auto-refresh', 'high', 'dev2', { due: day(-1) });
  const f2 = await startFix('dev2', b2);
  await ready('dev2', f2, 'Persist filter in URL search params');
  const r2 = must(await admin.from('retests').select('*').eq('bug_id', b2.id).single(), 'r2');
  must(await QA.rpc('record_retest', { p_retest_id: r2.id, p_result: 'failed', p_comment: 'Filter still resets when switching tabs.' }), 'retest fail');
  // B3 medium → fixed → retest passed → closed
  const b3 = await bug('Typo in reason code list ("Mantenance")', 'medium', 'dev2');
  const f3 = await startFix('dev2', b3);
  await ready('dev2', f3, 'Fix seed data for reason codes');
  const r3 = must(await admin.from('retests').select('*').eq('bug_id', b3.id).single(), 'r3');
  must(await QA.rpc('record_retest', { p_retest_id: r3.id, p_result: 'passed', p_comment: 'Verified on build 231.' }), 'retest pass');
  // B4 low → new, not assigned yet; B5 high assigned, fix overdue
  await bug('Export button tooltip missing', 'low', null);
  const b5 = await bug('Line master import ignores inactive lines', 'high', 'dev1', { due: day(-3) });
  await startFix('dev1', b5);

  // ---------------- Project B: on track, small app ----------------
  const rB = await newRequest({
    project_name: 'Tool Crib Borrow / Return App', description: 'Small app to borrow and return tools with QR code.',
    reason: 'Tools are lost frequently; borrow book is not tracked.', expectation: 'Know who holds which tool at any time.',
    priority: 'medium', date_required: day(25), benefit: 'Reduce tool loss cost.',
  });
  await submit(rB);
  await fullyApprove(rB, 'APP', 'INTERNAL_APP');
  const pB = await convert(rB, day(-2), day(20), 'Maintenance Manager');
  await addMembers(pB.id, [['dev2', 'developer'], ['supervisor', 'supervisor']]);
  must(await L.rpc('create_baseline', { p_project_id: pB.id, p_reason: null }), 'baseline B');
  const tB = must(await L.from('internal_tasks').select('*').eq('project_id', pB.id), 'tB');
  for (const t of tB as any[]) must(await L.from('internal_tasks').update({ owner_id: ids.dev2 }).eq('id', t.id), 'tB owner');
  const aB = must(await L.from('activities').select('*').eq('project_id', pB.id).order('seq'), 'aB');
  must(await L.from('activities').update({ progress: 60, actual_start: day(-2), status_note: 'Requirement draft reviewed', next_action: 'Confirm QR label format' }).eq('id', aB[0].id), 'aB0');
  must(await L.from('projects').update({ next_action: 'Confirm requirement with Maintenance' }).eq('id', pB.id), 'pB');
  // Phase 2: re-plan request waiting for Manager approval
  must(await L.from('activities').update({ plan_finish: day(14) }).eq('id', aB[1].id), 'aB1 replan');
  must(await L.rpc('request_baseline_revision', { p_project_id: pB.id, p_reason: 'Maintenance added QR label printing to scope (approved CR-02)',
    p_impact: 'Development +3 days; target +3 days', p_new_target: day(23) }), 'baseline revision');

  // ---------------- Project C: converted, still planning ----------------
  const rC = await newRequest({
    project_name: 'Factory Wi-Fi Coverage Upgrade', description: 'Upgrade Wi-Fi access points in Building 3 for handheld scanners.',
    reason: 'Scanners lose connection in warehouse zone C.', expectation: 'Stable coverage -67 dBm across Building 3.',
    priority: 'critical', date_required: day(60), benefit: 'Avoid scanning re-work in warehouse.',
  });
  await submit(rC);
  await fullyApprove(rC, 'INFRA', 'INFRA');
  await convert(rC, day(3), day(45), 'Warehouse Manager');

  // ---------------- Requests in different workflow states ----------------
  const rD = await newRequest({
    project_name: 'QC Inspection Result Digital Form', description: 'Replace paper inspection sheet with tablet form.',
    reason: 'Paper sheets are hard to search for customer claims.', expectation: 'Searchable inspection history by lot.',
    priority: 'high', date_required: day(50), benefit: 'Faster claim investigation.',
  });
  await submit(rD);
  await fullyApprove(rD, 'WEB', 'WEB_DEV'); // approved, ready to convert

  const rE = await newRequest({
    project_name: 'Energy Meter Auto Reading', description: 'Collect power meter readings automatically every 15 minutes.',
    reason: 'Meter reading is manual once per day.', expectation: 'Energy dashboard per building.',
    priority: 'medium', date_required: day(90), benefit: 'Energy saving analysis.',
  });
  await submit(rE);
  await approve('reqmgr', rE.id, 'OK'); // waiting system review

  const rF = await newRequest({
    project_name: 'Overtime Request Workflow', description: 'Online OT request and approval.',
    reason: 'OT forms are paper based.', expectation: 'OT approval within the same day.',
    priority: 'low', date_required: day(120), benefit: 'Less paper; faster approval.',
  });
  await submit(rF); // waiting requestor approval

  await newRequest({ project_name: 'Spare Part Min/Max Alert', description: 'Alert when spare part stock is below minimum.', priority: 'medium' }); // draft

  // ---------------- Phase 3: Workforce plan (this week + next) ----------------
  const wf: Record<string, unknown>[] = [];
  const monday = (() => { const d = new Date(); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d; })();
  const iso = localIso;
  for (let i = 0; i < 12; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const date = iso(d);
    wf.push({ user_id: ids.dev1, work_date: date, work_type: i % 5 === 4 ? 'wfh' : 'office', start_time: '08:00', end_time: '17:00', location: i % 5 === 4 ? 'Home' : 'HQ Building 1', project_id: pA.id });
    wf.push({ user_id: ids.qa, work_date: date, work_type: i % 5 === 1 ? 'factory_support' : 'office', start_time: '08:00', end_time: '17:00', location: i % 5 === 1 ? 'Plant 2 — Assembly Line 2' : 'HQ Building 1', project_id: i % 5 === 1 ? pA.id : null });
    wf.push({ user_id: ids.leader, work_date: date, work_type: i % 5 === 2 ? 'customer_site' : 'office', start_time: '08:00', end_time: '17:00', location: i % 5 === 2 ? 'Maintenance Dept.' : 'HQ Building 1', project_id: i % 5 === 2 ? pB.id : null });
    wf.push({ user_id: ids.supervisor, work_date: date, work_type: i % 5 === 3 ? 'training' : 'office', start_time: '08:00', end_time: '17:00', location: i % 5 === 3 ? 'TBKK Academy' : 'HQ Building 1', remark: i % 5 === 3 ? 'ITIL Foundation' : null });
    if (i % 5 === 0) wf.push({ user_id: ids.dev1, work_date: date, work_type: 'ot', start_time: '17:30', end_time: '20:30', location: 'HQ Building 1', project_id: pA.id, remark: 'Recovery plan OT' });
  }
  // dev2 on leave on the due date of one of their upcoming tasks (→ Smart Insight "owner on leave")
  const leaveDay = new Date(monday); leaveDay.setDate(monday.getDate() + 8); // Tuesday next week
  const tB2 = must(await admin.from('internal_tasks').select('*').eq('owner_id', ids.dev2).eq('project_id', pB.id).neq('status', 'completed').order('due_date').limit(1), 'tB2');
  if (tB2[0]) must(await admin.from('internal_tasks').update({ due_date: iso(leaveDay) }).eq('id', tB2[0].id), 'tB2 due');
  const leaveDays = new Set([iso(leaveDay)]);
  for (let i = 0; i < 12; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const date = iso(d);
    wf.push(leaveDays.has(date)
      ? { user_id: ids.dev2, work_date: date, work_type: 'leave', location: null, remark: 'Annual leave' }
      : { user_id: ids.dev2, work_date: date, work_type: 'office', start_time: '08:00', end_time: '17:00', location: 'HQ Building 1', project_id: pB.id });
  }
  must(await admin.from('workforce_plans').insert(wf), 'workforce');
  must(await admin.rpc('take_kpi_snapshot'), 'kpi snapshot');

  const scan = must(await admin.rpc('run_notification_scan'), 'scan');
  console.log('✓ workflow data seeded; scan:', scan);
  const { data: projects } = await admin.from('v_projects').select('project_code, project_name, status, health, progress, forecast_date, baseline_finish');
  console.table(projects);
}

main()
  .then(() => pool().end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
