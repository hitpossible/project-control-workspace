-- =====================================================================
-- Phase 3 — Management Intelligence
--   KPI (project / team / individual) · Smart Insight · Workforce Plan · KPI snapshots
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------
insert into public.app_settings(key, value, description) values
  ('kpi_excluded_delay_categories', '["Waiting User","Vendor","Approval Delay","Requirement Change"]',
   'Late tasks with these delay categories are excused from individual on-time KPI (PRD §23 fairness)')
on conflict (key) do nothing;

create table public.insight_rules (
  code         text primary key,
  name         text not null,
  description  text,
  severity     text not null default 'warning',
  threshold    integer,
  threshold_label text,
  internal     boolean not null default false,
  is_active    boolean not null default true,
  constraint insight_rules_sev_chk check (severity in ('critical','warning','info'))
);

insert into public.insight_rules(code, name, description, severity, threshold, threshold_label, internal) values
  ('no_target_date',       'No Required / Target Date',        'Active project without target date',                         'warning', null, null, false),
  ('no_leader',            'No Project Leader',                'Project has no leader',                                       'critical', null, null, false),
  ('no_next_action',       'No Next Action',                   'Project or in-progress activity without next action',         'info',    null, null, false),
  ('waiting_too_long',     'Waiting too long',                 'Activity / project in Waiting or On Hold longer than X days', 'warning', 7, 'days', false),
  ('forecast_vs_baseline', 'Forecast exceeds Baseline',        'Forecast finish later than baseline by more than X days',     'warning', 0, 'days', false),
  ('activity_overdue',     'Activity overdue',                 'Activity past plan finish and not completed',                 'warning', null, null, false),
  ('delay_no_recovery',    'Delay without Recovery Plan',      'Delayed / overdue activity without a recovery plan',          'critical', null, null, false),
  ('recovery_not_reviewed','Recovery plan not reviewed',       'Recovery plan not reviewed by Supervisor/Manager within X days','info',  3, 'days', false),
  ('evidence_missing',     'Mandatory evidence missing',       'Mandatory checklist items missing for finished / due items',  'warning', null, null, false),
  ('progress_stale',       'Progress not updated',             'In-progress activity not updated for more than X days',       'info',    7, 'days', false),
  ('too_many_reschedules', 'Rescheduled too many times',       'Baseline revised more than X times',                          'warning', 2, 'revisions', false),
  ('no_baseline',          'No baseline',                      'Project still without Baseline V1 after X days',              'warning', 14, 'days', false),
  ('critical_bug_open',    'Critical bug open',                'Critical bug not closed',                                     'critical', null, null, true),
  ('fix_overdue',          'Bug fix overdue',                  'Bug fix past due date',                                       'warning', null, null, true),
  ('retest_overdue',       'Retest overdue',                   'Retest past due date',                                        'warning', null, null, true),
  ('member_overloaded',    'Member overloaded',                'Person with more than X open tasks + bugs',                   'info',    8, 'open items', true),
  ('owner_on_leave',       'Owner on leave on due date',       'Task owner / PIC planned leave on the due date (next X days)','warning', 14, 'days ahead', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Workforce Plan (PRD §24)
-- ---------------------------------------------------------------------
create table public.workforce_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  work_date   date not null,
  start_time  time,
  end_time    time,
  work_type   text not null default 'office',
  location    text,
  project_id  uuid references public.projects(id) on delete set null,
  remark      text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint workforce_type_chk check (work_type in ('office','onsite','wfh','customer_site','factory_support','training','leave','ot')),
  constraint workforce_time_chk check (end_time is null or start_time is null or end_time > start_time)
);
create index workforce_user_date_idx on public.workforce_plans(user_id, work_date);
create index workforce_date_idx on public.workforce_plans(work_date);

alter table public.workforce_plans enable row level security;
create policy workforce_select on public.workforce_plans for select to authenticated
  using (user_id = auth.uid() or public.is_system_staff());
create policy workforce_write on public.workforce_plans for all to authenticated
  using (user_id = auth.uid() or public.has_role('supervisor') or public.has_role('manager'))
  with check (user_id = auth.uid() or public.has_role('supervisor') or public.has_role('manager'));
grant select, insert, update, delete on public.workforce_plans to authenticated, service_role;

create trigger workforce_audit after insert or update or delete on public.workforce_plans
  for each row execute function public.audit_changes('work_type','work_date','project_id','start_time','end_time');

alter table public.insight_rules enable row level security;
create policy insight_rules_select on public.insight_rules for select to authenticated using (true);
create policy insight_rules_admin on public.insight_rules for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
grant select, insert, update, delete on public.insight_rules to authenticated, service_role;

-- ---------------------------------------------------------------------
-- KPI helpers
-- ---------------------------------------------------------------------
create or replace function public.kpi_excluded_categories()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(x) from public.app_settings s, jsonb_array_elements_text(s.value) x
                   where s.key = 'kpi_excluded_delay_categories'), array[]::text[]);
$$;

-- Days spent in 'waiting' (activities) from the audit trail
create or replace function public.project_waiting_days(p_project_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  with ev as (
    select entity_id, created_at, new_value,
           lead(created_at) over (partition by entity_id order by created_at, id) as nxt
    from public.audit_logs
    where project_id = p_project_id and table_name = 'activities' and field = 'status'
  )
  select round(coalesce(sum(extract(epoch from (coalesce(nxt, now()) - created_at)) / 86400) filter (where new_value = 'waiting'), 0)::numeric, 1)
  from ev;
$$;

create or replace function public.can_view_kpi_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_roles() && array['project_leader','supervisor','manager','admin']::text[];
$$;

-- ---------------------------------------------------------------------
-- Project KPI (§23.1)
-- ---------------------------------------------------------------------
create or replace function public.kpi_projects()
returns table(
  project_id uuid, project_code text, project_name text, leader_name text, status text, health text,
  progress numeric, start_date date, target_date date, forecast_date date, baseline_finish date, schedule_variance int,
  completed_on date, on_time boolean, reschedules int, waiting_days numeric,
  tasks_total int, tasks_completed int, tasks_on_time_rate numeric, overdue_tasks int,
  evidence_total int, evidence_done int, evidence_completion numeric,
  bugs_total int, bugs_closed int, bug_closure_rate numeric, open_bugs int,
  retests_done int, retest_pass_rate numeric
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  select p.id, p.project_code, p.project_name, l.full_name, p.status, p.health, p.progress, p.start_date, p.target_date, p.forecast_date,
         bl.planned_finish,
         case when bl.planned_finish is not null and p.forecast_date is not null then p.forecast_date - bl.planned_finish end,
         case when p.status = 'completed' then ac.last_finish end,
         case when p.status = 'completed' then ac.last_finish <= coalesce(bl.first_target, p.target_date) end,
         greatest(p.baseline_version - 1, 0),
         public.project_waiting_days(p.id),
         case when public.can_view_internal(p.id) then tk.total end,
         case when public.can_view_internal(p.id) then tk.done end,
         case when public.can_view_internal(p.id) and tk.done > 0 then round(100.0 * tk.on_time / tk.done, 1) end,
         case when public.can_view_internal(p.id) then tk.overdue end,
         ev.total, ev.done, case when ev.total > 0 then round(100.0 * ev.done / ev.total, 1) end,
         bg.total, bg.closed, case when bg.total > 0 then round(100.0 * bg.closed / bg.total, 1) end, bg.open,
         rt.done, case when rt.done > 0 then round(100.0 * rt.passed / rt.done, 1) end
  from public.projects p
  left join public.profiles l on l.id = p.leader_id
  left join lateral (
    select (select b.planned_finish from public.project_baselines b where b.project_id = p.id order by b.version_no desc limit 1) as planned_finish,
           (select b.target_date from public.project_baselines b where b.project_id = p.id order by b.version_no limit 1) as first_target
  ) bl on true
  left join lateral (select max(a.actual_finish) as last_finish from public.activities a where a.project_id = p.id and a.status <> 'cancelled') ac on true
  left join lateral (
    select count(*)::int as total, count(*) filter (where t.status = 'completed')::int as done,
           count(*) filter (where t.status = 'completed' and t.actual_finish <= t.due_date)::int as on_time,
           count(*) filter (where t.status not in ('completed','cancelled') and t.due_date < current_date)::int as overdue
    from public.internal_tasks t where t.project_id = p.id and t.status <> 'cancelled'
  ) tk on true
  left join lateral (
    select count(*)::int as total,
           count(*) filter (where exists (select 1 from public.evidence e where e.requirement_id = r.id and e.verification_status <> 'rejected'))::int as done
    from public.evidence_requirements r where r.project_id = p.id and r.is_mandatory
  ) ev on true
  left join lateral (
    select count(*) filter (where b.status <> 'cancelled')::int as total, count(*) filter (where b.status = 'closed')::int as closed,
           count(*) filter (where b.status not in ('closed','cancelled'))::int as open
    from public.bugs b where b.project_id = p.id
  ) bg on true
  left join lateral (
    select count(*) filter (where r.status = 'done')::int as done, count(*) filter (where r.result = 'passed')::int as passed
    from public.retests r where r.project_id = p.id
  ) rt on true
  where public.can_view_project(p.id)
  order by p.project_code;
end $$;

-- ---------------------------------------------------------------------
-- Team KPI (§23.2) for a period
-- ---------------------------------------------------------------------
create or replace function public.kpi_team(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  v_internal boolean := public.is_system_staff();
begin
  if not (public.is_system_staff() or public.has_role('management_view')) then
    raise exception 'Team KPI is available to System Service and Management only';
  end if;
  with kp as (select * from public.kpi_projects()),
  active as (
    select * from kp where coalesce(start_date, current_date) <= p_to
      and (status not in ('completed','cancelled') or (completed_on between p_from and p_to))
  ),
  done as (select * from kp where status = 'completed' and completed_on between p_from and p_to),
  tasks as (
    select t.* from public.internal_tasks t
    where t.status = 'completed' and t.actual_finish between p_from and p_to
  ),
  bugs_closed as (select * from public.bugs where status = 'closed' and closed_at::date between p_from and p_to),
  bugs_new as (select * from public.bugs where created_at::date between p_from and p_to),
  rts as (select * from public.retests where status = 'done' and tested_at::date between p_from and p_to)
  select jsonb_build_object(
    'total_projects', (select count(*) from active),
    'completed_projects', (select count(*) from done),
    'on_time_rate', (select case when count(*) > 0 then round(100.0 * count(*) filter (where on_time) / count(*), 1) end from done),
    'delayed_projects', (select count(*) from active where status = 'delayed'),
    'at_risk_projects', (select count(*) from active where status = 'at_risk'),
    'avg_schedule_variance', (select round(avg(schedule_variance), 1) from active where schedule_variance is not null),
    'avg_waiting_days', (select round(avg(waiting_days), 1) from active),
    'overdue_tasks', case when v_internal then (select count(*) from public.internal_tasks t join public.projects p on p.id = t.project_id
                        where t.status not in ('completed','cancelled') and t.due_date < current_date and p.status not in ('completed','cancelled')) end,
    'evidence_completion_rate', (select case when sum(evidence_total) > 0 then round(100.0 * sum(evidence_done) / sum(evidence_total), 1) end from active),
    'tasks_completed', case when v_internal then (select count(*) from tasks) end,
    'task_on_time_rate', case when v_internal then (select case when count(*) > 0 then round(100.0 * count(*) filter (where actual_finish <= due_date) / count(*), 1) end from tasks) end,
    'bugs_reported', (select count(*) from bugs_new),
    'bugs_closed', (select count(*) from bugs_closed),
    'avg_bug_resolution_days', (select round(avg(extract(epoch from (closed_at - created_at)) / 86400)::numeric, 1) from bugs_closed),
    'retest_pass_rate', (select case when count(*) > 0 then round(100.0 * count(*) filter (where result = 'passed') / count(*), 1) end from rts)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Individual KPI (§23.3) — own row only unless Leader / Supervisor / Manager / Admin
-- Late tasks with excluded delay categories (Waiting User, Vendor…) are excused.
-- ---------------------------------------------------------------------
create or replace function public.kpi_individual(p_from date, p_to date)
returns table(
  user_id uuid, full_name text, roles text[],
  assigned_tasks int, completed_tasks int, on_time_tasks int, late_tasks int, excused_late int,
  on_time_rate numeric, avg_delay_days numeric, overdue_tasks int, open_tasks int,
  bugs_assigned int, fixes_ready int, avg_fix_days numeric, fix_first_time_pass_rate numeric,
  evidence_completion numeric, retests_done int, avg_retest_turnaround_days numeric
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ex text[] := public.kpi_excluded_categories();
  v_all boolean := public.can_view_kpi_all();
begin
  return query
  with people as (
    select pr.id, pr.full_name, pr.roles from public.profiles pr
    where pr.is_active and pr.roles && array['developer','qa','project_leader','support']::text[]
      and (v_all or pr.id = auth.uid())
  ),
  t as (
    select it.*, (it.delay_category = any(v_ex)) as excused from public.internal_tasks it
    join public.projects p on p.id = it.project_id where p.status <> 'cancelled' and it.status <> 'cancelled'
  )
  select pe.id, pe.full_name, pe.roles,
    (select count(*)::int from t where t.owner_id = pe.id and t.due_date between p_from and p_to),
    (select count(*)::int from t where t.owner_id = pe.id and t.status = 'completed' and t.actual_finish between p_from and p_to),
    (select count(*)::int from t where t.owner_id = pe.id and t.status = 'completed' and t.actual_finish between p_from and p_to and t.actual_finish <= t.due_date),
    (select count(*)::int from t where t.owner_id = pe.id and t.status = 'completed' and t.actual_finish between p_from and p_to and t.actual_finish > t.due_date and not coalesce(t.excused, false)),
    (select count(*)::int from t where t.owner_id = pe.id and t.status = 'completed' and t.actual_finish between p_from and p_to and t.actual_finish > t.due_date and coalesce(t.excused, false)),
    (select case when count(*) filter (where not (t.actual_finish > t.due_date and coalesce(t.excused, false))) > 0
            then round(100.0 * count(*) filter (where t.actual_finish <= t.due_date)
                 / count(*) filter (where not (t.actual_finish > t.due_date and coalesce(t.excused, false))), 1) end
       from t where t.owner_id = pe.id and t.status = 'completed' and t.actual_finish between p_from and p_to),
    (select round(avg(t.actual_finish - t.due_date), 1) from t where t.owner_id = pe.id and t.status = 'completed'
       and t.actual_finish between p_from and p_to and t.actual_finish > t.due_date and not coalesce(t.excused, false)),
    (select count(*)::int from t where t.owner_id = pe.id and t.status <> 'completed' and t.due_date < current_date and not coalesce(t.excused, false)),
    (select count(*)::int from t where t.owner_id = pe.id and t.status <> 'completed'),
    (select count(*)::int from public.bugs b where b.assigned_dev_id = pe.id and b.created_at::date between p_from and p_to),
    (select count(*)::int from public.bug_fixes f where f.fix_owner_id = pe.id and f.fix_ready_at::date between p_from and p_to),
    (select round(avg(extract(epoch from (f.fix_ready_at - f.created_at)) / 86400)::numeric, 1) from public.bug_fixes f
       where f.fix_owner_id = pe.id and f.fix_ready_at::date between p_from and p_to),
    (select case when count(*) filter (where f.status in ('verified','failed')) > 0
            then round(100.0 * count(*) filter (where f.status = 'verified' and f.fix_cycle = 1) / nullif(count(distinct f.bug_id) filter (where f.status in ('verified','failed')), 0), 1) end
       from public.bug_fixes f where f.fix_owner_id = pe.id and f.fix_ready_at::date between p_from and p_to),
    (select case when count(*) > 0 then round(100.0 * count(*) filter (where exists (
              select 1 from public.evidence e where e.requirement_id = r.id and e.verification_status <> 'rejected')) / count(*), 1) end
       from public.evidence_requirements r join public.internal_tasks it on r.entity_type = 'task' and it.id = r.entity_id
       where r.is_mandatory and it.owner_id = pe.id),
    (select count(*)::int from public.retests r where r.tester_id = pe.id and r.status = 'done' and r.tested_at::date between p_from and p_to),
    (select round(avg(extract(epoch from (r.tested_at - r.created_at)) / 86400)::numeric, 1) from public.retests r
       where r.tester_id = pe.id and r.status = 'done' and r.tested_at::date between p_from and p_to)
  from people pe
  order by pe.full_name;
end $$;

-- ---------------------------------------------------------------------
-- KPI snapshots (trend) — weekly via pg_cron
-- ---------------------------------------------------------------------
create table public.project_kpi_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  snapshot_date       date not null default current_date,
  progress            numeric,
  health              text,
  status              text,
  schedule_variance   int,
  overdue_tasks       int,
  open_bugs           int,
  evidence_completion numeric,
  waiting_days        numeric,
  created_at          timestamptz not null default now(),
  unique (project_id, snapshot_date)
);
alter table public.project_kpi_snapshots enable row level security;
create policy kpi_snap_select on public.project_kpi_snapshots for select to authenticated using (public.can_view_project(project_id));
grant select on public.project_kpi_snapshots to authenticated;
grant all on public.project_kpi_snapshots to service_role;

create or replace function public.take_kpi_snapshot()
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.project_kpi_snapshots(project_id, snapshot_date, progress, health, status, schedule_variance, overdue_tasks, open_bugs, evidence_completion, waiting_days)
  select p.id, current_date, p.progress, p.health, p.status,
         (select p.forecast_date - b.planned_finish from public.project_baselines b where b.project_id = p.id order by version_no desc limit 1),
         (select count(*) from public.internal_tasks t where t.project_id = p.id and t.status not in ('completed','cancelled') and t.due_date < current_date),
         (select count(*) from public.bugs b where b.project_id = p.id and b.status not in ('closed','cancelled')),
         (select case when count(*) > 0 then round(100.0 * count(*) filter (where exists (select 1 from public.evidence e where e.requirement_id = r.id and e.verification_status <> 'rejected')) / count(*), 1) end
            from public.evidence_requirements r where r.project_id = p.id and r.is_mandatory),
         public.project_waiting_days(p.id)
  from public.projects p where p.status not in ('cancelled','draft')
  on conflict (project_id, snapshot_date) do update set progress = excluded.progress, health = excluded.health, status = excluded.status,
    schedule_variance = excluded.schedule_variance, overdue_tasks = excluded.overdue_tasks, open_bugs = excluded.open_bugs,
    evidence_completion = excluded.evidence_completion, waiting_days = excluded.waiting_days;
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.take_kpi_snapshot() from public, anon, authenticated;

create or replace function public.trigger_kpi_snapshot()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not public.can_view_kpi_all() then raise exception 'Not allowed'; end if;
  return public.take_kpi_snapshot();
end $$;

do $$
begin
  perform cron.schedule('pcw-kpi-snapshot', '0 6 * * 1', 'select public.take_kpi_snapshot()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- Smart Insight (§22) — rule based, thresholds from insight_rules
-- ---------------------------------------------------------------------
create or replace function public.smart_insights(p_project_id uuid default null)
returns table(project_id uuid, project_code text, rule_code text, severity text, title text, detail text, entity_type text, entity_id uuid, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  th      jsonb;
  v_staff boolean := public.is_system_staff();
begin
  select jsonb_object_agg(ir.code, jsonb_build_object('t', ir.threshold, 's', ir.severity, 'a', ir.is_active, 'i', ir.internal)) into th from public.insight_rules ir;

  return query
  select * from (
  with pj as (select p.* from public.projects p
              where p.status not in ('completed','cancelled') and (p_project_id is null or p.id = p_project_id) and public.can_view_project(p.id)),
  rules as (select key as code, (value->>'t')::int as t, value->>'s' as s, (value->>'a')::boolean as a, (value->>'i')::boolean as i from jsonb_each(th)),
  act as (select a.*, pj.project_code from public.activities a join pj on pj.id = a.project_id where a.status <> 'cancelled'),
  bl as (select distinct on (b.project_id) b.project_id, b.planned_finish from public.project_baselines b join pj on pj.id = b.project_id order by b.project_id, b.version_no desc),
  found as (
    -- project level
    select pj.id as pid, pj.project_code as pcode, 'no_target_date' as code, 'No target date' as ttl, 'Project has no target date — set one to track due date and forecast.' as det, 'project' as et, pj.id as eid, '' as lnk from pj where pj.target_date is null
    union all select pj.id, pj.project_code, 'no_leader', 'No Project Leader', 'Assign a Project Leader to take ownership.', 'project', pj.id, '' from pj where pj.leader_id is null
    union all select pj.id, pj.project_code, 'no_next_action', 'No next action', 'Project has no Next Action — management cannot see what happens next.', 'project', pj.id, '' from pj where coalesce(trim(pj.next_action), '') = ''
    union all select pj.id, pj.project_code, 'waiting_too_long', 'Project waiting too long',
           format('Project %s for %s day(s).', replace(pj.status, '_', ' '), current_date - pj.updated_at::date), 'project', pj.id, ''
      from pj, rules r where r.code = 'waiting_too_long' and pj.status in ('waiting','on_hold') and current_date - pj.updated_at::date > coalesce(r.t, 7)
    union all select pj.id, pj.project_code, 'no_baseline', 'No baseline',
           format('Project created %s day(s) ago and Baseline V1 is not set.', current_date - pj.created_at::date), 'project', pj.id, '?tab=baseline'
      from pj, rules r where r.code = 'no_baseline' and pj.baseline_version = 0 and current_date - pj.created_at::date > coalesce(r.t, 14)
    union all select pj.id, pj.project_code, 'too_many_reschedules', 'Rescheduled many times',
           format('Baseline revised %s time(s) (V%s).', pj.baseline_version - 1, pj.baseline_version), 'project', pj.id, '?tab=baseline'
      from pj, rules r where r.code = 'too_many_reschedules' and pj.baseline_version - 1 > coalesce(r.t, 2)
    union all select pj.id, pj.project_code, 'forecast_vs_baseline',
           case when exists (select 1 from act a where a.project_id = pj.id and (a.plan_finish < current_date and a.status not in ('completed','cancelled')) and coalesce(trim(a.recovery_plan), '') = '')
                then 'Forecast exceeds baseline — no Recovery Plan' else 'Forecast exceeds baseline' end,
           case when exists (select 1 from act a where a.project_id = pj.id and (a.plan_finish < current_date and a.status not in ('completed','cancelled')) and coalesce(trim(a.recovery_plan), '') = '')
                then format('Forecast finish exceeds baseline by %s day(s) and no Recovery Plan has been provided.', pj.forecast_date - bl.planned_finish)
                else format('Forecast finish %s exceeds baseline %s by %s day(s).', to_char(pj.forecast_date, 'DD Mon'), to_char(bl.planned_finish, 'DD Mon'), pj.forecast_date - bl.planned_finish) end,
           'project', pj.id, '?tab=baseline'
      from pj join bl on bl.project_id = pj.id, rules r where r.code = 'forecast_vs_baseline' and pj.forecast_date - bl.planned_finish > coalesce(r.t, 0)
    -- activity level
    union all select a.project_id, a.project_code, 'activity_overdue', format('Activity overdue: %s', a.name),
           format('Plan finish %s — %s day(s) overdue, progress %s%%.', to_char(a.plan_finish, 'DD Mon'), current_date - a.plan_finish, round(a.progress)), 'activity', a.id, '?tab=plan'
      from act a where (a.plan_finish < current_date and a.status not in ('completed','cancelled'))
    union all select a.project_id, a.project_code, 'delay_no_recovery', format('No recovery plan: %s', a.name),
           format('Activity is %s without a Recovery Plan (Rule 15).', case when (a.plan_finish < current_date and a.status not in ('completed','cancelled')) then 'overdue' else 'delayed' end), 'activity', a.id, '?tab=plan'
      from act a where (a.status = 'delayed' or (a.plan_finish < current_date and a.status not in ('completed','cancelled'))) and coalesce(trim(a.recovery_plan), '') = ''
    union all select a.project_id, a.project_code, 'recovery_not_reviewed', format('Recovery plan awaiting review: %s', a.name),
           'Supervisor / Manager has not reviewed the recovery plan yet.', 'activity', a.id, '?tab=plan'
      from act a, rules r where r.code = 'recovery_not_reviewed' and coalesce(trim(a.recovery_plan), '') <> '' and a.recovery_reviewed_by is null
        and a.status not in ('completed') and current_date - a.updated_at::date >= coalesce(r.t, 3)
    union all select a.project_id, a.project_code, 'waiting_too_long', format('Waiting too long: %s', a.name),
           format('Activity waiting for %s day(s)%s.', current_date - coalesce(
             (select max(l.created_at)::date from public.audit_logs l where l.entity_id = a.id and l.field = 'status' and l.new_value = 'waiting'), a.updated_at::date),
             coalesce(' — ' || a.status_note, '')), 'activity', a.id, '?tab=plan'
      from act a, rules r where r.code = 'waiting_too_long' and a.status = 'waiting'
        and current_date - coalesce((select max(l.created_at)::date from public.audit_logs l where l.entity_id = a.id and l.field = 'status' and l.new_value = 'waiting'), a.updated_at::date) > coalesce(r.t, 7)
    union all select a.project_id, a.project_code, 'progress_stale', format('Progress not updated: %s', a.name),
           format('No update for %s day(s) (progress %s%%).', current_date - a.updated_at::date, round(a.progress)), 'activity', a.id, '?tab=plan'
      from act a, rules r where r.code = 'progress_stale' and a.status in ('in_progress','at_risk') and current_date - a.updated_at::date > coalesce(r.t, 7)
    union all select a.project_id, a.project_code, 'no_next_action', format('No next action: %s', a.name),
           'In-progress activity without Next Action.', 'activity', a.id, '?tab=plan'
      from act a where a.status in ('in_progress','delayed','at_risk') and coalesce(trim(a.next_action), '') = ''
    union all select x.project_id, pj.project_code, 'evidence_missing', format('Mandatory evidence missing (%s)', count(*)),
           'Missing: ' || string_agg(x.name, ', ' order by x.name), 'project', x.project_id, '?tab=evidence'
      from public.evidence_requirements x join pj on pj.id = x.project_id
      left join public.activities ea on x.entity_type = 'activity' and ea.id = x.entity_id
      left join public.internal_tasks et on x.entity_type = 'task' and et.id = x.entity_id
      where x.is_mandatory and not exists (select 1 from public.evidence e where e.requirement_id = x.id and e.verification_status <> 'rejected')
        and ((ea.id is not null and ea.status <> 'cancelled' and (ea.progress >= 100 or ea.plan_finish < current_date))
          or (et.id is not null and et.status <> 'cancelled' and (et.progress >= 100 or et.due_date < current_date)))
      group by x.project_id, pj.project_code
    -- internal (QA / people)
    union all select b.project_id, pj.project_code, 'critical_bug_open', format('Critical bug open: %s', b.bug_no),
           format('%s — %s, developer %s.', b.title, replace(b.status, '_', ' '), coalesce((select full_name from public.profiles where id = b.assigned_dev_id), 'not assigned')),
           'bug', b.id, format('?tab=qa&bug=%s', b.id)
      from public.bugs b join pj on pj.id = b.project_id where v_staff and b.severity = 'critical' and b.status not in ('closed','cancelled')
    union all select b.project_id, pj.project_code, 'fix_overdue', format('Bug fix overdue: %s', b.bug_no),
           format('%s — due %s (%s day(s) late).', b.title, to_char(b.due_date, 'DD Mon'), current_date - b.due_date), 'bug', b.id, format('?tab=qa&bug=%s', b.id)
      from public.bugs b join pj on pj.id = b.project_id where v_staff and b.status in ('assigned','in_progress','reopened') and b.due_date < current_date
    union all select r.project_id, pj.project_code, 'retest_overdue', format('Retest overdue: %s', b.bug_no),
           format('Waiting for %s since %s.', coalesce((select full_name from public.profiles where id = r.tester_id), 'QA'), to_char(r.due_date, 'DD Mon')), 'bug', b.id, format('?tab=qa&bug=%s', b.id)
      from public.retests r join public.bugs b on b.id = r.bug_id join pj on pj.id = r.project_id where v_staff and r.status = 'pending' and r.due_date < current_date
    union all select t.project_id, pj.project_code, 'owner_on_leave', format('Owner on leave on due date: %s %s', t.task_no, t.name),
           format('%s has planned leave on %s.', pr.full_name, to_char(t.due_date, 'DD Mon')), 'task', t.id, format('?tab=internal&task=%s', t.id)
      from public.internal_tasks t join pj on pj.id = t.project_id join public.profiles pr on pr.id = t.owner_id, rules r
      where v_staff and r.code = 'owner_on_leave' and t.status not in ('completed','cancelled')
        and t.due_date between current_date and current_date + coalesce(r.t, 14)
        and exists (select 1 from public.workforce_plans w where w.user_id = t.owner_id and w.work_date = t.due_date and w.work_type = 'leave')
  )
  select f.pid, f.pcode, f.code, r.s, f.ttl, f.det, f.et, f.eid, format('/projects/%s%s', f.pid, f.lnk)
  from found f join rules r on r.code = f.code
  where r.a and (not r.i or v_staff)
  union all
  -- team level: overloaded members (no project)
  select null::uuid, null::text, 'member_overloaded', r.s, format('Overloaded: %s', pr.full_name),
         format('%s open task(s) + %s open bug(s).', ot.n, ob.n), 'person', pr.id, '/my-tasks?scope=all'
  from public.profiles pr, rules r,
       lateral (select count(*) as n from public.internal_tasks t join public.projects p on p.id = t.project_id
                where t.owner_id = pr.id and t.status not in ('completed','cancelled') and p.status not in ('completed','cancelled')) ot,
       lateral (select count(*) as n from public.bugs b where b.assigned_dev_id = pr.id and b.status not in ('closed','cancelled')) ob
  where p_project_id is null and v_staff and r.code = 'member_overloaded' and r.a and pr.is_active and ot.n + ob.n > coalesce(r.t, 8)
  ) q
  order by case q.s when 'critical' then 0 when 'warning' then 1 else 2 end, q.pcode nulls last;
end $$;

grant execute on function public.kpi_projects(), public.kpi_team(date, date), public.kpi_individual(date, date),
  public.smart_insights(uuid), public.trigger_kpi_snapshot(), public.project_waiting_days(uuid), public.can_view_kpi_all()
  to authenticated;
grant execute on all functions in schema public to service_role;
