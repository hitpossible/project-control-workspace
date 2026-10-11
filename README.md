# TBKK System Service — Project Control Workspace (Phase 1–3)

Implementation of `../TBKK_System_Service_Project_Control_Workspace_PRD.md` — **Phase 1: Project Control Core**, **Phase 2: QA & Workflow Control** and **Phase 3: Management Intelligence**.

**Stack:** Next.js 16 (App Router, API routes) · **MySQL 5.7+ / 8** (mysql2) · company **AD login** (JWT session cookie) · **MinIO** (S3-compatible evidence files) · node-cron scheduler · shadcn/ui (Radix + Tailwind v4, monday.com-style theme) · ExcelJS · @react-pdf/renderer (Sarabun font, Thai supported) · Nodemailer

> Migrated from Supabase (Postgres) to MySQL — the Supabase version is preserved at git tag `supabase-phase3`.

## Run locally

Requirements: Node 20+, MySQL 5.7+ (e.g. MAMP on port 8889), Docker Desktop (MinIO + Mailpit).

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL, AUTH_SECRET, MINIO_* …
npm run services:up          # MinIO (evidence files) + Mailpit (e-mail) in Docker
npm run db:reset             # create database, apply db/migrations, seed demo users & workflow data
npm run dev                  # http://localhost:3000
```

| Tool | URL |
|---|---|
| App | http://localhost:3000 |
| MinIO console (evidence files) | http://localhost:9101 |
| Mailpit (e-mail notifications) | http://localhost:8025 |
| phpMyAdmin (MAMP) | http://localhost:8888/phpMyAdmin |

`npm run db:migrate` applies only new files in `db/migrations/` (tracked in `schema_migrations`) — use it on shared / production databases. `db:reset` drops the database.

### Login

- **Company accounts** sign in with their AD username/password. The app posts `{ username, password }` to `AD_LOGIN_URL`; HTTP 2xx (without `success:false` / `error`) = success. On first login a profile with role *Requestor* is created (`AD_AUTO_PROVISION`); an admin then assigns roles in Admin → Users.
- **Local accounts** (rows with a password hash — demo users, break-glass admin) are checked first. Admin → Users can set a local password.
- `AUTH_PROVIDERS` = `ad`, `local` or `ad,local`.

### Demo accounts

Username = the name below, local password = `SEED_PASSWORD` in `scripts/seed.ts`.

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

The seed runs the **real workflow through the same server functions and access policies as the API**: 3 converted projects (one delayed with recovery plan, one on track, one still planning), plus requests in Approved / Waiting System Review / Waiting Requestor Approval / Draft, QA bugs / retests, a pending baseline revision and a workforce plan.

## Architecture

```
db/migrations/                 MySQL schema (001) + master data (002)   — npm run db:migrate
src/
  proxy.ts                     redirect anonymous users to /login (checks the session JWT)
  instrumentation.ts           starts the scheduler when the Node server boots
  app/(app)/                   authenticated pages (client components)
  app/api/data                 generic table access for the browser query builder
  app/api/rpc/[fn]             workflow / KPI / insight functions
  app/api/auth/*               login (AD / local) · logout · me
  app/api/evidence/*           upload to MinIO · permission-checked download
  app/api/admin/users          admin creates users / sets local passwords
  app/api/notifications/dispatch   sends queued e-mails (email_outbox → SMTP)
  lib/db/client.ts             browser query builder: db.from(t).select().eq()… / db.rpc() (supabase-js compatible subset)
  server/
    db.ts                      mysql2 pool, transactions (Ctx), type conversion (UTC timestamps, booleans, JSON)
    policies.ts                row-level access per table  (was Postgres RLS)
    data.ts                    select / insert / update / delete with policies, embeds (projects(...)), filters
    engine.ts + hooks.ts       single write path: defaults → guards → write → audit → roll-ups / notifications  (was triggers)
    logic/                     notification engine, numbering, progress / forecast / health roll-up, checklist
    rpc/                       requests, baseline, qa, kpi, insights, scan                                   (was plpgsql RPCs)
    views.ts                   v_projects (attention flags, QA counts)
    auth.ts session.ts         AD / local login, JWT session cookie
    storage.ts                 MinIO
    scheduler.ts               hourly notification scan · Monday 06:00 KPI snapshot · e-mail every minute (was pg_cron)
  components/ …                UI (shadcn/ui)
```

**Security lives on the server.** The browser never talks to MySQL: every `/api/data` statement is restricted by the table policy (`src/server/policies.ts`, a 1:1 port of the former RLS), column names are whitelisted from `information_schema`, and values are parameterised. Workflow state (request status, approvals, project code, baseline, bug status) can only change through the workflow functions, which validate status before every update; guards in `hooks.ts` block direct edits to protected fields.

| Who | Sees |
|---|---|
| Requestor / Management View | project summary + User Control Plan + shared evidence only |
| System Service staff | + Internal Execution Plan, technical notes, internal comments, internal evidence, history |
| Project Leader | manages own project (plan, team, baseline, evidence verification) |

### Workflow functions (`POST /api/rpc/<name>`)

| Function | Purpose |
|---|---|
| `submit_request` | validate → Request No. → approval steps (resume same step after "More Info") |
| `save_review` | System Service Review: type, template, leader, authority approver |
| `act_on_approval` | approve / reject / send back / request more info (comment required except approve) |
| `convert_request_to_project` | approved only → Project Code, project, team, activities + tasks from template |
| `create_baseline` | V1 starts the project; V2+ only via an approved revision; old versions never overwritten |
| scheduler: notification scan | due-tomorrow / overdue escalation / auto-Delayed / health recompute (hourly) |

**Automatic calculations (`hooks.ts` / `logic/project.ts`):**
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
| **Kanban board** for internal tasks — drag a card (mouse / touch) to change status; server rules still apply (permissions, mandatory evidence before Done) | Project → Internal Execution Plan → Kanban; My work → Kanban |

Bug workflow RPCs: `report_bug`, `assign_bug`, `start_fix`, `mark_fix_ready`, `record_retest`, `cancel_bug`.
Re-plan RPCs: `request_baseline_revision`, `decide_baseline_revision`, `cancel_baseline_revision`, `review_recovery_plan`.
Bug status can only change through these functions (guard in `hooks.ts`).

## Phase 3 — Management Intelligence

| Feature | Where |
|---|---|
| **KPI** (§23): Team KPI for a period, Project KPI (schedule variance, reschedules, waiting days from audit trail, evidence %, bug closure, retest pass), Individual KPI (on-time, avg delay, overdue, fix time, first-time pass, retest turnaround) with charts + Excel export | KPI |
| Fair KPI: late tasks with excused delay categories (Waiting User, Vendor, Approval Delay, Requirement Change) are not counted against the person | Admin → KPI Settings |
| Permission: Dev / QA see **own** KPI; Leader / Supervisor / Manager see everyone; Management View sees team + project summary only | `kpi_individual`, `kpi_team` |
| KPI snapshots (weekly scheduler + manual) → progress trend sparkline | KPI → Snapshot |
| **Smart Insight** (§22): 17 rules (no target/leader/next action, waiting > X days, forecast > baseline (+ “no Recovery Plan”), overdue, stale progress, reschedules > X, critical bug, fix / retest overdue, evidence missing, member overloaded, **owner on leave on due date**…). Thresholds / severity / on-off configurable; internal rules hidden from User View | Smart Insights, Dashboard, Project Overview, Admin → Insight Rules |
| **Workforce Plan** (§24): Office / Onsite / WFH / Customer Site / Factory Support / Training / Leave / OT, Daily · Weekly · Monthly · Team view, date-range entry, project link, workload (tasks / bugs due) and leave conflicts | Workforce Plan |
| **PDF reports** (§25.2): Project Status (with mini timeline), User Meeting, Project Closure (baseline vs actual, checklist, sign-off), Management Report | Reports, Project → PDF Report |
| Advanced export: KPI, Smart Insights, Workforce plan to Excel | each page |

Functions (`src/server/rpc/kpi.ts`, `insights.ts`): `kpi_projects`, `kpi_team(from,to)`, `kpi_individual(from,to)`, `smart_insights(project)`, KPI snapshot job; tables `insight_rules`, `workforce_plans`, `project_kpi_snapshots`.

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

- **Database:** create an empty schema on the company MySQL server, set `DATABASE_URL`, run `npm run db:migrate`. Timestamps are stored in UTC; business dates use the app server's time zone (Asia/Bangkok). Back up with the usual `mysqldump`.
- **Secrets:** generate a new `AUTH_SECRET` (≥ 32 chars); set `COOKIE_SECURE=true` behind HTTPS.
- **AD:** confirm the response format of `AD_LOGIN_URL` (success flag and user fields such as name / e-mail / department) — the adapter is in `src/server/auth.ts` (`adLogin`).
- **Scheduler:** runs inside the app (`node-cron`). With several app instances, keep it on one and set `DISABLE_SCHEDULER=true` on the others. External schedulers can also call `POST /api/notifications/dispatch` with header `x-cron-secret: $CRON_SECRET`.
- **E-mail:** point `SMTP_*` to the company relay.
- **Evidence files:** MinIO bucket `MINIO_BUCKET` (created automatically); 50 MB per file (`EVIDENCE_MAX_MB`). Only PDF / images / text open inline; other types download.
