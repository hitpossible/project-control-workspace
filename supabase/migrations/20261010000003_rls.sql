-- =====================================================================
-- Row Level Security
--   * Requestor / User View : project summary + User Control Plan only
--   * System Service staff   : + Internal Execution Plan, technical notes, history
--   * Project Leader         : manage own project
--   * Writes to workflow state go through security-definer RPCs only
-- =====================================================================

alter table public.profiles               enable row level security;
alter table public.app_settings           enable row level security;
alter table public.doc_sequences          enable row level security;
alter table public.project_types          enable row level security;
alter table public.project_templates      enable row level security;
alter table public.project_requests       enable row level security;
alter table public.approval_steps         enable row level security;
alter table public.approval_actions       enable row level security;
alter table public.projects               enable row level security;
alter table public.project_members        enable row level security;
alter table public.project_baselines      enable row level security;
alter table public.project_baseline_items enable row level security;
alter table public.activities             enable row level security;
alter table public.internal_tasks         enable row level security;
alter table public.task_dependencies      enable row level security;
alter table public.evidence               enable row level security;
alter table public.notification_rules     enable row level security;
alter table public.notifications          enable row level security;
alter table public.email_outbox           enable row level security;
alter table public.audit_logs             enable row level security;

-- Profiles: directory readable by signed-in users; self-update basic info; admin all
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role('admin')) with check (id = auth.uid() or public.has_role('admin'));

-- Master data: read for all, write for admin
create policy app_settings_select on public.app_settings for select to authenticated using (true);
create policy app_settings_admin on public.app_settings for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy project_types_select on public.project_types for select to authenticated using (true);
create policy project_types_admin on public.project_types for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy project_templates_select on public.project_templates for select to authenticated using (true);
create policy project_templates_admin on public.project_templates for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy notification_rules_select on public.notification_rules for select to authenticated using (true);
create policy notification_rules_admin on public.notification_rules for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
-- doc_sequences / email_outbox: no policies → only security definer functions & service role

-- Requests
create policy requests_select on public.project_requests for select to authenticated
  using (requestor_id = auth.uid() or requestor_approver_id = auth.uid()
         or authority_approver_id = auth.uid() or public.is_system_staff());
create policy requests_insert on public.project_requests for insert to authenticated
  with check (requestor_id = auth.uid() and status = 'draft');
create policy requests_update on public.project_requests for update to authenticated
  using (requestor_id = auth.uid() and status in ('draft','need_more_information'))
  with check (requestor_id = auth.uid());
create policy requests_delete on public.project_requests for delete to authenticated
  using (requestor_id = auth.uid() and status = 'draft' and request_no is null);

create policy approval_steps_select on public.approval_steps for select to authenticated
  using (public.can_view_request(request_id) or approver_id = auth.uid());
create policy approval_actions_select on public.approval_actions for select to authenticated
  using (public.can_view_request(request_id));

-- Projects
create policy projects_select on public.projects for select to authenticated
  using (public.can_view_project(id));
create policy projects_update on public.projects for update to authenticated
  using (public.can_manage_project(id)) with check (public.can_manage_project(id));

create policy members_select on public.project_members for select to authenticated
  using (public.can_view_project(project_id));
create policy members_write on public.project_members for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

create policy baselines_select on public.project_baselines for select to authenticated
  using (public.can_view_project(project_id));
create policy baseline_items_select on public.project_baseline_items for select to authenticated
  using (exists (select 1 from public.project_baselines b where b.id = baseline_id and public.can_view_project(b.project_id)));

-- User Control Plan
create policy activities_select on public.activities for select to authenticated
  using (public.can_view_project(project_id));
create policy activities_insert on public.activities for insert to authenticated
  with check (public.can_manage_project(project_id));
create policy activities_update on public.activities for update to authenticated
  using (public.can_manage_project(project_id) or pic_user_id = auth.uid())
  with check (public.can_manage_project(project_id) or pic_user_id = auth.uid());
create policy activities_delete on public.activities for delete to authenticated
  using (public.can_manage_project(project_id));

-- Internal Execution Plan (never visible to Requestor / Management View)
create policy tasks_select on public.internal_tasks for select to authenticated
  using (public.can_view_internal(project_id));
create policy tasks_insert on public.internal_tasks for insert to authenticated
  with check (public.can_manage_project(project_id)
              or public.is_project_member(project_id, array['developer','qa','support']));
create policy tasks_update on public.internal_tasks for update to authenticated
  using (public.can_manage_project(project_id) or owner_id = auth.uid() or reviewer_id = auth.uid() or created_by = auth.uid())
  with check (public.can_view_internal(project_id));
create policy tasks_delete on public.internal_tasks for delete to authenticated
  using (public.can_manage_project(project_id) or (created_by = auth.uid() and status = 'todo'));

create policy deps_select on public.task_dependencies for select to authenticated
  using (public.can_view_internal(project_id));
create policy deps_write on public.task_dependencies for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- Evidence
create policy evidence_select on public.evidence for select to authenticated using (
  (project_id is not null and (public.can_view_internal(project_id)
                               or (not is_internal and public.can_view_project(project_id))))
  or (request_id is not null and project_id is null and public.can_view_request(request_id))
);
create policy evidence_insert on public.evidence for insert to authenticated with check (
  uploaded_by = auth.uid() and (
    (project_id is not null and public.can_view_internal(project_id))
    or (request_id is not null and project_id is null and exists (
          select 1 from public.project_requests r where r.id = request_id
          and (r.requestor_id = auth.uid() or public.is_system_staff())))
  )
);
create policy evidence_update on public.evidence for update to authenticated
  using ((project_id is not null and public.can_manage_project(project_id)) or uploaded_by = auth.uid())
  with check ((project_id is not null and public.can_manage_project(project_id)) or uploaded_by = auth.uid());
create policy evidence_delete on public.evidence for delete to authenticated
  using (uploaded_by = auth.uid() or (project_id is not null and public.can_manage_project(project_id)));

-- Notifications: own only
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Audit trail: internal for projects; participants for requests
create policy audit_select on public.audit_logs for select to authenticated using (
  (project_id is not null and public.can_view_internal(project_id))
  or (project_id is null and request_id is not null and public.can_view_request(request_id))
  or public.has_role('admin')
);

-- ---------------------------------------------------------------------
-- RPC permissions
-- ---------------------------------------------------------------------
revoke execute on function public.notify_event(text, uuid, uuid, uuid[], text, text, text, text) from public, anon, authenticated;
revoke execute on function public.recompute_project(uuid) from public, anon;
revoke execute on function public.next_sequence(text) from public, anon, authenticated;
revoke execute on function public.generate_code(text, text) from public, anon, authenticated;
revoke execute on function public.wf_bypass_on() from public, anon, authenticated;
revoke execute on function public.run_notification_scan() from public, anon, authenticated;

-- Scan can be triggered by system staff from the UI
create or replace function public.trigger_notification_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_system_staff() then raise exception 'Not allowed'; end if;
  return public.run_notification_scan();
end $$;

-- ---------------------------------------------------------------------
-- Storage: private bucket "evidence"
--   path: project/<project_id>/...  or  request/<request_id>/...
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 52428800)
on conflict (id) do nothing;

create policy evidence_objects_select on storage.objects for select to authenticated using (
  bucket_id = 'evidence' and exists (select 1 from public.evidence e where e.storage_path = name)
);
create policy evidence_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'evidence' and (
    ((storage.foldername(name))[1] = 'project' and public.can_view_internal(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1] = 'request' and public.can_view_request(((storage.foldername(name))[2])::uuid))
  )
);
create policy evidence_objects_delete on storage.objects for delete to authenticated using (
  bucket_id = 'evidence' and owner = auth.uid()
);

-- ---------------------------------------------------------------------
-- Data API grants (RLS above decides which rows)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.doc_sequences, public.email_outbox from authenticated;
grant execute on function
  public.submit_request(uuid), public.save_review(uuid, integer, integer, uuid, uuid, text),
  public.act_on_approval(uuid, text, text), public.cancel_request(uuid, text),
  public.convert_request_to_project(uuid, date, date, text), public.create_baseline(uuid, text),
  public.trigger_notification_scan(), public.my_roles(), public.has_role(text),
  public.is_system_staff(), public.can_view_internal(uuid), public.can_manage_project(uuid)
  to authenticated;
grant execute on all functions in schema public to service_role;
