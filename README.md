# TBKK System Service — Project Control Workspace (Phase 1–3)

Implementation of `../TBKK_System_Service_Project_Control_Workspace_PRD.md` — **Phase 1: Project Control Core**, **Phase 2: QA & Workflow Control** and **Phase 3: Management Intelligence**.

**Stack:** Next.js 16 (App Router) · shadcn/ui (Radix + Tailwind v4, monday.com-style theme) · Supabase (Postgres + Auth + Storage + RLS) · ExcelJS · @react-pdf/renderer (Sarabun font, Thai supported) · Nodemailer

## Run locally

Requirements: Node 20+, Docker Desktop, Supabase CLI.

```bash
supabase start          # local Postgres / Auth / Storage / Mailpit
npm install
npm run db:reset        # apply migrations + seed demo users & workflow data
npm run dev             # http://localhost:3000
```

`.env.local` holds the local Supabase URL/keys (from `supabase status -o env`) and SMTP settings (Mailpit on port 54325).

| Tool | URL |
|---|---|
| App | http://localhost:3000 |
| Supabase Studio | http://127.0.0.1:54323 |
| Mailpit (e-mail notifications) | http://127.0.0.1:54324 |

### Demo accounts

All accounts use `@tbkk.test`. The password is `SEED_PASSWORD` in `scripts/seed.mjs`.

| Account | Roles |
|---|---|
| requestor | Requestor |
| req.manager | Requestor Approver |
| reviewer | System Service Reviewer, Supervisor |
| authority | Authority Approver, Manager |
| leader | Project Leader, Developer |
| dev1 / dev2 | Developer |
| qa | QA |
| supervisor | Supervisor |
| mgmt | Management / User View |
| admin | Administrator |

The seed runs the **real workflow through the RPCs**: 3 converted projects (one delayed with recovery plan, one on track, one still planning), plus requests in Approved / Waiting System Review / Waiting Requestor Approval / Draft.

## Architecture

```
src/
  proxy.ts                     session refresh + redirect to /login (Next 16 "proxy" = middleware)
  app/(app)/                   authenticated pages
    page.tsx                   Internal Dashboard (staff) / Management Dashboard (others)
    requests/ [id]/ new/       Project Request (FM-SYS-004) + approval + convert
    projects/ [id]/            Project list + Workspace (Overview, User Plan, Internal Plan, Team, Baseline, Evidence, History)
    my-tasks/ notifications/ management/ admin/
  app/api/notifications/dispatch   sends queued e-mails (email_outbox → SMTP)
  app/api/admin/users              admin creates users (service role)
  components/ui/               shadcn/ui primitives (generated — `npx shadcn@latest add <name>`)
  components/common.tsx        app building blocks: StatusChip, Person, BoardGroup, form fields, UserSelect…
  components/GanttChart.tsx    interactive Gantt (plan / actual / forecast-recovery / milestone / today / dependencies)
  lib/exportExcel.ts           Excel export from master data
supabase/migrations/
  …01_core_tables.sql          schema
  …02_functions_workflow.sql   workflow RPCs, triggers, audit, roll-up, notification engine, v_projects
  …03_rls.sql                  Row Level Security + storage policies + grants
  …04_master_data.sql          project types, templates, notification rules, code formats, pg_cron
```

**Security lives in Postgres.** Every table has RLS. Workflow state (request status, approvals, project code, baseline) can only change through `security definer` RPCs, which validate status before every update. Guard triggers block direct edits to protected fields.

| Who | Sees |
|---|---|
| Requestor / Management View | project summary + User Control Plan + shared evidence only |
| System Service staff | + Internal Execution Plan, technical notes, internal comments, internal evidence, history |
| Project Leader | manages own project (plan, team, baseline, evidence verification) |

### Workflow RPCs

| RPC | Purpose |
|---|---|
| `submit_request` | validate → Request No. → approval steps (resume same step after "More Info") |
| `save_review` | System Service Review: type, template, leader, authority approver |
| `act_on_approval` | approve / reject / send back / request more info (comment required except approve) |
| `convert_request_to_project` | approved only → Project Code, project, team, activities + tasks from template |
| `create_baseline` | V1 starts the project; V2+ need a reason; old versions never overwritten |
| `run_notification_scan` | due-tomorrow / overdue escalation / auto-Delayed / health recompute (pg_cron hourly) |

**Automatic calculations (triggers):**
- Sub-task → task → activity progress roll-up (activity actual dates come from its tasks)
- Project progress (weighted by duration), forecast, schedule variance, health (green/yellow/red), and auto Delayed / At Risk
- `audit_logs` record field old→new values with who and when (status, PIC, due date, baseline, forecast, progress, recovery, evidence, team)
- Notification recipients are resolved from **Project Member roles + Notification Rule + Event**

## PRD coverage (Phase 1 acceptance criteria)

| AC | Status |
|---|---|
| 001 Request + Save Draft · 002 Approval route · 003 Convert · 004 Project Code · 005 Baseline V1 | ✅ |
| 006 User Control Plan · 007 Internal Task under Activity · 008/024 User View hides internal detail (RLS) | ✅ |
| 009 Task Owner + Due Date (NOT NULL) · 010 Overdue highlight · 015 Evidence bound to Task/Activity/Request | ✅ |
| 017 Notifications per event (in-app + e-mail) · 018 Need Attention · 019 Baseline vs Forecast · 020 Delay + Recovery | ✅ |
| 021 Excel export (User Control Plan + Gantt, Project Summary, Task List, Project Status) · 023 Due date / status history | ✅ |
| 022 PDF | ✅ Phase 3 — Project Status / User Meeting / Project Closure / Management Report (PDF) |
| 011 Multiple Test Rounds · 012 Assign Developer · 013 Fix Ready → Tester · 014 Retest / Reopen | ✅ Phase 2 (QA & Bugs tab) |
| 016 Mandatory evidence blocks completion (Activity / Task / Project) | ✅ Phase 2 (Evidence Checklist from template) |

## Phase 2 — QA & Workflow Control

| Feature | Where |
|---|---|
| Test Round (Round 1, 2… / Regression) with cases, result, summary, evidence | Project → **QA & Bugs** → Test Rounds |
| Bug → Assign Developer → Start Fix → **Fix Ready** (fix description, unit test, build / commit link) → **Retest** → Pass closes / Fail reopens | Bug dialog → Workflow |
| Fix cycles + retest history per bug, reopen count, retest pass rate | Bug dialog → Fix & Retest History |
| Evidence Checklist from template (mandatory ★ / optional), blocks completion, Critical bug blocks Go-live milestone & project completion | Project → Evidence; Activity / Task → Evidence |
| Escalation: Fix due tomorrow, Fix overdue (repeat + escalate to Manager after N days), Fix Ready → QA, Retest due, Evidence missing, Task overdue escalation | Admin → Notification Rules |
| Structured Recovery Plan: impact, recovery owner, recovery due date, Supervisor/Manager review | Activity dialog |
| Baseline Revision: Leader requests (reason, impact, new target) → Manager / Supervisor approves → Baseline Vn+1 (old versions kept, approved_by recorded) | Project → Baseline |
| My work: Tasks · Bugs to fix · Retest queue | My work |

Bug workflow RPCs: `report_bug`, `assign_bug`, `start_fix`, `mark_fix_ready`, `record_retest`, `cancel_bug`.
Re-plan RPCs: `request_baseline_revision`, `decide_baseline_revision`, `cancel_baseline_revision`, `review_recovery_plan`.
Bug status can only change through these RPCs (guard trigger).

## Phase 3 — Management Intelligence

| Feature | Where |
|---|---|
| **KPI** (§23): Team KPI for a period, Project KPI (schedule variance, reschedules, waiting days from audit trail, evidence %, bug closure, retest pass), Individual KPI (on-time, avg delay, overdue, fix time, first-time pass, retest turnaround) with charts + Excel export | KPI |
| Fair KPI: late tasks with excused delay categories (Waiting User, Vendor, Approval Delay, Requirement Change) are not counted against the person | Admin → KPI Settings |
| Permission: Dev / QA see **own** KPI; Leader / Supervisor / Manager see everyone; Management View sees team + project summary only | `kpi_individual`, `kpi_team` |
| KPI snapshots (weekly pg_cron + manual) → progress trend sparkline | KPI → Snapshot |
| **Smart Insight** (§22): 17 rules (no target/leader/next action, waiting > X days, forecast > baseline (+ “no Recovery Plan”), overdue, stale progress, reschedules > X, critical bug, fix / retest overdue, evidence missing, member overloaded, **owner on leave on due date**…). Thresholds / severity / on-off configurable; internal rules hidden from User View | Smart Insights, Dashboard, Project Overview, Admin → Insight Rules |
| **Workforce Plan** (§24): Office / Onsite / WFH / Customer Site / Factory Support / Training / Leave / OT, Daily · Weekly · Monthly · Team view, date-range entry, project link, workload (tasks / bugs due) and leave conflicts | Workforce Plan |
| **PDF reports** (§25.2): Project Status (with mini timeline), User Meeting, Project Closure (baseline vs actual, checklist, sign-off), Management Report | Reports, Project → PDF Report |
| Advanced export: KPI, Smart Insights, Workforce plan to Excel | each page |

DB: `kpi_projects()`, `kpi_team(from,to)`, `kpi_individual(from,to)`, `smart_insights(project)`, `take_kpi_snapshot()`; tables `insight_rules`, `workforce_plans`, `project_kpi_snapshots`.

## Assumptions for PRD §34 Open Questions

These defaults are confirmable/configurable:

1. Same approval route for every project type: Requestor Approver (chosen by requestor) → System Service Review (any reviewer) → Authority Approver (chosen by reviewer)
2. Project Code `SYS-{TYPE}-{YYYY}-{SEQ:3}`, Request No `REQ-SYS-{YYYY}-{SEQ:4}`. Both can be changed in Admin → Numbering
3. Priority has 4 levels: Low / Medium / High / Critical
4. An activity's progress is calculated from its internal tasks. If it has no tasks, progress is entered manually
5. One activity has many tasks. Tasks can have sub-tasks and finish-to-start dependencies
6. Only the Project Leader can change the baseline. V2 and later require a reason (an approval step for revisions is planned for Phase 2)
7. Management sees all projects, at summary level only
8. Overdue reminders repeat every `escalation_days` (default 2), configurable in Admin → Notification Rules
9. Delayed / overdue items require Delay Category + Reason + Recovery Plan before saving (business rule 15)
10. Bug severity: Low / Medium / High / Critical — default fix SLA 10 / 5 / 3 / 1 days
11. A Critical bug that is still open blocks Go-live (milestone activities) and project completion
12. A bug closes only when a retest passes (Rule 7); any QA (not only the original tester) may retest
13. Baseline V2+ must be approved by a Manager / Supervisor who is not the requester
14. Workforce Plan links to a project optionally (Q20); staff can see the whole team plan, members edit their own, Supervisor / Manager edit everyone
15. On-time project completion is measured against the **first** baseline target; waiting days come from time activities spent in *Waiting* status

## Production notes

- Replace email/password with company SSO (Supabase Auth → Azure AD / Keycloak OIDC). `handle_new_user` creates profiles automatically.
- Point SMTP_* to the company relay, and call `POST /api/notifications/dispatch` with header `x-cron-secret: $CRON_SECRET` from a scheduler (it is also triggered after each user action).
- Evidence bucket limit is 50 MB per file (`storage.buckets.file_size_limit`).
