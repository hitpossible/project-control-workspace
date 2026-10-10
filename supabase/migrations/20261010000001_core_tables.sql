-- =====================================================================
-- TBKK System Service Project Control Workspace — Core tables (Phase 1)
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Users / profiles
-- ---------------------------------------------------------------------
-- roles: requestor, requestor_approver, system_reviewer, authority_approver,
--        project_leader, developer, qa, supervisor, manager, management_view, admin
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  employee_id   text,
  full_name     text not null,
  email         text,
  department    text,
  section       text,
  telephone     text,
  extension     text,
  roles         text[] not null default array['requestor'],
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint profiles_roles_chk check (roles <@ array[
    'requestor','requestor_approver','system_reviewer','authority_approver',
    'project_leader','developer','qa','supervisor','manager','management_view','admin'
  ]::text[])
);

-- ---------------------------------------------------------------------
-- Master data / configuration
-- ---------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

create table public.doc_sequences (
  scope       text primary key,
  last_value  integer not null default 0
);

create table public.project_types (
  id         serial primary key,
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true
);

-- default_activities: [{name, pic_label, duration_days, is_milestone, tasks:[{name, task_type, duration_days}]}]
create table public.project_templates (
  id                  serial primary key,
  code                text not null unique,
  name                text not null,
  project_type_id     integer references public.project_types(id),
  description         text,
  default_activities  jsonb not null default '[]'::jsonb,
  evidence_checklist  jsonb not null default '[]'::jsonb,
  is_active           boolean not null default true
);

-- ---------------------------------------------------------------------
-- Project Request (FM-SYS-004)
-- ---------------------------------------------------------------------
create table public.project_requests (
  id                     uuid primary key default gen_random_uuid(),
  request_no             text unique,
  status                 text not null default 'draft',
  requestor_id           uuid not null default auth.uid() references public.profiles(id),
  -- Requestor information (snapshot at request time)
  req_employee_id        text,
  req_full_name          text,
  req_department         text,
  req_section            text,
  req_email              text,
  req_telephone          text,
  req_extension          text,
  -- Project information
  project_name           text not null,
  description            text,
  reason                 text,
  expectation            text,
  priority               text not null default 'medium',
  date_submitted         date,
  date_required          date,
  benefit                text,
  -- Routing
  requestor_approver_id  uuid references public.profiles(id),
  authority_approver_id  uuid references public.profiles(id),
  -- System Service review
  project_type_id        integer references public.project_types(id),
  template_id            integer references public.project_templates(id),
  proposed_leader_id     uuid references public.profiles(id),
  scope_assessment       text,
  reviewed_by            uuid references public.profiles(id),
  -- Result
  project_id             uuid,
  submitted_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  constraint project_requests_status_chk check (status in (
    'draft','submitted','waiting_requestor_approval','waiting_system_review',
    'need_more_information','waiting_authority_approval','approved','rejected',
    'converted','cancelled')),
  constraint project_requests_priority_chk check (priority in ('low','medium','high','critical'))
);

-- ---------------------------------------------------------------------
-- Approval workflow
-- ---------------------------------------------------------------------
create table public.approval_steps (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.project_requests(id) on delete cascade,
  cycle          integer not null default 1,
  step_no        integer not null,
  step_code      text not null,
  step_name      text not null,
  approver_id    uuid references public.profiles(id),   -- null = any user holding approver_role
  approver_role  text not null,
  status         text not null default 'pending',
  action         text,
  comment        text,
  acted_by       uuid references public.profiles(id),
  acted_at       timestamptz,
  created_at     timestamptz not null default now(),
  constraint approval_steps_code_chk check (step_code in ('requestor_approval','system_review','authority_approval')),
  constraint approval_steps_status_chk check (status in ('pending','waiting','approved','rejected','sent_back','more_info','cancelled')),
  unique (request_id, cycle, step_no)
);

create table public.approval_actions (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.project_requests(id) on delete cascade,
  step_id     uuid references public.approval_steps(id) on delete set null,
  step_code   text,
  action      text not null,
  comment     text,
  action_by   uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint approval_actions_action_chk check (action in (
    'submit','resubmit','approve','reject','send_back','request_more_info','cancel','convert'))
);

-- ---------------------------------------------------------------------
-- Controlled Project
-- ---------------------------------------------------------------------
create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  project_code      text not null unique,
  project_name      text not null,
  project_type_id   integer references public.project_types(id),
  template_id       integer references public.project_templates(id),
  request_id        uuid unique references public.project_requests(id),
  leader_id         uuid references public.profiles(id),
  sponsor           text,
  department        text,
  priority          text not null default 'medium',
  start_date        date,
  target_date       date,
  forecast_date     date,
  status            text not null default 'planning',
  progress          numeric(5,2) not null default 0,
  health            text not null default 'green',
  next_action       text,
  remark            text,             -- high-level remark (visible to User / Management)
  baseline_version  integer not null default 0,
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint projects_status_chk check (status in (
    'draft','planning','in_progress','waiting','on_hold','at_risk','delayed','completed','cancelled')),
  constraint projects_health_chk check (health in ('green','yellow','red')),
  constraint projects_priority_chk check (priority in ('low','medium','high','critical')),
  constraint projects_progress_chk check (progress between 0 and 100)
);

alter table public.project_requests
  add constraint project_requests_project_fk foreign key (project_id) references public.projects(id);

create table public.project_members (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  member_role  text not null,
  notify       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint project_members_role_chk check (member_role in (
    'leader','developer','qa','support','supervisor','manager','requestor_rep')),
  unique (project_id, user_id, member_role)
);

-- ---------------------------------------------------------------------
-- Baseline
-- ---------------------------------------------------------------------
create table public.project_baselines (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  version_no      integer not null,
  planned_start   date,
  planned_finish  date,
  target_date     date,
  reason          text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  approved_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (project_id, version_no)
);

create table public.project_baseline_items (
  id              uuid primary key default gen_random_uuid(),
  baseline_id     uuid not null references public.project_baselines(id) on delete cascade,
  activity_id     uuid,
  seq             integer not null default 0,
  activity_name   text not null,
  pic             text,
  planned_start   date,
  planned_finish  date,
  is_milestone    boolean not null default false
);

-- ---------------------------------------------------------------------
-- User Control Plan (Activity)
-- ---------------------------------------------------------------------
create table public.activities (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  seq              integer not null default 0,
  name             text not null,
  pic_user_id      uuid references public.profiles(id),
  pic_label        text,                 -- e.g. "System", "User", "Vendor"
  plan_start       date,
  plan_finish      date,
  actual_start     date,
  actual_finish    date,
  forecast_finish  date,                 -- revised forecast (recovery)
  progress         numeric(5,2) not null default 0,
  status           text not null default 'not_started',
  status_note      text,
  remark           text,
  next_action      text,
  delay_category   text,
  delay_reason     text,
  recovery_plan    text,
  is_milestone     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint activities_status_chk check (status in (
    'not_started','in_progress','waiting','delayed','at_risk','on_hold','completed','cancelled')),
  constraint activities_progress_chk check (progress between 0 and 100),
  constraint activities_dates_chk check (plan_finish is null or plan_start is null or plan_finish >= plan_start)
);

-- ---------------------------------------------------------------------
-- Internal Execution Plan (Task / Sub-task)
-- ---------------------------------------------------------------------
create table public.internal_tasks (
  id               uuid primary key default gen_random_uuid(),
  task_no          text,
  project_id       uuid not null references public.projects(id) on delete cascade,
  activity_id      uuid not null references public.activities(id) on delete cascade,
  parent_task_id   uuid references public.internal_tasks(id) on delete cascade,
  seq              integer not null default 0,
  name             text not null,
  task_type        text not null default 'dev',
  owner_id         uuid not null references public.profiles(id),
  reviewer_id      uuid references public.profiles(id),
  priority         text not null default 'medium',
  planned_start    date,
  due_date         date not null,
  actual_start     date,
  actual_finish    date,
  progress         numeric(5,2) not null default 0,
  status           text not null default 'todo',
  description      text,
  technical_note   text,
  internal_comment text,
  delay_category   text,
  delay_reason     text,
  recovery_action  text,
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint internal_tasks_type_chk check (task_type in ('design','dev','qa','review','doc','deploy','support','other')),
  constraint internal_tasks_status_chk check (status in ('todo','in_progress','waiting','review','completed','on_hold','cancelled')),
  constraint internal_tasks_priority_chk check (priority in ('low','medium','high','critical')),
  constraint internal_tasks_progress_chk check (progress between 0 and 100),
  constraint internal_tasks_dates_chk check (planned_start is null or due_date >= planned_start),
  unique (project_id, task_no)
);

create table public.task_dependencies (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  predecessor_id   uuid not null references public.internal_tasks(id) on delete cascade,
  successor_id     uuid not null references public.internal_tasks(id) on delete cascade,
  dep_type         text not null default 'FS',
  created_at       timestamptz not null default now(),
  constraint task_dependencies_self_chk check (predecessor_id <> successor_id),
  unique (predecessor_id, successor_id)
);

-- ---------------------------------------------------------------------
-- Evidence (bound to an entity)
-- ---------------------------------------------------------------------
create table public.evidence (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references public.projects(id) on delete cascade,
  request_id           uuid references public.project_requests(id) on delete cascade,
  entity_type          text not null,
  entity_id            uuid not null,
  evidence_type        text not null,
  file_name            text,
  storage_path         text,
  url                  text,
  mime_type            text,
  file_size            bigint,
  description          text,
  is_required          boolean not null default false,
  is_internal          boolean not null default true,
  verification_status  text not null default 'pending',
  verified_by          uuid references public.profiles(id),
  verified_at          timestamptz,
  uploaded_by          uuid references public.profiles(id) default auth.uid(),
  uploaded_at          timestamptz not null default now(),
  constraint evidence_entity_chk check (entity_type in ('request','project','activity','task')),
  constraint evidence_type_chk check (evidence_type in (
    'document','excel','pdf','image','screenshot','log','email','meeting_note',
    'url','sharepoint','git','build','other')),
  constraint evidence_verify_chk check (verification_status in ('pending','verified','rejected')),
  constraint evidence_source_chk check (storage_path is not null or url is not null),
  constraint evidence_owner_chk check (project_id is not null or request_id is not null)
);

-- ---------------------------------------------------------------------
-- Notification
-- ---------------------------------------------------------------------
-- recipient_roles: project member roles (leader, developer, qa, support, supervisor, manager, requestor_rep)
--                  plus 'explicit' (owner/approver passed by the event itself)
create table public.notification_rules (
  event_code        text primary key,
  name              text not null,
  recipient_roles   text[] not null default array['explicit'],
  channels          text[] not null default array['in_app','email'],
  escalation_days   integer,          -- repeat interval for overdue events
  is_active         boolean not null default true
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  event_code  text not null,
  project_id  uuid references public.projects(id) on delete cascade,
  request_id  uuid references public.project_requests(id) on delete cascade,
  title       text not null,
  body        text,
  link        text,
  dedupe_key  text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index notifications_dedupe_uq on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on public.notifications(user_id, is_read, created_at desc);

create table public.email_outbox (
  id           uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete set null,
  to_email     text not null,
  subject      text not null,
  body         text,
  status       text not null default 'queued',
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  constraint email_outbox_status_chk check (status in ('queued','sent','failed'))
);

-- ---------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id           bigserial primary key,
  table_name   text not null,
  entity_id    uuid,
  project_id   uuid,
  request_id   uuid,
  action       text not null,
  field        text,
  old_value    text,
  new_value    text,
  user_id      uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index audit_logs_project_idx on public.audit_logs(project_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_id, created_at desc);

-- Helpful indexes
create index activities_project_idx on public.activities(project_id, seq);
create index internal_tasks_activity_idx on public.internal_tasks(activity_id, seq);
create index internal_tasks_owner_idx on public.internal_tasks(owner_id, status);
create index project_members_user_idx on public.project_members(user_id);
create index evidence_entity_idx on public.evidence(entity_type, entity_id);
create index approval_steps_request_idx on public.approval_steps(request_id, cycle, step_no);
create index project_requests_requestor_idx on public.project_requests(requestor_id);
