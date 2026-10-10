-- =====================================================================
-- Helpers, triggers and workflow RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auth helpers (security definer to avoid RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.my_roles()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select roles from public.profiles where id = auth.uid() and is_active), array[]::text[]);
$$;

create or replace function public.has_role(p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_role = any(public.my_roles()) or 'admin' = any(public.my_roles());
$$;

-- System Service team members (may see internal execution data)
create or replace function public.is_system_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_roles() && array['system_reviewer','project_leader','developer','qa','supervisor','manager','admin']::text[];
$$;

create or replace function public.is_project_member(p_project_id uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = auth.uid()
      and (p_roles is null or m.member_role = any(p_roles))
  );
$$;

create or replace function public.can_view_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_system_staff()
      or public.has_role('management_view')
      or public.is_project_member(p_project_id)
      or exists (select 1 from public.projects p
                 join public.project_requests r on r.id = p.request_id
                 where p.id = p_project_id and r.requestor_id = auth.uid());
$$;

-- Internal Execution Plan, technical notes, internal evidence, history
create or replace function public.can_view_internal(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_system_staff()
      or public.is_project_member(p_project_id, array['leader','developer','qa','support','supervisor','manager']);
$$;

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select 'admin' = any(public.my_roles())
      or exists (select 1 from public.projects p where p.id = p_project_id and p.leader_id = auth.uid())
      or public.is_project_member(p_project_id, array['leader']);
$$;

create or replace function public.can_view_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_system_staff()
      or exists (select 1 from public.project_requests r
                 where r.id = p_request_id
                   and (r.requestor_id = auth.uid()
                        or r.requestor_approver_id = auth.uid()
                        or r.authority_approver_id = auth.uid()));
$$;

-- Workflow functions set this flag so guard triggers allow protected-field changes
create or replace function public.wf_bypass_on() returns void language sql as $$
  select set_config('pcw.bypass', 'on', true);
$$;

create or replace function public.wf_bypass() returns boolean language sql stable as $$
  select coalesce(current_setting('pcw.bypass', true), '') = 'on'
      or auth.uid() is null   -- direct DB / service role maintenance
      or coalesce(auth.role(), '') = 'service_role';
$$;

-- ---------------------------------------------------------------------
-- Profiles: auto-create on sign-up, protect roles
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, employee_id, department, section, roles)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'employee_id',
    new.raw_user_meta_data->>'department',
    new.raw_user_meta_data->>'section',
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(new.raw_user_meta_data->'roles') x),
      array['requestor'])
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.guard_profile_update()
returns trigger language plpgsql as $$
begin
  if not public.wf_bypass() and not ('admin' = any(public.my_roles())) then
    if new.roles is distinct from old.roles or new.is_active is distinct from old.is_active then
      raise exception 'Only administrators can change roles or activation';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------
-- Generic: updated_at / updated_by
-- ---------------------------------------------------------------------
create or replace function public.touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

create trigger project_requests_touch before update on public.project_requests for each row execute function public.touch_updated();
create trigger projects_touch         before update on public.projects         for each row execute function public.touch_updated();
create trigger activities_touch       before update on public.activities       for each row execute function public.touch_updated();
create trigger internal_tasks_touch   before update on public.internal_tasks   for each row execute function public.touch_updated();

-- ---------------------------------------------------------------------
-- Generic audit trigger. TG_ARGV = list of tracked columns.
-- ---------------------------------------------------------------------
create or replace function public.audit_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_project uuid;
  v_request uuid;
begin
  v_project := case when tg_table_name = 'projects' then (r->>'id')::uuid else (r->>'project_id')::uuid end;
  v_request := case when tg_table_name = 'project_requests' then (r->>'id')::uuid else (r->>'request_id')::uuid end;

  if tg_op = 'INSERT' then
    insert into public.audit_logs(table_name, entity_id, project_id, request_id, action, new_value)
    values (tg_table_name, (r->>'id')::uuid, v_project, v_request, 'insert',
            coalesce(r->>'name', r->>'project_name', r->>'file_name', r->>'url', r->>'member_role', r->>'version_no'));
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs(table_name, entity_id, project_id, request_id, action, old_value)
    values (tg_table_name, (r->>'id')::uuid, v_project, v_request, 'delete',
            coalesce(r->>'name', r->>'project_name', r->>'file_name', r->>'url', r->>'member_role'));
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

create trigger project_requests_audit after insert or update on public.project_requests
  for each row execute function public.audit_changes('status','project_name','date_required','priority','requestor_approver_id','authority_approver_id','proposed_leader_id');
create trigger projects_audit after insert or update on public.projects
  for each row execute function public.audit_changes('status','leader_id','start_date','target_date','forecast_date','progress','health','next_action','priority','baseline_version','remark');
create trigger activities_audit after insert or update or delete on public.activities
  for each row execute function public.audit_changes('name','status','pic_user_id','pic_label','plan_start','plan_finish','actual_start','actual_finish','forecast_finish','progress','delay_category','delay_reason','recovery_plan','next_action');
create trigger internal_tasks_audit after insert or update or delete on public.internal_tasks
  for each row execute function public.audit_changes('name','status','owner_id','reviewer_id','planned_start','due_date','actual_start','actual_finish','progress','delay_category','delay_reason','recovery_action');
create trigger project_members_audit after insert or delete on public.project_members
  for each row execute function public.audit_changes();
create trigger evidence_audit after insert or update or delete on public.evidence
  for each row execute function public.audit_changes('verification_status','description');
create trigger project_baselines_audit after insert on public.project_baselines
  for each row execute function public.audit_changes();

-- ---------------------------------------------------------------------
-- Guards: protected fields can only be changed by workflow functions
-- ---------------------------------------------------------------------
create or replace function public.guard_request_update()
returns trigger language plpgsql as $$
begin
  if public.wf_bypass() then return new; end if;
  if new.status is distinct from old.status
     or new.request_no is distinct from old.request_no
     or new.date_submitted is distinct from old.date_submitted
     or new.submitted_at is distinct from old.submitted_at
     or new.project_id is distinct from old.project_id
     or new.requestor_id is distinct from old.requestor_id
     or new.reviewed_by is distinct from old.reviewed_by then
    raise exception 'Protected request fields can only be changed through the approval workflow';
  end if;
  if old.status not in ('draft','need_more_information') then
    raise exception 'Request % is locked (status: %)', coalesce(old.request_no, old.id::text), old.status;
  end if;
  return new;
end $$;

create trigger project_requests_guard before update on public.project_requests
  for each row execute function public.guard_request_update();

create or replace function public.guard_project_update()
returns trigger language plpgsql as $$
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
  end if;
  return new;
end $$;

create trigger projects_guard before update on public.projects
  for each row execute function public.guard_project_update();

-- ---------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------
create or replace function public.next_sequence(p_scope text)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.doc_sequences(scope, last_value) values (p_scope, 1)
  on conflict (scope) do update set last_value = public.doc_sequences.last_value + 1
  returning last_value into v;
  return v;
end $$;

-- Format tokens: {TYPE} {YYYY} {YY} {SEQ:n}. Sequence scope = format with SEQ removed.
create or replace function public.generate_code(p_format text, p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_fmt   text := p_format;
  v_width integer := coalesce((regexp_match(p_format, '\{SEQ:(\d+)\}'))[1]::int, 3);
  v_scope text;
  v_seq   integer;
begin
  v_fmt := replace(v_fmt, '{YYYY}', to_char(current_date, 'YYYY'));
  v_fmt := replace(v_fmt, '{YY}', to_char(current_date, 'YY'));
  if coalesce(p_type, '') = '' then
    v_fmt := replace(replace(v_fmt, '-{TYPE}', ''), '{TYPE}', '');
  else
    v_fmt := replace(v_fmt, '{TYPE}', p_type);
  end if;
  v_scope := regexp_replace(v_fmt, '\{SEQ:\d+\}', '#');
  v_seq := public.next_sequence(v_scope);
  return regexp_replace(v_fmt, '\{SEQ:\d+\}', lpad(v_seq::text, v_width, '0'));
end $$;

create or replace function public.setting_text(p_key text, p_default text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = p_key), p_default);
$$;

-- Task number per project
create or replace function public.set_task_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.task_no is null then
    new.task_no := 'T-' || lpad(public.next_sequence('task:' || new.project_id::text)::text, 4, '0');
  end if;
  if new.parent_task_id is not null then
    select activity_id into new.activity_id from public.internal_tasks where id = new.parent_task_id;
  end if;
  return new;
end $$;

create trigger internal_tasks_no before insert on public.internal_tasks
  for each row execute function public.set_task_no();

-- ---------------------------------------------------------------------
-- Notification engine
-- ---------------------------------------------------------------------
create or replace function public.notify_event(
  p_event       text,
  p_project_id  uuid,
  p_request_id  uuid,
  p_explicit    uuid[],
  p_title       text,
  p_body        text,
  p_link        text,
  p_dedupe      text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_rule  public.notification_rules;
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
  end if;
  if not v_rule.is_active then return 0; end if;

  v_users := case when 'explicit' = any(v_rule.recipient_roles) then coalesce(p_explicit, array[]::uuid[]) else array[]::uuid[] end;

  if p_project_id is not null then
    v_users := v_users || coalesce((
      select array_agg(distinct m.user_id) from public.project_members m
      where m.project_id = p_project_id and m.notify and m.member_role = any(v_rule.recipient_roles)), array[]::uuid[]);
    if 'leader' = any(v_rule.recipient_roles) then
      v_users := v_users || coalesce((select array[leader_id] from public.projects where id = p_project_id and leader_id is not null), array[]::uuid[]);
    end if;
  end if;

  for v_uid in select distinct u from unnest(v_users) u where u is not null loop
    insert into public.notifications(user_id, event_code, project_id, request_id, title, body, link, dedupe_key)
    values (v_uid, p_event, p_project_id, p_request_id, p_title, p_body, p_link, p_dedupe)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
    returning id into v_nid;

    if v_nid is not null then
      v_cnt := v_cnt + 1;
      if 'email' = any(v_rule.channels) then
        insert into public.email_outbox(notification_id, to_email, subject, body)
        select v_nid, p.email, '[Project Control] ' || p_title, coalesce(p_body, '') || E'\n\n' || coalesce(p_link, '')
        from public.profiles p where p.id = v_uid and p.email is not null;
      end if;
    end if;
    v_nid := null;
  end loop;
  return v_cnt;
end $$;

-- Assigned Task → Owner
create or replace function public.on_task_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    if new.owner_id is distinct from auth.uid() then
      select project_code into v_code from public.projects where id = new.project_id;
      perform public.notify_event('task_assigned', new.project_id, null, array[new.owner_id],
        format('Task assigned: %s %s', new.task_no, new.name),
        format('Project %s — due %s', v_code, to_char(new.due_date, 'DD Mon YYYY')),
        format('/projects/%s?tab=internal&task=%s', new.project_id, new.id));
    end if;
  end if;
  return null;
end $$;

create trigger internal_tasks_assigned after insert or update of owner_id on public.internal_tasks
  for each row execute function public.on_task_assigned();

-- ---------------------------------------------------------------------
-- Status side-effects + progress roll-up
-- ---------------------------------------------------------------------
create or replace function public.task_before_write()
returns trigger language plpgsql as $$
begin
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

create trigger internal_tasks_before before insert or update on public.internal_tasks
  for each row execute function public.task_before_write();

create or replace function public.activity_before_write()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' then
    new.progress := 100;
    new.actual_finish := coalesce(new.actual_finish, current_date);
    new.actual_start := coalesce(new.actual_start, new.actual_finish);
  elsif new.progress > 0 or new.status = 'in_progress' then
    new.actual_start := coalesce(new.actual_start, current_date);
    if new.status = 'not_started' then new.status := 'in_progress'; end if;
  end if;
  if new.status <> 'completed' then new.actual_finish := null; end if;
  return new;
end $$;

create trigger activities_before before insert or update on public.activities
  for each row execute function public.activity_before_write();

-- Forecast for one activity
create or replace function public.activity_forecast(a public.activities)
returns date language sql stable as $$
  select case
    when a.status = 'cancelled' then null
    when a.status = 'completed' then coalesce(a.actual_finish, a.plan_finish)
    when a.forecast_finish is not null then a.forecast_finish
    when a.plan_finish is not null and a.plan_finish < current_date then current_date
    else a.plan_finish end;
$$;

create or replace function public.activity_is_overdue(a public.activities)
returns boolean language sql stable as $$
  select a.plan_finish is not null and a.plan_finish < current_date
     and a.status not in ('completed','cancelled');
$$;

-- Recompute project progress / forecast / health / auto status
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

  select planned_finish into v_base_fin from public.project_baselines
  where project_id = p_project_id order by version_no desc limit 1;

  v_variance := coalesce(v_forecast - coalesce(v_base_fin, v_p.target_date), 0);

  if v_p.status in ('completed','cancelled') then
    v_health := case when v_p.status = 'completed' and v_variance > 0 then 'yellow' else 'green' end;
  elsif v_no_recov > 0 or v_variance > 7
        or (v_p.target_date is not null and v_p.target_date < current_date) then
    v_health := 'red';
  elsif v_overdue_a > 0 or v_overdue_t > 0 or v_variance > 0
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
      when v_health = 'yellow' and v_overdue_t > 0 then 'at_risk'
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

-- Roll task progress up: sub-task → parent task → activity → project
create or replace function public.rollup_from_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r          record;
  v_parent   uuid;
  v_activity uuid;
  v_project  uuid;
  v_avg      numeric;
  v_cnt      integer;
  v_done     integer;
  v_astart   date;
  v_afinish  date;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  v_parent := r.parent_task_id;
  v_activity := r.activity_id;
  v_project := r.project_id;

  if pg_trigger_depth() > 8 then return null; end if;

  if v_parent is not null then
    select avg(progress), count(*), count(*) filter (where status = 'completed'), min(actual_start), max(actual_finish)
      into v_avg, v_cnt, v_done, v_astart, v_afinish
    from public.internal_tasks where parent_task_id = v_parent and status <> 'cancelled';
    if v_cnt > 0 then
      update public.internal_tasks
         set progress = round(v_avg, 2),
             status = case when v_done = v_cnt then 'completed'
                           when status = 'completed' then 'in_progress'
                           else status end,
             actual_start = coalesce(v_astart, actual_start),
             actual_finish = case when v_done = v_cnt then v_afinish end
       where id = v_parent and (progress <> round(v_avg, 2) or (v_done = v_cnt) <> (status = 'completed')
             or actual_start is distinct from coalesce(v_astart, actual_start));
    end if;
  end if;

  -- activity progress = average of top-level tasks; actual dates from tasks
  select avg(progress), count(*), count(*) filter (where status = 'completed'),
         min(actual_start), max(actual_finish)
    into v_avg, v_cnt, v_done, v_astart, v_afinish
  from public.internal_tasks where activity_id = v_activity and parent_task_id is null and status <> 'cancelled';
  if v_cnt > 0 then
    update public.activities
       set progress = round(v_avg, 2),
           status = case when v_done = v_cnt then 'completed'
                         when status = 'completed' then 'in_progress'
                         else status end,
           actual_start = coalesce(v_astart, actual_start),
           actual_finish = case when v_done = v_cnt then v_afinish end
     where id = v_activity
       and (progress <> round(v_avg, 2) or (v_done = v_cnt) <> (status = 'completed')
            or actual_start is distinct from coalesce(v_astart, actual_start)
            or actual_finish is distinct from case when v_done = v_cnt then v_afinish end);
  end if;

  perform public.recompute_project(v_project);
  return null;
end $$;

create trigger internal_tasks_rollup after insert or update of progress, status, parent_task_id, activity_id or delete
  on public.internal_tasks for each row execute function public.rollup_from_task();

create or replace function public.rollup_from_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if pg_trigger_depth() > 8 then return null; end if;
  perform public.recompute_project(r.project_id);

  -- Activity Delayed → Leader / PIC / Supervisor
  if tg_op = 'UPDATE' and new.status = 'delayed' and old.status is distinct from 'delayed' then
    perform public.notify_event('activity_delayed', new.project_id, null,
      array[new.pic_user_id],
      format('Activity delayed: %s', new.name),
      format('Reason: %s', coalesce(new.delay_reason, '(not provided)')),
      format('/projects/%s?tab=plan', new.project_id),
      format('activity_delayed:%s:%s', new.id, current_date));
  end if;
  return null;
end $$;

create trigger activities_rollup after insert or update or delete on public.activities
  for each row execute function public.rollup_from_activity();

-- Project Need Attention when health turns red
create or replace function public.on_project_health()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.health = 'red' and old.health is distinct from 'red' then
    perform public.notify_event('project_need_attention', new.id, null, array[new.leader_id],
      format('Project needs attention: %s', new.project_code),
      format('%s — health turned RED. Forecast %s, target %s.', new.project_name,
             coalesce(to_char(new.forecast_date, 'DD Mon YYYY'), '-'),
             coalesce(to_char(new.target_date, 'DD Mon YYYY'), '-')),
      format('/projects/%s', new.id),
      format('need_attention:%s:%s', new.id, current_date));
  end if;
  return null;
end $$;

create trigger projects_health_notify after update of health on public.projects
  for each row execute function public.on_project_health();

-- ---------------------------------------------------------------------
-- Request workflow
-- ---------------------------------------------------------------------
create or replace function public.request_status_for_step(p_step_code text)
returns text language sql immutable as $$
  select case p_step_code
    when 'requestor_approval' then 'waiting_requestor_approval'
    when 'system_review' then 'waiting_system_review'
    when 'authority_approval' then 'waiting_authority_approval' end;
$$;

create or replace function public.notify_step_waiting(p_step public.approval_steps)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.project_requests;
  v_users uuid[];
begin
  select * into r from public.project_requests where id = p_step.request_id;
  if p_step.approver_id is not null then
    v_users := array[p_step.approver_id];
  else
    select array_agg(id) into v_users from public.profiles
    where is_active and p_step.approver_role = any(roles);
  end if;
  perform public.notify_event('approval_waiting', null, r.id, v_users,
    format('Approval required: %s', r.request_no),
    format('%s — %s', p_step.step_name, r.project_name),
    format('/requests/%s', r.id),
    format('approval_waiting:%s', p_step.id));
end $$;

create or replace function public.submit_request(p_request_id uuid)
returns public.project_requests language plpgsql security definer set search_path = public as $$
declare
  r       public.project_requests;
  v_cycle integer;
  v_step  public.approval_steps;
  v_missing text[] := array[]::text[];
begin
  select * into r from public.project_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.requestor_id <> auth.uid() then raise exception 'Only the requestor can submit this request'; end if;
  if r.status not in ('draft','need_more_information') then
    raise exception 'Request cannot be submitted from status %', r.status;
  end if;

  if coalesce(trim(r.project_name), '') = '' then v_missing := v_missing || 'Project Name'; end if;
  if coalesce(trim(r.description), '') = '' then v_missing := v_missing || 'Brief Description'; end if;
  if coalesce(trim(r.reason), '') = '' then v_missing := v_missing || 'Reason for Request'; end if;
  if r.date_required is null then v_missing := v_missing || 'Date Required'; end if;
  if r.requestor_approver_id is null then v_missing := v_missing || 'Requestor Approver'; end if;
  if coalesce(trim(r.req_full_name), '') = '' then v_missing := v_missing || 'Requestor Name'; end if;
  if coalesce(trim(r.req_department), '') = '' then v_missing := v_missing || 'Department'; end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'Missing required fields: %', array_to_string(v_missing, ', ');
  end if;

  perform public.wf_bypass_on();

  -- Resume after "Request More Information": same step goes back to waiting
  if r.status = 'need_more_information' then
    update public.approval_steps set status = 'waiting', action = null, acted_at = null, acted_by = null
     where request_id = r.id and status = 'more_info'
     returning * into v_step;
    if v_step.id is not null then
      update public.project_requests set status = public.request_status_for_step(v_step.step_code)
       where id = r.id returning * into r;
      insert into public.approval_actions(request_id, step_id, step_code, action, comment)
      values (r.id, v_step.id, v_step.step_code, 'resubmit', 'Information provided');
      perform public.notify_step_waiting(v_step);
      return r;
    end if;
  end if;

  select coalesce(max(cycle), 0) + 1 into v_cycle from public.approval_steps where request_id = r.id;
  update public.approval_steps set status = 'cancelled' where request_id = r.id and status in ('pending','waiting');

  insert into public.approval_steps(request_id, cycle, step_no, step_code, step_name, approver_id, approver_role, status)
  values
    (r.id, v_cycle, 1, 'requestor_approval', 'Requestor Approval',    r.requestor_approver_id, 'requestor_approver', 'waiting'),
    (r.id, v_cycle, 2, 'system_review',      'System Service Review', null,                    'system_reviewer',    'pending'),
    (r.id, v_cycle, 3, 'authority_approval', 'Authority Approval',    r.authority_approver_id, 'authority_approver', 'pending');

  update public.project_requests set
    request_no = coalesce(request_no, public.generate_code(public.setting_text('request_no_format', 'REQ-SYS-{YYYY}-{SEQ:4}'), null)),
    date_submitted = current_date,
    submitted_at = now(),
    status = 'waiting_requestor_approval'
  where id = r.id returning * into r;

  insert into public.approval_actions(request_id, action, comment)
  values (r.id, case when v_cycle = 1 then 'submit' else 'resubmit' end, null);

  select * into v_step from public.approval_steps where request_id = r.id and cycle = v_cycle and step_no = 1;
  perform public.notify_step_waiting(v_step);
  return r;
end $$;

-- System Service Review data (only while review step is waiting)
create or replace function public.save_review(
  p_request_id uuid, p_project_type_id integer, p_template_id integer,
  p_proposed_leader_id uuid, p_authority_approver_id uuid, p_scope_assessment text
) returns public.project_requests language plpgsql security definer set search_path = public as $$
declare r public.project_requests;
begin
  if not public.has_role('system_reviewer') then raise exception 'Only System Service Reviewer can review requests'; end if;
  if not exists (select 1 from public.approval_steps s join public.project_requests q on q.id = s.request_id
                 where s.request_id = p_request_id and s.step_code = 'system_review' and s.status = 'waiting') then
    raise exception 'Request is not waiting for System Service Review';
  end if;
  perform public.wf_bypass_on();
  update public.project_requests set
    project_type_id = p_project_type_id,
    template_id = p_template_id,
    proposed_leader_id = p_proposed_leader_id,
    authority_approver_id = p_authority_approver_id,
    scope_assessment = p_scope_assessment,
    reviewed_by = auth.uid()
  where id = p_request_id returning * into r;
  -- keep authority step approver in sync
  update public.approval_steps set approver_id = p_authority_approver_id
   where request_id = p_request_id and step_code = 'authority_approval' and status = 'pending';
  return r;
end $$;

create or replace function public.act_on_approval(p_step_id uuid, p_action text, p_comment text default null)
returns public.project_requests language plpgsql security definer set search_path = public as $$
declare
  s      public.approval_steps;
  r      public.project_requests;
  v_next public.approval_steps;
  v_status text;
begin
  select * into s from public.approval_steps where id = p_step_id for update;
  if not found then raise exception 'Approval step not found'; end if;
  select * into r from public.project_requests where id = s.request_id for update;

  -- Validate status before update (never skip approval)
  if s.status <> 'waiting' then raise exception 'This step is not waiting for action (status: %)', s.status; end if;
  if r.status <> public.request_status_for_step(s.step_code) then
    raise exception 'Request status % does not match step %', r.status, s.step_code;
  end if;
  if s.approver_id is not null and s.approver_id <> auth.uid() then
    raise exception 'You are not the assigned approver for this step';
  end if;
  if s.approver_id is null and not (s.approver_role = any(public.my_roles())) then
    raise exception 'You need role % to act on this step', s.approver_role;
  end if;
  if p_action not in ('approve','reject','send_back','request_more_info') then
    raise exception 'Unsupported action %', p_action;
  end if;
  if p_action <> 'approve' and coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment is required for %', replace(p_action, '_', ' ');
  end if;

  if p_action = 'approve' and s.step_code = 'system_review' then
    if r.project_type_id is null or r.proposed_leader_id is null or r.authority_approver_id is null then
      raise exception 'Complete the review (Project Type, Project Leader, Authority Approver) before approving';
    end if;
  end if;

  perform public.wf_bypass_on();

  update public.approval_steps set
    status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected'
                           when 'send_back' then 'sent_back' else 'more_info' end,
    action = p_action, comment = p_comment, acted_by = auth.uid(), acted_at = now()
  where id = s.id;

  insert into public.approval_actions(request_id, step_id, step_code, action, comment)
  values (r.id, s.id, s.step_code, p_action, p_comment);

  if p_action = 'approve' then
    select * into v_next from public.approval_steps
     where request_id = r.id and cycle = s.cycle and step_no > s.step_no and status = 'pending'
     order by step_no limit 1;
    if v_next.id is not null then
      if v_next.step_code = 'authority_approval' then
        update public.approval_steps set approver_id = r.authority_approver_id, status = 'waiting'
         where id = v_next.id returning * into v_next;
      else
        update public.approval_steps set status = 'waiting' where id = v_next.id returning * into v_next;
      end if;
      v_status := public.request_status_for_step(v_next.step_code);
      update public.project_requests set status = v_status where id = r.id returning * into r;
      perform public.notify_step_waiting(v_next);
    else
      update public.project_requests set status = 'approved' where id = r.id returning * into r;
      perform public.notify_event('request_approved', null, r.id,
        array[r.requestor_id, r.proposed_leader_id, r.reviewed_by],
        format('Request approved: %s', r.request_no),
        format('%s is approved and ready to convert to a Controlled Project.', r.project_name),
        format('/requests/%s', r.id), format('request_approved:%s', r.id));
    end if;
  else
    update public.project_requests set status = case p_action
        when 'reject' then 'rejected'
        when 'send_back' then 'draft'
        else 'need_more_information' end
    where id = r.id returning * into r;
    if p_action = 'send_back' then
      update public.approval_steps set status = 'cancelled'
       where request_id = r.id and cycle = s.cycle and status = 'pending';
    elsif p_action = 'reject' then
      update public.approval_steps set status = 'cancelled'
       where request_id = r.id and cycle = s.cycle and status = 'pending';
    end if;
    perform public.notify_event('request_' || p_action, null, r.id, array[r.requestor_id],
      format('%s: %s', case p_action when 'reject' then 'Request rejected'
                                     when 'send_back' then 'Request sent back'
                                     else 'More information requested' end, r.request_no),
      format('%s — %s', s.step_name, p_comment),
      format('/requests/%s', r.id), null);
  end if;
  return r;
end $$;

create or replace function public.cancel_request(p_request_id uuid, p_comment text default null)
returns public.project_requests language plpgsql security definer set search_path = public as $$
declare r public.project_requests;
begin
  select * into r from public.project_requests where id = p_request_id for update;
  if r.requestor_id <> auth.uid() and not public.has_role('admin') then raise exception 'Only the requestor can cancel'; end if;
  if r.status not in ('draft','need_more_information','waiting_requestor_approval') then
    raise exception 'Request cannot be cancelled from status %', r.status;
  end if;
  perform public.wf_bypass_on();
  update public.approval_steps set status = 'cancelled' where request_id = r.id and status in ('pending','waiting','more_info');
  update public.project_requests set status = 'cancelled' where id = r.id returning * into r;
  insert into public.approval_actions(request_id, action, comment) values (r.id, 'cancel', p_comment);
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Convert approved request → Controlled Project
-- ---------------------------------------------------------------------
create or replace function public.convert_request_to_project(
  p_request_id uuid, p_start_date date, p_target_date date, p_sponsor text default null
) returns public.projects language plpgsql security definer set search_path = public as $$
declare
  r        public.project_requests;
  p        public.projects;
  v_type   text;
  v_tpl    public.project_templates;
  v_act    jsonb;
  v_task   jsonb;
  v_aid    uuid;
  v_cursor date;
  v_astart date;
  v_tcursor date;
  v_seq    integer := 0;
  v_tseq   integer;
begin
  select * into r from public.project_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  -- Business rule 1: only approved requests can be converted
  if r.status <> 'approved' then raise exception 'Only approved requests can be converted (status: %)', r.status; end if;
  if not (public.has_role('system_reviewer') or r.proposed_leader_id = auth.uid()) then
    raise exception 'Only System Service Reviewer or the assigned Project Leader can convert';
  end if;
  if p_start_date is null or p_target_date is null or p_target_date < p_start_date then
    raise exception 'Valid start and target dates are required';
  end if;

  select code into v_type from public.project_types where id = r.project_type_id;
  perform public.wf_bypass_on();

  insert into public.projects(project_code, project_name, project_type_id, template_id, request_id, leader_id,
                              sponsor, department, priority, start_date, target_date, status, next_action, created_by)
  values (public.generate_code(public.setting_text('project_code_format', 'SYS-{TYPE}-{YYYY}-{SEQ:3}'), v_type),
          r.project_name, r.project_type_id, r.template_id, r.id, r.proposed_leader_id,
          p_sponsor, r.req_department, r.priority, p_start_date, p_target_date, 'planning',
          'Prepare project plan and set Baseline V1', auth.uid())
  returning * into p;

  -- Project Team
  insert into public.project_members(project_id, user_id, member_role) values (p.id, r.proposed_leader_id, 'leader')
  on conflict do nothing;
  insert into public.project_members(project_id, user_id, member_role) values (p.id, r.requestor_id, 'requestor_rep')
  on conflict do nothing;

  -- Default activities from template, scheduled sequentially from start date
  if r.template_id is not null then
    select * into v_tpl from public.project_templates where id = r.template_id;
    v_cursor := p_start_date;
    for v_act in select * from jsonb_array_elements(v_tpl.default_activities) loop
      v_seq := v_seq + 1;
      v_astart := v_cursor;
      v_cursor := v_astart + greatest(coalesce((v_act->>'duration_days')::int, 1), 1) - 1;
      insert into public.activities(project_id, seq, name, pic_label, pic_user_id, plan_start, plan_finish, is_milestone)
      values (p.id, v_seq, v_act->>'name', coalesce(v_act->>'pic_label', 'System'),
              case when coalesce(v_act->>'pic_label', 'System') = 'System' then r.proposed_leader_id end,
              v_astart, v_cursor, coalesce((v_act->>'is_milestone')::boolean, false))
      returning id into v_aid;

      v_tseq := 0;
      v_tcursor := v_astart;
      for v_task in select * from jsonb_array_elements(coalesce(v_act->'tasks', '[]'::jsonb)) loop
        v_tseq := v_tseq + 1;
        insert into public.internal_tasks(project_id, activity_id, seq, name, task_type, owner_id, planned_start, due_date)
        values (p.id, v_aid, v_tseq, v_task->>'name', coalesce(v_task->>'task_type', 'dev'), r.proposed_leader_id,
                v_tcursor, least(v_tcursor + greatest(coalesce((v_task->>'duration_days')::int, 1), 1) - 1, v_cursor));
        v_tcursor := least(v_tcursor + greatest(coalesce((v_task->>'duration_days')::int, 1), 1), v_cursor);
      end loop;
      v_cursor := v_cursor + 1;
    end loop;
  end if;

  update public.project_requests set status = 'converted', project_id = p.id where id = r.id;
  insert into public.approval_actions(request_id, action, comment) values (r.id, 'convert', p.project_code);

  perform public.notify_event('project_converted', p.id, r.id, array[r.requestor_id, r.proposed_leader_id],
    format('Project created: %s', p.project_code),
    format('%s has been converted to a Controlled Project.', p.project_name),
    format('/projects/%s', p.id), format('project_converted:%s', p.id));

  perform public.recompute_project(p.id);
  select * into p from public.projects where id = p.id;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- Baseline: freeze current User Control Plan as a new version
-- (V1 is set when the project starts; later versions never overwrite old ones)
-- ---------------------------------------------------------------------
create or replace function public.create_baseline(p_project_id uuid, p_reason text default null)
returns public.project_baselines language plpgsql security definer set search_path = public as $$
declare
  p   public.projects;
  b   public.project_baselines;
  v_n integer;
begin
  select * into p from public.projects where id = p_project_id for update;
  if not public.can_manage_project(p_project_id) then raise exception 'Only the Project Leader can manage the baseline'; end if;
  if not exists (select 1 from public.activities where project_id = p_project_id and status <> 'cancelled') then
    raise exception 'Add at least one activity before setting a baseline';
  end if;
  if exists (select 1 from public.activities where project_id = p_project_id and status <> 'cancelled'
             and (plan_start is null or plan_finish is null)) then
    raise exception 'All activities need Plan Start and Plan Finish before setting a baseline';
  end if;
  v_n := p.baseline_version + 1;
  if v_n > 1 and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for a baseline revision';
  end if;

  perform public.wf_bypass_on();
  insert into public.project_baselines(project_id, version_no, planned_start, planned_finish, target_date, reason)
  select p_project_id, v_n, min(plan_start), max(plan_finish), p.target_date,
         coalesce(nullif(trim(p_reason), ''), 'Initial baseline')
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

-- ---------------------------------------------------------------------
-- Scheduled scan: due-tomorrow / overdue reminders, auto delay, health
-- ---------------------------------------------------------------------
create or replace function public.run_notification_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t   record;
  a   record;
  v_esc integer;
  v_due integer := 0;
  v_over integer := 0;
  v_delay integer := 0;
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

  -- Task overdue → repeat every escalation_days
  select coalesce(escalation_days, 1) into v_esc from public.notification_rules where event_code = 'task_overdue';
  v_esc := greatest(coalesce(v_esc, 1), 1);
  for t in
    select it.*, p.project_code, (current_date - it.due_date) as days_over
    from public.internal_tasks it join public.projects p on p.id = it.project_id
    where it.due_date < current_date and it.status not in ('completed','cancelled')
      and p.status not in ('completed','cancelled','on_hold')
  loop
    v_over := v_over + public.notify_event('task_overdue', t.project_id, null, array[t.owner_id],
      format('Overdue %s day(s): %s %s', t.days_over, t.task_no, t.name), format('Project %s — due %s', t.project_code, to_char(t.due_date, 'DD Mon YYYY')),
      format('/projects/%s?tab=internal&task=%s', t.project_id, t.id),
      format('task_overdue:%s:%s', t.id, (t.days_over - 1) / v_esc));
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

  return jsonb_build_object('due_tomorrow', v_due, 'overdue', v_over, 'activities_delayed', v_delay, 'ran_at', now());
end $$;

-- ---------------------------------------------------------------------
-- Reporting view (RLS applies via security_invoker)
-- ---------------------------------------------------------------------
create or replace view public.v_projects with (security_invoker = true) as
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
         then 'Waiting/On Hold > 14 days' end
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
         count(*) filter (where public.activity_is_overdue(a) and coalesce(trim(a.recovery_plan), '') = '') as delayed_without_recovery
  from public.activities a where a.project_id = p.id and a.status <> 'cancelled'
) ac on true;

grant select on public.v_projects to authenticated;
