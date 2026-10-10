-- =====================================================================
-- Phase 2 — QA & Workflow Control
--   Test Round · Bug · Developer Fix · Retest · Evidence Checklist (blocking)
--   Escalation notifications · Structured Recovery Plan · Baseline Revision approval
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.test_rounds (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  round_no      integer not null,
  activity_id   uuid references public.activities(id) on delete set null,
  title         text not null,
  test_type     text not null default 'system',
  tester_id     uuid references public.profiles(id),
  planned_date  date,
  due_date      date,
  actual_date   date,
  status        text not null default 'planned',
  result        text,
  total_cases   integer,
  passed_cases  integer,
  failed_cases  integer,
  summary       text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  constraint test_rounds_type_chk check (test_type in ('system','integration','regression','uat','smoke','performance','other')),
  constraint test_rounds_status_chk check (status in ('planned','in_progress','completed','cancelled')),
  constraint test_rounds_result_chk check (result is null or result in ('passed','failed','partially_passed','blocked')),
  constraint test_rounds_result_req check (status <> 'completed' or result is not null),
  unique (project_id, round_no)
);

create table public.bugs (
  id                   uuid primary key default gen_random_uuid(),
  bug_no               text not null,
  project_id           uuid not null references public.projects(id) on delete cascade,
  test_round_id        uuid references public.test_rounds(id) on delete set null,
  activity_id          uuid references public.activities(id) on delete set null,
  task_id              uuid references public.internal_tasks(id) on delete set null,
  title                text not null,
  description          text,
  steps_to_reproduce   text,
  expected_result      text,
  actual_result        text,
  severity             text not null default 'medium',
  priority             text not null default 'medium',
  reporter_id          uuid references public.profiles(id) default auth.uid(),
  assigned_dev_id      uuid references public.profiles(id),
  supervisor_id        uuid references public.profiles(id),
  due_date             date,
  status               text not null default 'new',
  root_cause           text,
  root_cause_category  text,
  reopen_count         integer not null default 0,
  closed_at            timestamptz,
  cancel_reason        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  constraint bugs_severity_chk check (severity in ('low','medium','high','critical')),
  constraint bugs_priority_chk check (priority in ('low','medium','high','critical')),
  constraint bugs_status_chk check (status in ('new','assigned','in_progress','fix_ready','retest','reopened','closed','cancelled')),
  unique (project_id, bug_no)
);

create table public.bug_fixes (
  id                uuid primary key default gen_random_uuid(),
  bug_id            uuid not null references public.bugs(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  fix_cycle         integer not null,
  fix_owner_id      uuid not null references public.profiles(id),
  fix_start_date    date not null default current_date,
  fix_due_date      date,
  fix_description   text,
  technical_note    text,
  unit_test_result  text,
  build_link        text,
  commit_link       text,
  fix_ready_at      timestamptz,
  status            text not null default 'in_progress',
  created_at        timestamptz not null default now(),
  constraint bug_fixes_status_chk check (status in ('in_progress','ready','verified','failed')),
  unique (bug_id, fix_cycle)
);

create table public.retests (
  id            uuid primary key default gen_random_uuid(),
  bug_id        uuid not null references public.bugs(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  fix_id        uuid references public.bug_fixes(id) on delete set null,
  retest_round  integer not null,
  tester_id     uuid references public.profiles(id),
  due_date      date,
  status        text not null default 'pending',
  result        text,
  comment       text,
  tested_at     timestamptz,
  created_at    timestamptz not null default now(),
  constraint retests_status_chk check (status in ('pending','done','cancelled')),
  constraint retests_result_chk check (result is null or result in ('passed','failed','partially_passed','blocked')),
  unique (bug_id, retest_round)
);

-- Evidence checklist (mandatory evidence per project / activity / task)
create table public.evidence_requirements (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  entity_type   text not null,
  entity_id     uuid not null,
  name          text not null,
  description   text,
  is_mandatory  boolean not null default true,
  source        text not null default 'manual',
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint evidence_requirements_entity_chk check (entity_type in ('project','activity','task')),
  constraint evidence_requirements_source_chk check (source in ('template','manual'))
);

-- Baseline revision (re-plan) requests — approved by Manager / Supervisor
create table public.baseline_revisions (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  from_version          integer not null,
  reason                text not null,
  impact                text,
  previous_target_date  date,
  proposed_target_date  date,
  plan_snapshot         jsonb not null default '[]'::jsonb,
  status                text not null default 'pending',
  requested_by          uuid references public.profiles(id) default auth.uid(),
  requested_at          timestamptz not null default now(),
  decided_by            uuid references public.profiles(id),
  decided_at            timestamptz,
  decision_comment      text,
  baseline_id           uuid references public.project_baselines(id),
  constraint baseline_revisions_status_chk check (status in ('pending','approved','rejected','cancelled'))
);
create unique index baseline_revisions_one_pending on public.baseline_revisions(project_id) where status = 'pending';

-- Evidence: bind to QA entities and to checklist items
alter table public.evidence drop constraint evidence_entity_chk;
alter table public.evidence add constraint evidence_entity_chk
  check (entity_type in ('request','project','activity','task','test_round','bug','fix','retest'));
alter table public.evidence add column requirement_id uuid references public.evidence_requirements(id) on delete set null;

-- Structured Recovery Plan (PRD §15)
alter table public.activities
  add column delay_impact          text,
  add column recovery_owner_id     uuid references public.profiles(id),
  add column recovery_due_date     date,
  add column recovery_reviewed_by  uuid references public.profiles(id),
  add column recovery_reviewed_at  timestamptz;

-- Escalation: after N days overdue also notify these roles
alter table public.notification_rules
  add column escalate_after_days integer,
  add column escalate_roles      text[] not null default array[]::text[];

create index test_rounds_project_idx on public.test_rounds(project_id, round_no);
create index bugs_project_idx on public.bugs(project_id, status);
create index bugs_dev_idx on public.bugs(assigned_dev_id, status);
create index bug_fixes_bug_idx on public.bug_fixes(bug_id, fix_cycle);
create index retests_bug_idx on public.retests(bug_id, retest_round);
create index retests_tester_idx on public.retests(tester_id, status);
create index evidence_req_entity_idx on public.evidence_requirements(entity_type, entity_id);
create index evidence_requirement_idx on public.evidence(requirement_id);

-- ---------------------------------------------------------------------
-- Touch / audit triggers for new tables
-- ---------------------------------------------------------------------
create trigger test_rounds_touch before update on public.test_rounds for each row execute function public.touch_updated();
create trigger bugs_touch before update on public.bugs for each row execute function public.touch_updated();

create trigger test_rounds_audit after insert or update or delete on public.test_rounds
  for each row execute function public.audit_changes('status','result','tester_id','due_date','actual_date','summary');
create trigger bugs_audit after insert or update or delete on public.bugs
  for each row execute function public.audit_changes('status','severity','priority','assigned_dev_id','due_date','root_cause','reopen_count');
create trigger bug_fixes_audit after insert or update on public.bug_fixes
  for each row execute function public.audit_changes('status','fix_owner_id','fix_due_date','fix_description','build_link','commit_link');
create trigger retests_audit after insert or update on public.retests
  for each row execute function public.audit_changes('status','result','tester_id','due_date');
create trigger evidence_requirements_audit after insert or delete on public.evidence_requirements
  for each row execute function public.audit_changes();
create trigger baseline_revisions_audit after insert or update on public.baseline_revisions
  for each row execute function public.audit_changes('status','decided_by','decision_comment');
-- recovery fields on activities
drop trigger activities_audit on public.activities;
create trigger activities_audit after insert or update or delete on public.activities
  for each row execute function public.audit_changes('name','status','pic_user_id','pic_label','plan_start','plan_finish','actual_start','actual_finish','forecast_finish','progress','delay_category','delay_reason','delay_impact','recovery_plan','recovery_owner_id','recovery_due_date','recovery_reviewed_by','next_action');

-- audit_changes reads (r->>'name') etc. — QA tables use title / bug_no
create or replace function public.audit_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_project uuid;
  v_request uuid;
  v_label text;
begin
  v_project := case when tg_table_name = 'projects' then (r->>'id')::uuid else (r->>'project_id')::uuid end;
  v_request := case when tg_table_name = 'project_requests' then (r->>'id')::uuid else (r->>'request_id')::uuid end;
  v_label := coalesce(r->>'bug_no' || ' ' || (r->>'title'), r->>'title', r->>'name', r->>'project_name', r->>'file_name', r->>'url',
                      r->>'member_role', r->>'version_no', 'cycle ' || (r->>'fix_cycle'), 'round ' || (r->>'retest_round'), r->>'reason');

  if tg_op = 'INSERT' then
    insert into public.audit_logs(table_name, entity_id, project_id, request_id, action, new_value)
    values (tg_table_name, (r->>'id')::uuid, v_project, v_request, 'insert', v_label);
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs(table_name, entity_id, project_id, request_id, action, old_value)
    values (tg_table_name, (r->>'id')::uuid, v_project, v_request, 'delete', v_label);
  else
    foreach f in array tg_argv loop
      if (o->f) is distinct from (n->f) then
        insert into public.audit_logs(table_name, entity_id, project_id, request_id, action, field, old_value, new_value)
        values (tg_table_name, (r->>'id')::uuid, v_project, v_request, 'update', f, o->>f, n->>f);
      end if;
    end loop;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------
create or replace function public.set_qa_numbers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'test_rounds' and new.round_no is null then
    select coalesce(max(round_no), 0) + 1 into new.round_no from public.test_rounds where project_id = new.project_id;
  end if;
  return new;
end $$;
alter table public.test_rounds alter column round_no drop not null;
create trigger test_rounds_no before insert on public.test_rounds for each row execute function public.set_qa_numbers();
alter table public.test_rounds alter column round_no set not null;

-- ---------------------------------------------------------------------
-- Guard: bug workflow fields only via RPC
-- ---------------------------------------------------------------------
create or replace function public.guard_bug_update()
returns trigger language plpgsql as $$
begin
  if public.wf_bypass() then return new; end if;
  if new.status is distinct from old.status or new.bug_no is distinct from old.bug_no
     or new.reopen_count is distinct from old.reopen_count or new.closed_at is distinct from old.closed_at
     or new.assigned_dev_id is distinct from old.assigned_dev_id or new.project_id is distinct from old.project_id then
    raise exception 'Bug status and assignment change only through the bug workflow actions';
  end if;
  return new;
end $$;
create trigger bugs_guard before update on public.bugs for each row execute function public.guard_bug_update();

-- ---------------------------------------------------------------------
-- Evidence checklist helpers
-- ---------------------------------------------------------------------
create or replace function public.missing_evidence(p_entity_type text, p_entity_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(r.name order by r.created_at), array[]::text[])
  from public.evidence_requirements r
  where r.entity_type = p_entity_type and r.entity_id = p_entity_id and r.is_mandatory
    and not exists (select 1 from public.evidence e where e.requirement_id = r.id and e.verification_status <> 'rejected');
$$;

create or replace function public.open_critical_bugs(p_project_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.bugs
  where project_id = p_project_id and severity = 'critical' and status not in ('closed','cancelled');
$$;

-- Completion blocking: mandatory evidence (Rule 6, FR-EVD-001) + critical bug blocks Go-live (milestone)
-- Direct user attempts raise an error; automatic roll-ups simply do not complete the item.
create or replace function public.activity_before_write()
returns trigger language plpgsql as $$
declare
  v_missing text[];
begin
  if tg_op = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    v_missing := public.missing_evidence('activity', new.id);
    if array_length(v_missing, 1) > 0 or (new.is_milestone and public.open_critical_bugs(new.project_id) > 0) then
      if pg_trigger_depth() > 1 then
        new.status := case when old.status in ('not_started','completed') then 'in_progress' else old.status end;
      elsif array_length(v_missing, 1) > 0 then
        raise exception 'Cannot complete "%": mandatory evidence missing — %', new.name, array_to_string(v_missing, ', ');
      else
        raise exception 'Cannot complete milestone "%": % critical bug(s) still open', new.name, public.open_critical_bugs(new.project_id);
      end if;
    end if;
  end if;

  if new.status = 'completed' then
    new.progress := 100;
    new.actual_finish := coalesce(new.actual_finish, current_date);
    new.actual_start := coalesce(new.actual_start, new.actual_finish);
  elsif new.progress > 0 or new.status = 'in_progress' then
    new.actual_start := coalesce(new.actual_start, current_date);
    if new.status = 'not_started' then new.status := 'in_progress'; end if;
  end if;
  if new.status <> 'completed' then new.actual_finish := null; end if;
  -- reviewing a recovery plan is reset when the plan text changes
  if tg_op = 'UPDATE' and new.recovery_plan is distinct from old.recovery_plan and new.recovery_reviewed_by is not distinct from old.recovery_reviewed_by then
    new.recovery_reviewed_by := null;
    new.recovery_reviewed_at := null;
  end if;
  return new;
end $$;

create or replace function public.task_before_write()
returns trigger language plpgsql as $$
declare
  v_missing text[];
begin
  if tg_op = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    v_missing := public.missing_evidence('task', new.id);
    if array_length(v_missing, 1) > 0 then
      if pg_trigger_depth() > 1 then
        new.status := 'review';
      else
        raise exception 'Cannot complete "%": mandatory evidence missing — %', new.name, array_to_string(v_missing, ', ');
      end if;
    end if;
  end if;

  if new.status = 'completed' then
    new.progress := 100;
    new.actual_finish := coalesce(new.actual_finish, current_date);
    new.actual_start := coalesce(new.actual_start, new.actual_finish);
  elsif new.status in ('in_progress','review') or new.progress > 0 then
    new.actual_start := coalesce(new.actual_start, current_date);
    if new.status = 'todo' then new.status := 'in_progress'; end if;
  end if;
  if new.status <> 'completed' then new.actual_finish := null; end if;
  if new.progress = 100 and new.status not in ('completed','cancelled') then new.status := 'review'; end if;
  return new;
end $$;

-- Project completion (Rule 11): all activities done + project-level evidence + no open critical bug
create or replace function public.guard_project_update()
returns trigger language plpgsql as $$
declare
  v_missing text[];
begin
  if public.wf_bypass() then return new; end if;
  if new.project_code is distinct from old.project_code
     or new.request_id is distinct from old.request_id
     or new.baseline_version is distinct from old.baseline_version then
    raise exception 'Project code, request reference and baseline version are system controlled';
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    if exists (select 1 from public.activities a
               where a.project_id = new.id and a.status not in ('completed','cancelled')) then
      raise exception 'All activities must be completed or cancelled before completing the project';
    end if;
    v_missing := public.missing_evidence('project', new.id);
    if array_length(v_missing, 1) > 0 then
      raise exception 'Mandatory project evidence missing: %', array_to_string(v_missing, ', ');
    end if;
    if public.open_critical_bugs(new.id) > 0 then
      raise exception '% critical bug(s) still open — close them before completing the project', public.open_critical_bugs(new.id);
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Notification engine with escalation (adds p_escalate)
-- ---------------------------------------------------------------------
drop function public.notify_event(text, uuid, uuid, uuid[], text, text, text, text);
create function public.notify_event(
  p_event       text,
  p_project_id  uuid,
  p_request_id  uuid,
  p_explicit    uuid[],
  p_title       text,
  p_body        text,
  p_link        text,
  p_dedupe      text default null,
  p_escalate    boolean default false
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_rule  public.notification_rules;
  v_roles text[];
  v_users uuid[];
  v_uid   uuid;
  v_nid   uuid;
  v_cnt   integer := 0;
begin
  select * into v_rule from public.notification_rules where event_code = p_event;
  if not found then
    v_rule.recipient_roles := array['explicit'];
    v_rule.channels := array['in_app'];
    v_rule.is_active := true;
    v_rule.escalate_roles := array[]::text[];
  end if;
  if not v_rule.is_active then return 0; end if;

  v_roles := v_rule.recipient_roles || case when p_escalate then coalesce(v_rule.escalate_roles, array[]::text[]) else array[]::text[] end;
  v_users := case when 'explicit' = any(v_roles) then coalesce(p_explicit, array[]::uuid[]) else array[]::uuid[] end;

  if p_project_id is not null then
    v_users := v_users || coalesce((
      select array_agg(distinct m.user_id) from public.project_members m
      where m.project_id = p_project_id and m.notify and m.member_role = any(v_roles)), array[]::uuid[]);
    if 'leader' = any(v_roles) then
      v_users := v_users || coalesce((select array[leader_id] from public.projects where id = p_project_id and leader_id is not null), array[]::uuid[]);
    end if;
  end if;

  for v_uid in select distinct u from unnest(v_users) u where u is not null loop
    insert into public.notifications(user_id, event_code, project_id, request_id, title, body, link, dedupe_key)
    values (v_uid, p_event, p_project_id, p_request_id,
            case when p_escalate then '⚠ ESCALATION — ' || p_title else p_title end, p_body, p_link, p_dedupe)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
    returning id into v_nid;

    if v_nid is not null then
      v_cnt := v_cnt + 1;
      if 'email' = any(v_rule.channels) then
        insert into public.email_outbox(notification_id, to_email, subject, body)
        select v_nid, p.email, '[Project Control] ' || case when p_escalate then 'ESCALATION — ' else '' end || p_title,
               coalesce(p_body, '') || E'\n\n' || coalesce(p_link, '')
        from public.profiles p where p.id = v_uid and p.email is not null;
      end if;
    end if;
    v_nid := null;
  end loop;
  return v_cnt;
end $$;
revoke execute on function public.notify_event(text, uuid, uuid, uuid[], text, text, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Bug workflow RPCs
-- ---------------------------------------------------------------------
create or replace function public.bug_sla_days(p_severity text)
returns integer language sql immutable as $$
  select case p_severity when 'critical' then 1 when 'high' then 3 when 'medium' then 5 else 10 end;
$$;

create or replace function public.bug_link(b public.bugs)
returns text language sql stable as $$
  select format('/projects/%s?tab=qa&bug=%s', b.project_id, b.id);
$$;

create or replace function public.can_qa(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('qa') or public.can_manage_project(p_project_id)
      or public.is_project_member(p_project_id, array['qa','leader']);
$$;

create or replace function public.can_triage_bug(b public.bugs)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_project(b.project_id) or b.reporter_id = auth.uid()
      or public.has_role('supervisor') or public.has_role('manager')
      or public.is_project_member(b.project_id, array['qa','supervisor','manager']);
$$;

create or replace function public.report_bug(
  p_project_id uuid, p_title text, p_description text, p_severity text, p_priority text,
  p_test_round_id uuid default null, p_activity_id uuid default null, p_task_id uuid default null,
  p_steps text default null, p_expected text default null, p_actual text default null,
  p_assigned_dev_id uuid default null, p_due_date date default null
) returns public.bugs language plpgsql security definer set search_path = public as $$
declare
  b public.bugs;
  v_code text;
  v_sup uuid;
begin
  if not public.can_view_internal(p_project_id) then raise exception 'Not allowed to report bugs in this project'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Bug title is required'; end if;
  select project_code into v_code from public.projects where id = p_project_id;
  select user_id into v_sup from public.project_members where project_id = p_project_id and member_role = 'supervisor' order by created_at limit 1;

  perform public.wf_bypass_on();
  insert into public.bugs(bug_no, project_id, test_round_id, activity_id, task_id, title, description, steps_to_reproduce,
                          expected_result, actual_result, severity, priority, reporter_id, assigned_dev_id, supervisor_id, due_date, status)
  values ('BUG-' || lpad(public.next_sequence('bug:' || p_project_id::text)::text, 4, '0'),
          p_project_id, p_test_round_id,
          coalesce(p_activity_id, (select activity_id from public.test_rounds where id = p_test_round_id)),
          p_task_id, trim(p_title), p_description, p_steps, p_expected, p_actual,
          coalesce(p_severity, 'medium'), coalesce(p_priority, p_severity, 'medium'), auth.uid(), p_assigned_dev_id, v_sup,
          coalesce(p_due_date, current_date + public.bug_sla_days(coalesce(p_severity, 'medium'))),
          case when p_assigned_dev_id is null then 'new' else 'assigned' end)
  returning * into b;

  perform public.notify_event('bug_reported', b.project_id, null, array[b.assigned_dev_id, b.supervisor_id],
    format('Bug reported: %s %s [%s]', b.bug_no, b.title, upper(b.severity)),
    format('Project %s — due %s', v_code, to_char(b.due_date, 'DD Mon YYYY')),
    public.bug_link(b), format('bug_reported:%s', b.id));
  perform public.recompute_project(b.project_id);
  return b;
end $$;

create or replace function public.assign_bug(p_bug_id uuid, p_dev_id uuid, p_due_date date default null)
returns public.bugs language plpgsql security definer set search_path = public as $$
declare b public.bugs;
begin
  select * into b from public.bugs where id = p_bug_id for update;
  if not found then raise exception 'Bug not found'; end if;
  if not public.can_triage_bug(b) then raise exception 'Only QA, the Project Leader or Supervisor can assign bugs'; end if;
  if b.status in ('closed','cancelled') then raise exception 'Bug % is %', b.bug_no, b.status; end if;
  if p_dev_id is null then raise exception 'Choose a developer'; end if;
  perform public.wf_bypass_on();
  update public.bugs set assigned_dev_id = p_dev_id,
    due_date = coalesce(p_due_date, due_date),
    status = case when status in ('new') then 'assigned' else status end
  where id = b.id returning * into b;
  update public.bug_fixes set fix_owner_id = p_dev_id where bug_id = b.id and status = 'in_progress';
  perform public.notify_event('bug_assigned', b.project_id, null, array[p_dev_id],
    format('Bug assigned to you: %s %s [%s]', b.bug_no, b.title, upper(b.severity)),
    format('Fix due %s', to_char(b.due_date, 'DD Mon YYYY')), public.bug_link(b),
    format('bug_assigned:%s:%s', b.id, p_dev_id));
  return b;
end $$;

create or replace function public.start_fix(p_bug_id uuid)
returns public.bug_fixes language plpgsql security definer set search_path = public as $$
declare
  b public.bugs;
  f public.bug_fixes;
begin
  select * into b from public.bugs where id = p_bug_id for update;
  if not found then raise exception 'Bug not found'; end if;
  if not (b.assigned_dev_id = auth.uid() or public.can_manage_project(b.project_id)) then
    raise exception 'Only the assigned developer can start the fix';
  end if;
  if b.assigned_dev_id is null then raise exception 'Assign a developer first'; end if;
  if b.status not in ('assigned','reopened','new') then raise exception 'Fix cannot start from status %', b.status; end if;
  perform public.wf_bypass_on();
  insert into public.bug_fixes(bug_id, project_id, fix_cycle, fix_owner_id, fix_due_date)
  values (b.id, b.project_id, coalesce((select max(fix_cycle) from public.bug_fixes where bug_id = b.id), 0) + 1,
          b.assigned_dev_id, b.due_date)
  returning * into f;
  update public.bugs set status = 'in_progress' where id = b.id;
  return f;
end $$;

-- Developer: Fix Ready → creates a Retest and notifies QA / Tester (Rule 8, AC-013)
create or replace function public.mark_fix_ready(
  p_fix_id uuid, p_description text, p_unit_test_result text default null, p_technical_note text default null,
  p_build_link text default null, p_commit_link text default null, p_tester_id uuid default null
) returns public.retests language plpgsql security definer set search_path = public as $$
declare
  f public.bug_fixes;
  b public.bugs;
  t public.retests;
  v_tester uuid;
begin
  select * into f from public.bug_fixes where id = p_fix_id for update;
  if not found then raise exception 'Fix not found'; end if;
  select * into b from public.bugs where id = f.bug_id for update;
  if not (f.fix_owner_id = auth.uid() or b.assigned_dev_id = auth.uid() or public.can_manage_project(b.project_id)) then
    raise exception 'Only the fix owner can mark Fix Ready';
  end if;
  if f.status <> 'in_progress' or b.status <> 'in_progress' then raise exception 'Fix is not in progress'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Describe the fix before marking Fix Ready'; end if;

  v_tester := coalesce(p_tester_id,
    (select reporter_id from public.bugs bb join public.profiles pr on pr.id = bb.reporter_id where bb.id = b.id and 'qa' = any(pr.roles)),
    (select user_id from public.project_members where project_id = b.project_id and member_role = 'qa' order by created_at limit 1),
    b.reporter_id);

  perform public.wf_bypass_on();
  update public.bug_fixes set status = 'ready', fix_ready_at = now(), fix_description = p_description,
    unit_test_result = coalesce(p_unit_test_result, unit_test_result), technical_note = coalesce(p_technical_note, technical_note),
    build_link = coalesce(p_build_link, build_link), commit_link = coalesce(p_commit_link, commit_link)
  where id = f.id;
  update public.bugs set status = 'fix_ready' where id = b.id;
  insert into public.retests(bug_id, project_id, fix_id, retest_round, tester_id, due_date)
  values (b.id, b.project_id, f.id, coalesce((select max(retest_round) from public.retests where bug_id = b.id), 0) + 1,
          v_tester, current_date + 2)
  returning * into t;

  perform public.notify_event('fix_ready', b.project_id, null, array[v_tester],
    format('Fix ready for retest: %s %s', b.bug_no, b.title),
    format('Fix cycle %s — retest due %s', f.fix_cycle, to_char(t.due_date, 'DD Mon YYYY')),
    public.bug_link(b), format('fix_ready:%s', f.id));
  return t;
end $$;

-- QA: Retest → Passed closes the bug (Rule 7); otherwise Reopen (AC-014)
create or replace function public.record_retest(p_retest_id uuid, p_result text, p_comment text default null)
returns public.bugs language plpgsql security definer set search_path = public as $$
declare
  t public.retests;
  b public.bugs;
begin
  select * into t from public.retests where id = p_retest_id for update;
  if not found then raise exception 'Retest not found'; end if;
  select * into b from public.bugs where id = t.bug_id for update;
  if not (t.tester_id = auth.uid() or public.can_qa(b.project_id)) then raise exception 'Only QA / Tester can record a retest'; end if;
  if t.status <> 'pending' then raise exception 'Retest already recorded'; end if;
  if p_result not in ('passed','failed','partially_passed','blocked') then raise exception 'Invalid result %', p_result; end if;
  if p_result <> 'passed' and coalesce(trim(p_comment), '') = '' then raise exception 'A comment is required when the retest does not pass'; end if;

  perform public.wf_bypass_on();
  update public.retests set status = 'done', result = p_result, comment = p_comment, tested_at = now(),
    tester_id = coalesce(tester_id, auth.uid())
  where id = t.id;

  if p_result = 'passed' then
    update public.bug_fixes set status = 'verified' where id = t.fix_id;
    update public.bugs set status = 'closed', closed_at = now() where id = b.id returning * into b;
    perform public.notify_event('bug_closed', b.project_id, null, array[b.assigned_dev_id, b.reporter_id],
      format('Bug closed: %s %s', b.bug_no, b.title), 'Retest passed', public.bug_link(b), format('bug_closed:%s', b.id));
  else
    update public.bug_fixes set status = 'failed' where id = t.fix_id;
    update public.bugs set status = 'reopened', reopen_count = reopen_count + 1,
      due_date = greatest(coalesce(due_date, current_date), current_date) + public.bug_sla_days(severity)
    where id = b.id returning * into b;
    perform public.notify_event('retest_failed', b.project_id, null, array[b.assigned_dev_id],
      format('Retest %s — bug reopened: %s %s', replace(p_result, '_', ' '), b.bug_no, b.title),
      p_comment, public.bug_link(b), format('retest_failed:%s', t.id));
  end if;
  perform public.recompute_project(b.project_id);
  return b;
end $$;

create or replace function public.cancel_bug(p_bug_id uuid, p_reason text)
returns public.bugs language plpgsql security definer set search_path = public as $$
declare b public.bugs;
begin
  select * into b from public.bugs where id = p_bug_id for update;
  if not public.can_triage_bug(b) then raise exception 'Not allowed'; end if;
  if b.status in ('closed','cancelled') then raise exception 'Bug is already %', b.status; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform public.wf_bypass_on();
  update public.retests set status = 'cancelled' where bug_id = b.id and status = 'pending';
  update public.bug_fixes set status = 'failed' where bug_id = b.id and status in ('in_progress','ready');
  update public.bugs set status = 'cancelled', cancel_reason = p_reason, closed_at = now() where id = b.id returning * into b;
  perform public.recompute_project(b.project_id);
  return b;
end $$;

-- ---------------------------------------------------------------------
-- Baseline: V1 by leader; V2+ only via approved revision
-- ---------------------------------------------------------------------
create or replace function public.freeze_baseline(p_project_id uuid, p_reason text, p_approved_by uuid)
returns public.project_baselines language plpgsql security definer set search_path = public as $$
declare
  p   public.projects;
  b   public.project_baselines;
  v_n integer;
begin
  select * into p from public.projects where id = p_project_id for update;
  if not exists (select 1 from public.activities where project_id = p_project_id and status <> 'cancelled') then
    raise exception 'Add at least one activity before setting a baseline';
  end if;
  if exists (select 1 from public.activities where project_id = p_project_id and status <> 'cancelled'
             and (plan_start is null or plan_finish is null)) then
    raise exception 'All activities need Plan Start and Plan Finish before setting a baseline';
  end if;
  v_n := p.baseline_version + 1;

  perform public.wf_bypass_on();
  insert into public.project_baselines(project_id, version_no, planned_start, planned_finish, target_date, reason, approved_by)
  select p_project_id, v_n, min(plan_start), max(plan_finish), p.target_date,
         coalesce(nullif(trim(p_reason), ''), 'Initial baseline'), p_approved_by
  from public.activities where project_id = p_project_id and status <> 'cancelled'
  returning * into b;

  insert into public.project_baseline_items(baseline_id, activity_id, seq, activity_name, pic, planned_start, planned_finish, is_milestone)
  select b.id, a.id, a.seq, a.name, coalesce(pr.full_name, a.pic_label), a.plan_start, a.plan_finish, a.is_milestone
  from public.activities a left join public.profiles pr on pr.id = a.pic_user_id
  where a.project_id = p_project_id and a.status <> 'cancelled';

  update public.projects set
    baseline_version = v_n,
    status = case when status in ('draft','planning') then 'in_progress' else status end,
    next_action = case when v_n = 1 and next_action = 'Prepare project plan and set Baseline V1' then 'Execute plan' else next_action end
  where id = p_project_id;

  perform public.notify_event('baseline_set', p_project_id, null, null,
    format('Baseline V%s set: %s', v_n, p.project_code),
    format('Planned finish %s', to_char(b.planned_finish, 'DD Mon YYYY')),
    format('/projects/%s?tab=baseline', p_project_id), format('baseline:%s', b.id));

  perform public.recompute_project(p_project_id);
  return b;
end $$;
revoke execute on function public.freeze_baseline(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.create_baseline(p_project_id uuid, p_reason text default null)
returns public.project_baselines language plpgsql security definer set search_path = public as $$
declare p public.projects;
begin
  select * into p from public.projects where id = p_project_id;
  if not public.can_manage_project(p_project_id) then raise exception 'Only the Project Leader can manage the baseline'; end if;
  if p.baseline_version > 0 then
    raise exception 'Baseline V% already exists — submit a Baseline Revision request for approval', p.baseline_version;
  end if;
  return public.freeze_baseline(p_project_id, p_reason, null);
end $$;

create or replace function public.can_approve_baseline(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('manager') or public.has_role('supervisor')
      or public.is_project_member(p_project_id, array['manager','supervisor']);
$$;

create or replace function public.request_baseline_revision(p_project_id uuid, p_reason text, p_impact text, p_new_target date)
returns public.baseline_revisions language plpgsql security definer set search_path = public as $$
declare
  p  public.projects;
  r  public.baseline_revisions;
  v_approvers uuid[];
begin
  select * into p from public.projects where id = p_project_id;
  if not public.can_manage_project(p_project_id) then raise exception 'Only the Project Leader can request a baseline revision'; end if;
  if p.baseline_version = 0 then raise exception 'Set Baseline V1 first'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required (Rule 14)'; end if;
  if exists (select 1 from public.baseline_revisions where project_id = p_project_id and status = 'pending') then
    raise exception 'A baseline revision is already waiting for approval';
  end if;
  insert into public.baseline_revisions(project_id, from_version, reason, impact, previous_target_date, proposed_target_date, plan_snapshot)
  values (p_project_id, p.baseline_version, trim(p_reason), p_impact, p.target_date, coalesce(p_new_target, p.target_date),
          (select coalesce(jsonb_agg(jsonb_build_object('activity_id', a.id, 'name', a.name, 'plan_start', a.plan_start, 'plan_finish', a.plan_finish) order by a.seq), '[]'::jsonb)
             from public.activities a where a.project_id = p_project_id and a.status <> 'cancelled'))
  returning * into r;

  select array_agg(distinct id) into v_approvers from public.profiles where is_active and roles && array['manager'];
  perform public.notify_event('baseline_revision_requested', p_project_id, null, v_approvers,
    format('Baseline revision requested: %s V%s → V%s', p.project_code, p.baseline_version, p.baseline_version + 1),
    format('Reason: %s', p_reason), format('/projects/%s?tab=baseline', p_project_id), format('baseline_rev:%s', r.id));
  return r;
end $$;

create or replace function public.decide_baseline_revision(p_revision_id uuid, p_approve boolean, p_comment text default null)
returns public.baseline_revisions language plpgsql security definer set search_path = public as $$
declare
  r public.baseline_revisions;
  p public.projects;
  b public.project_baselines;
begin
  select * into r from public.baseline_revisions where id = p_revision_id for update;
  if not found then raise exception 'Revision request not found'; end if;
  if r.status <> 'pending' then raise exception 'Request is already %', r.status; end if;
  if not public.can_approve_baseline(r.project_id) then raise exception 'Only a Manager / Supervisor can approve baseline revisions'; end if;
  if r.requested_by = auth.uid() and not public.has_role('admin') then raise exception 'You cannot approve your own request'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'A comment is required to reject'; end if;
  select * into p from public.projects where id = r.project_id;

  if p_approve then
    perform public.wf_bypass_on();
    if r.proposed_target_date is not null and r.proposed_target_date is distinct from p.target_date then
      update public.projects set target_date = r.proposed_target_date where id = r.project_id;
    end if;
    b := public.freeze_baseline(r.project_id, r.reason, auth.uid());
    update public.baseline_revisions set status = 'approved', decided_by = auth.uid(), decided_at = now(),
      decision_comment = p_comment, baseline_id = b.id where id = r.id returning * into r;
  else
    update public.baseline_revisions set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_comment = p_comment where id = r.id returning * into r;
  end if;
  perform public.notify_event('baseline_revision_decided', r.project_id, null, array[r.requested_by],
    format('Baseline revision %s: %s', r.status, p.project_code), coalesce(p_comment, ''),
    format('/projects/%s?tab=baseline', r.project_id), format('baseline_rev_decided:%s', r.id));
  return r;
end $$;

create or replace function public.cancel_baseline_revision(p_revision_id uuid)
returns public.baseline_revisions language plpgsql security definer set search_path = public as $$
declare r public.baseline_revisions;
begin
  select * into r from public.baseline_revisions where id = p_revision_id for update;
  if r.status <> 'pending' then raise exception 'Request is already %', r.status; end if;
  if not (r.requested_by = auth.uid() or public.can_manage_project(r.project_id)) then raise exception 'Not allowed'; end if;
  update public.baseline_revisions set status = 'cancelled' where id = r.id returning * into r;
  return r;
end $$;

-- Supervisor / Manager reviews a Recovery Plan
create or replace function public.review_recovery_plan(p_activity_id uuid)
returns public.activities language plpgsql security definer set search_path = public as $$
declare a public.activities;
begin
  select * into a from public.activities where id = p_activity_id for update;
  if not public.can_approve_baseline(a.project_id) then raise exception 'Only a Supervisor / Manager can review recovery plans'; end if;
  if coalesce(trim(a.recovery_plan), '') = '' then raise exception 'There is no recovery plan to review'; end if;
  update public.activities set recovery_reviewed_by = auth.uid(), recovery_reviewed_at = now() where id = a.id returning * into a;
  return a;
end $$;

-- ---------------------------------------------------------------------
-- Convert: also create evidence checklist from the template
--   checklist item: "name" (project level) or {"name","activity","mandatory"}
-- ---------------------------------------------------------------------
create or replace function public.apply_template_checklist(p_project_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_name text;
  v_act  uuid;
  v_cnt  integer := 0;
begin
  for v_item in
    select x from public.projects p join public.project_templates t on t.id = p.template_id,
         jsonb_array_elements(t.evidence_checklist) x
    where p.id = p_project_id
  loop
    v_name := case when jsonb_typeof(v_item) = 'string' then v_item #>> '{}' else v_item->>'name' end;
    v_act := null;
    if jsonb_typeof(v_item) = 'object' and v_item ? 'activity' then
      select id into v_act from public.activities where project_id = p_project_id and lower(name) = lower(v_item->>'activity') limit 1;
    end if;
    insert into public.evidence_requirements(project_id, entity_type, entity_id, name, is_mandatory, source)
    values (p_project_id, case when v_act is null then 'project' else 'activity' end, coalesce(v_act, p_project_id),
            v_name, coalesce((v_item->>'mandatory')::boolean, true), 'template');
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end $$;
revoke execute on function public.apply_template_checklist(uuid) from public, anon, authenticated;

-- Hook: when the first activity rows exist, convert calls this through the request status change
create or replace function public.on_request_converted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'converted' and old.status is distinct from 'converted' and new.project_id is not null then
    perform public.apply_template_checklist(new.project_id);
  end if;
  return null;
end $$;
create trigger project_requests_converted after update of status on public.project_requests
  for each row execute function public.on_request_converted();

-- ---------------------------------------------------------------------
-- Health: open critical bug → red; open high bug / retest overdue / evidence missing → yellow
-- ---------------------------------------------------------------------
create or replace function public.project_qa_stats(p_project_id uuid)
returns table(open_bugs int, critical_bugs int, high_bugs int, retest_pending int, retest_overdue int, fix_overdue int, evidence_missing int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.bugs where project_id = p_project_id and status not in ('closed','cancelled')),
    (select count(*)::int from public.bugs where project_id = p_project_id and severity = 'critical' and status not in ('closed','cancelled')),
    (select count(*)::int from public.bugs where project_id = p_project_id and severity = 'high' and status not in ('closed','cancelled')),
    (select count(*)::int from public.retests where project_id = p_project_id and status = 'pending'),
    (select count(*)::int from public.retests where project_id = p_project_id and status = 'pending' and due_date < current_date),
    (select count(*)::int from public.bugs where project_id = p_project_id and status in ('assigned','in_progress','reopened') and due_date < current_date),
    (select count(*)::int from public.evidence_requirements r
      left join public.activities a on r.entity_type = 'activity' and a.id = r.entity_id
      left join public.internal_tasks t on r.entity_type = 'task' and t.id = r.entity_id
      where r.project_id = p_project_id and r.is_mandatory
        and not exists (select 1 from public.evidence e where e.requirement_id = r.id and e.verification_status <> 'rejected')
        and (r.entity_type = 'project'
             or (a.id is not null and (a.progress >= 100 or a.plan_finish < current_date) and a.status <> 'cancelled')
             or (t.id is not null and (t.progress >= 100 or t.due_date < current_date) and t.status <> 'cancelled')));
$$;

create or replace function public.recompute_project(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p          public.projects;
  v_progress   numeric;
  v_forecast   date;
  v_base_fin   date;
  v_overdue_a  integer;
  v_no_recov   integer;
  v_overdue_t  integer;
  v_variance   integer;
  v_health     text;
  v_status     text;
  q            record;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found then return; end if;

  select
    coalesce(sum(a.progress * greatest(coalesce(a.plan_finish - a.plan_start + 1, 1), 1))
             / nullif(sum(greatest(coalesce(a.plan_finish - a.plan_start + 1, 1), 1)), 0), 0),
    max(public.activity_forecast(a)),
    count(*) filter (where public.activity_is_overdue(a)),
    count(*) filter (where public.activity_is_overdue(a) and coalesce(trim(a.recovery_plan), '') = '')
  into v_progress, v_forecast, v_overdue_a, v_no_recov
  from public.activities a
  where a.project_id = p_project_id and a.status <> 'cancelled';

  select count(*) into v_overdue_t from public.internal_tasks t
  where t.project_id = p_project_id and t.due_date < current_date and t.status not in ('completed','cancelled');

  select * into q from public.project_qa_stats(p_project_id);

  select planned_finish into v_base_fin from public.project_baselines
  where project_id = p_project_id order by version_no desc limit 1;

  v_variance := coalesce(v_forecast - coalesce(v_base_fin, v_p.target_date), 0);

  if v_p.status in ('completed','cancelled') then
    v_health := case when v_p.status = 'completed' and v_variance > 0 then 'yellow' else 'green' end;
  elsif v_no_recov > 0 or v_variance > 7 or q.critical_bugs > 0
        or (v_p.target_date is not null and v_p.target_date < current_date) then
    v_health := 'red';
  elsif v_overdue_a > 0 or v_overdue_t > 0 or v_variance > 0 or q.high_bugs > 0 or q.retest_overdue > 0
        or q.fix_overdue > 0 or q.evidence_missing > 0
        or v_p.status in ('waiting','on_hold','at_risk')
        or coalesce(trim(v_p.next_action), '') = '' then
    v_health := 'yellow';
  else
    v_health := 'green';
  end if;

  v_status := v_p.status;
  if v_p.status in ('in_progress','at_risk','delayed') then
    v_status := case
      when v_overdue_a > 0 or v_variance > 0 then 'delayed'
      when v_health = 'yellow' and (v_overdue_t > 0 or q.fix_overdue > 0) then 'at_risk'
      when q.critical_bugs > 0 then 'at_risk'
      else 'in_progress' end;
  end if;

  perform public.wf_bypass_on();
  update public.projects set
    progress = round(least(greatest(v_progress, 0), 100), 2),
    forecast_date = v_forecast,
    health = v_health,
    status = v_status
  where id = p_project_id
    and (progress, forecast_date, health, status) is distinct from
        (round(least(greatest(v_progress, 0), 100), 2), v_forecast, v_health, v_status);
end $$;

-- Evidence changes affect checklist / health
create or replace function public.on_evidence_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.project_id is not null and pg_trigger_depth() <= 8 then perform public.recompute_project(r.project_id); end if;
  return null;
end $$;
create trigger evidence_recompute after insert or update of verification_status, requirement_id or delete on public.evidence
  for each row execute function public.on_evidence_change();

-- ---------------------------------------------------------------------
-- Scheduled scan: + fix due / fix overdue (escalation) / retest due / evidence missing
-- ---------------------------------------------------------------------
create or replace function public.run_notification_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t   record;
  a   record;
  v_rule public.notification_rules;
  v_esc integer;
  v_after integer;
  v_due integer := 0;
  v_over integer := 0;
  v_delay integer := 0;
  v_fix integer := 0;
  v_ret integer := 0;
  v_evd integer := 0;
  v_pid uuid;
begin
  -- Task due tomorrow → Owner (+ roles per rule)
  for t in
    select it.*, p.project_code from public.internal_tasks it join public.projects p on p.id = it.project_id
    where it.due_date = current_date + 1 and it.status not in ('completed','cancelled')
      and p.status not in ('completed','cancelled','on_hold')
  loop
    v_due := v_due + public.notify_event('task_due_tomorrow', t.project_id, null, array[t.owner_id],
      format('Due tomorrow: %s %s', t.task_no, t.name), format('Project %s', t.project_code),
      format('/projects/%s?tab=internal&task=%s', t.project_id, t.id),
      format('task_due_tomorrow:%s:%s', t.id, t.due_date));
  end loop;

  -- Task overdue → repeat every escalation_days; escalate after N days
  select * into v_rule from public.notification_rules where event_code = 'task_overdue';
  v_esc := greatest(coalesce(v_rule.escalation_days, 1), 1);
  v_after := coalesce(v_rule.escalate_after_days, 999999);
  for t in
    select it.*, p.project_code, (current_date - it.due_date) as days_over
    from public.internal_tasks it join public.projects p on p.id = it.project_id
    where it.due_date < current_date and it.status not in ('completed','cancelled')
      and p.status not in ('completed','cancelled','on_hold')
  loop
    v_over := v_over + public.notify_event('task_overdue', t.project_id, null, array[t.owner_id],
      format('Overdue %s day(s): %s %s', t.days_over, t.task_no, t.name), format('Project %s — due %s', t.project_code, to_char(t.due_date, 'DD Mon YYYY')),
      format('/projects/%s?tab=internal&task=%s', t.project_id, t.id),
      format('task_overdue:%s:%s', t.id, (t.days_over - 1) / v_esc), t.days_over >= v_after);
  end loop;

  -- Fix due tomorrow → Developer (+ Supervisor)
  for t in
    select b.*, p.project_code from public.bugs b join public.projects p on p.id = b.project_id
    where b.due_date = current_date + 1 and b.status in ('assigned','in_progress','reopened')
  loop
    v_fix := v_fix + public.notify_event('fix_due_tomorrow', t.project_id, null, array[t.assigned_dev_id, t.supervisor_id],
      format('Fix due tomorrow: %s %s [%s]', t.bug_no, t.title, upper(t.severity)), format('Project %s', t.project_code),
      format('/projects/%s?tab=qa&bug=%s', t.project_id, t.id), format('fix_due_tomorrow:%s:%s', t.id, t.due_date));
  end loop;

  -- Fix overdue → repeat by escalation rule; escalate to Manager after N days
  select * into v_rule from public.notification_rules where event_code = 'fix_overdue';
  v_esc := greatest(coalesce(v_rule.escalation_days, 1), 1);
  v_after := coalesce(v_rule.escalate_after_days, 999999);
  for t in
    select b.*, p.project_code, (current_date - b.due_date) as days_over
    from public.bugs b join public.projects p on p.id = b.project_id
    where b.due_date < current_date and b.status in ('assigned','in_progress','reopened')
  loop
    v_fix := v_fix + public.notify_event('fix_overdue', t.project_id, null, array[t.assigned_dev_id, t.supervisor_id],
      format('Fix overdue %s day(s): %s %s [%s]', t.days_over, t.bug_no, t.title, upper(t.severity)),
      format('Project %s — fix was due %s', t.project_code, to_char(t.due_date, 'DD Mon YYYY')),
      format('/projects/%s?tab=qa&bug=%s', t.project_id, t.id),
      format('fix_overdue:%s:%s', t.id, (t.days_over - 1) / v_esc), t.days_over >= v_after);
  end loop;

  -- Retest due (tomorrow / overdue) → Tester
  for t in
    select r.*, b.bug_no, b.title, p.project_code from public.retests r
    join public.bugs b on b.id = r.bug_id join public.projects p on p.id = r.project_id
    where r.status = 'pending' and r.due_date <= current_date + 1
  loop
    v_ret := v_ret + public.notify_event('retest_due', t.project_id, null, array[t.tester_id],
      format('Retest %s: %s %s', case when t.due_date < current_date then 'overdue' else 'due' end, t.bug_no, t.title),
      format('Project %s — due %s', t.project_code, to_char(t.due_date, 'DD Mon YYYY')),
      format('/projects/%s?tab=qa&bug=%s', t.project_id, t.bug_id), format('retest_due:%s:%s', t.id, current_date));
  end loop;

  -- Evidence missing → Owner / PIC (activity due within 2 days or done-but-blocked)
  for t in
    select r.*, coalesce(ea.pic_user_id, et.owner_id, ep.leader_id) as owner,
           coalesce(ea.name, et.name, ep.project_name) as item, ep.project_code
    from public.evidence_requirements r
    join public.projects ep on ep.id = r.project_id
    left join public.activities ea on r.entity_type = 'activity' and ea.id = r.entity_id
    left join public.internal_tasks et on r.entity_type = 'task' and et.id = r.entity_id
    where r.is_mandatory and ep.status not in ('completed','cancelled','planning','draft')
      and not exists (select 1 from public.evidence e where e.requirement_id = r.id and e.verification_status <> 'rejected')
      and ((ea.id is not null and ea.status <> 'cancelled' and (ea.plan_finish <= current_date + 2 or ea.progress >= 100))
        or (et.id is not null and et.status <> 'cancelled' and (et.due_date <= current_date + 2 or et.progress >= 100)))
  loop
    v_evd := v_evd + public.notify_event('evidence_missing', t.project_id, null, array[t.owner],
      format('Evidence missing: %s — %s', t.name, t.item), format('Project %s', t.project_code),
      format('/projects/%s?tab=evidence', t.project_id), format('evidence_missing:%s:%s', t.id, (current_date - date '2026-01-01') / 3));
  end loop;

  -- Overdue activities become Delayed (triggers activity_delayed notification)
  perform public.wf_bypass_on();
  for a in
    select ac.id from public.activities ac join public.projects p on p.id = ac.project_id
    where public.activity_is_overdue(ac) and ac.status in ('not_started','in_progress','at_risk')
      and p.status not in ('completed','cancelled','on_hold','planning','draft')
  loop
    update public.activities set status = 'delayed' where id = a.id;
    v_delay := v_delay + 1;
  end loop;

  for v_pid in select id from public.projects where status not in ('completed','cancelled') loop
    perform public.recompute_project(v_pid);
  end loop;

  return jsonb_build_object('due_tomorrow', v_due, 'overdue', v_over, 'activities_delayed', v_delay,
                            'fix', v_fix, 'retest', v_ret, 'evidence_missing', v_evd, 'ran_at', now());
end $$;
revoke execute on function public.run_notification_scan() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- v_projects: + QA / evidence attention
-- ---------------------------------------------------------------------
drop view public.v_projects;
create view public.v_projects with (security_invoker = true) as
select
  p.*,
  pt.code  as project_type_code,
  pt.name  as project_type_name,
  l.full_name as leader_name,
  r.request_no,
  r.req_department as requestor_department,
  bl.planned_finish as baseline_finish,
  case when bl.planned_finish is not null and p.forecast_date is not null
       then p.forecast_date - bl.planned_finish end as schedule_variance,
  coalesce(ac.overdue_activities, 0) as overdue_activities,
  coalesce(ac.delayed_without_recovery, 0) as delayed_without_recovery,
  coalesce(ac.activity_count, 0) as activity_count,
  qs.open_bugs, qs.critical_bugs, qs.retest_pending, qs.retest_overdue, qs.fix_overdue, qs.evidence_missing,
  (select count(*)::int from public.baseline_revisions br where br.project_id = p.id and br.status = 'pending') as pending_revisions,
  array_remove(array[
    case when p.leader_id is null then 'No Project Leader' end,
    case when p.target_date is null then 'No target date' end,
    case when coalesce(trim(p.next_action), '') = '' then 'No next action' end,
    case when p.status not in ('completed','cancelled') and p.target_date < current_date then 'Target date passed' end,
    case when coalesce(ac.overdue_activities, 0) > 0 then ac.overdue_activities || ' overdue activit' || case when ac.overdue_activities = 1 then 'y' else 'ies' end end,
    case when coalesce(ac.delayed_without_recovery, 0) > 0 then 'Delay without Recovery Plan' end,
    case when bl.planned_finish is not null and p.forecast_date > bl.planned_finish
         then 'Forecast exceeds baseline by ' || (p.forecast_date - bl.planned_finish) || ' day(s)' end,
    case when p.baseline_version = 0 and p.status not in ('completed','cancelled') and p.created_at < now() - interval '14 days'
         then 'No baseline after 14 days' end,
    case when p.status in ('waiting','on_hold') and p.updated_at < now() - interval '14 days'
         then 'Waiting/On Hold > 14 days' end,
    case when qs.critical_bugs > 0 then qs.critical_bugs || ' critical bug(s) open' end,
    case when qs.fix_overdue > 0 then qs.fix_overdue || ' bug fix(es) overdue' end,
    case when qs.retest_overdue > 0 then qs.retest_overdue || ' retest(s) overdue' end,
    case when qs.evidence_missing > 0 then qs.evidence_missing || ' mandatory evidence missing' end,
    case when coalesce(ac.unreviewed_recovery, 0) > 0 then 'Recovery plan not reviewed' end
  ], null) as attention
from public.projects p
left join public.project_types pt on pt.id = p.project_type_id
left join public.profiles l on l.id = p.leader_id
left join public.project_requests r on r.id = p.request_id
left join lateral (
  select planned_finish from public.project_baselines b where b.project_id = p.id order by version_no desc limit 1
) bl on true
left join lateral (
  select count(*) as activity_count,
         count(*) filter (where public.activity_is_overdue(a)) as overdue_activities,
         count(*) filter (where public.activity_is_overdue(a) and coalesce(trim(a.recovery_plan), '') = '') as delayed_without_recovery,
         count(*) filter (where public.activity_is_overdue(a) and coalesce(trim(a.recovery_plan), '') <> '' and a.recovery_reviewed_by is null) as unreviewed_recovery
  from public.activities a where a.project_id = p.id and a.status <> 'cancelled'
) ac on true
left join lateral public.project_qa_stats(p.id) qs on true;

grant select on public.v_projects to authenticated, service_role;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.test_rounds           enable row level security;
alter table public.bugs                  enable row level security;
alter table public.bug_fixes             enable row level security;
alter table public.retests               enable row level security;
alter table public.evidence_requirements enable row level security;
alter table public.baseline_revisions    enable row level security;

create policy test_rounds_select on public.test_rounds for select to authenticated using (public.can_view_internal(project_id));
create policy test_rounds_insert on public.test_rounds for insert to authenticated with check (public.can_qa(project_id));
create policy test_rounds_update on public.test_rounds for update to authenticated
  using (public.can_qa(project_id) or tester_id = auth.uid()) with check (public.can_view_internal(project_id));
create policy test_rounds_delete on public.test_rounds for delete to authenticated
  using (public.can_manage_project(project_id) or (created_by = auth.uid() and status = 'planned'));

create policy bugs_select on public.bugs for select to authenticated using (public.can_view_internal(project_id));
create policy bugs_update on public.bugs for update to authenticated
  using (public.can_view_internal(project_id) and (reporter_id = auth.uid() or assigned_dev_id = auth.uid() or public.can_qa(project_id)))
  with check (public.can_view_internal(project_id));

create policy bug_fixes_select on public.bug_fixes for select to authenticated using (public.can_view_internal(project_id));
create policy bug_fixes_update on public.bug_fixes for update to authenticated
  using (fix_owner_id = auth.uid() or public.can_manage_project(project_id)) with check (public.can_view_internal(project_id));

create policy retests_select on public.retests for select to authenticated using (public.can_view_internal(project_id));

-- checklist names are visible with the project; managed by the leader
create policy evidence_req_select on public.evidence_requirements for select to authenticated using (public.can_view_project(project_id));
create policy evidence_req_write on public.evidence_requirements for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

create policy baseline_rev_select on public.baseline_revisions for select to authenticated using (public.can_view_project(project_id));

grant select, insert, update, delete on public.test_rounds, public.bugs, public.bug_fixes, public.retests,
  public.evidence_requirements, public.baseline_revisions to authenticated, service_role;

grant execute on function
  public.report_bug(uuid, text, text, text, text, uuid, uuid, uuid, text, text, text, uuid, date),
  public.assign_bug(uuid, uuid, date), public.start_fix(uuid),
  public.mark_fix_ready(uuid, text, text, text, text, text, uuid),
  public.record_retest(uuid, text, text), public.cancel_bug(uuid, text),
  public.request_baseline_revision(uuid, text, text, date), public.decide_baseline_revision(uuid, boolean, text),
  public.cancel_baseline_revision(uuid), public.review_recovery_plan(uuid),
  public.missing_evidence(text, uuid), public.can_qa(uuid), public.can_approve_baseline(uuid),
  public.project_qa_stats(uuid)
  to authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------
insert into public.notification_rules(event_code, name, recipient_roles, channels, escalation_days, escalate_after_days, escalate_roles) values
  ('bug_reported',               'Bug Report Sent',                 array['explicit','supervisor','manager'], array['in_app','email'], null, null, array[]::text[]),
  ('bug_assigned',               'Bug assigned to developer',       array['explicit'],                        array['in_app','email'], null, null, array[]::text[]),
  ('fix_due_tomorrow',           'Fix Due Tomorrow',                array['explicit','supervisor'],           array['in_app','email'], null, null, array[]::text[]),
  ('fix_overdue',                'Fix Overdue (escalation)',        array['explicit','leader'],               array['in_app','email'], 1, 3, array['manager']),
  ('fix_ready',                  'Fix Ready → Tester / QA',         array['explicit','qa'],                   array['in_app','email'], null, null, array[]::text[]),
  ('retest_due',                 'Retest Due',                      array['explicit'],                        array['in_app','email'], null, null, array[]::text[]),
  ('retest_failed',              'Retest failed → bug reopened',    array['explicit','leader'],               array['in_app','email'], null, null, array[]::text[]),
  ('bug_closed',                 'Bug closed after retest',         array['explicit'],                        array['in_app'],         null, null, array[]::text[]),
  ('evidence_missing',           'Evidence Missing',                array['explicit'],                        array['in_app','email'], null, null, array[]::text[]),
  ('baseline_revision_requested','Baseline revision requested',     array['explicit','manager','supervisor'], array['in_app','email'], null, null, array[]::text[]),
  ('baseline_revision_decided',  'Baseline revision decided',       array['explicit','leader'],               array['in_app','email'], null, null, array[]::text[])
on conflict (event_code) do nothing;
update public.notification_rules set escalate_after_days = 3, escalate_roles = array['manager'] where event_code = 'task_overdue';

update public.project_templates set evidence_checklist = '[
  {"name":"Approved Request","activity":"Requirement"},
  {"name":"Requirement Document","activity":"Requirement"},
  {"name":"Design Document","activity":"Design"},
  {"name":"Unit Test Log","activity":"Development"},
  {"name":"FM-SYS-007 Test Result","activity":"System Test (QA)"},
  {"name":"Test Screenshot","activity":"System Test (QA)","mandatory":false},
  {"name":"UAT Result","activity":"UAT"},
  {"name":"User Acceptance","activity":"UAT"},
  {"name":"Deployment Evidence","activity":"Go-live"},
  {"name":"Closure Document","activity":"Closure"}
]'::jsonb where code = 'WEB_DEV';
update public.project_templates set evidence_checklist = '[
  {"name":"Requirement Document","activity":"Requirement"},
  {"name":"Unit Test Log","activity":"Development"},
  {"name":"UAT Result","activity":"UAT"},
  {"name":"Deployment Evidence","activity":"Go-live"}
]'::jsonb where code = 'INTERNAL_APP';
update public.project_templates set evidence_checklist = '[
  {"name":"Survey Report","activity":"Survey & Requirement"},
  {"name":"Installation Checklist","activity":"Installation & Configuration"},
  {"name":"Test Report","activity":"Testing"},
  {"name":"Handover Document","activity":"Handover"}
]'::jsonb where code = 'INFRA';
