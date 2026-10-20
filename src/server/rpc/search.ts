import { AppError, type Ctx } from '../db';
import { POLICIES, type Where } from '../policies';

export type SearchHit = {
  type: 'project' | 'request' | 'task' | 'bug';
  id: number;
  title: string;
  code: string | null;
  subtitle: string | null;
  status: string;
  link: string;
};

const LIMIT = 6;
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** policy condition of a table; used as `alias.id IN (SELECT id FROM table WHERE …)` so it applies unaliased */
async function where(ctx: Ctx, table: string): Promise<Where | null> {
  const w = await POLICIES[table].read(ctx);
  return w === false ? null : w;
}

/** Ctrl+K search across projects, requests, tasks and bugs — each table filtered by its access policy */
export async function globalSearch(ctx: Ctx, a: { q?: string }): Promise<SearchHit[]> {
  const q = String(a?.q ?? '').trim();
  if (q.length < 2) return [];
  if (q.length > 100) throw new AppError('Search text is too long');
  const t = like(q);
  const hits: SearchHit[] = [];

  const pw = await where(ctx, 'projects');
  if (pw) {
    for (const p of await ctx.q<{ id: number; project_code: string; project_name: string; status: string; leader: string | null }>(
      `SELECT p.id, p.project_code, p.project_name, p.status, l.full_name leader FROM projects p LEFT JOIN profiles l ON l.id = p.leader_id
        WHERE p.id IN (SELECT id FROM projects WHERE ${pw[0]}) AND (p.project_code LIKE ? OR p.project_name LIKE ?)
        ORDER BY p.project_code DESC LIMIT ${LIMIT}`, [...pw[1], t, t])) {
      hits.push({ type: 'project', id: p.id, code: p.project_code, title: p.project_name, subtitle: p.leader ? `Leader ${p.leader}` : null, status: p.status, link: `/projects/${p.id}` });
    }
  }

  const rw = await where(ctx, 'project_requests');
  if (rw) {
    for (const r of await ctx.q<{ id: number; request_no: string | null; project_name: string; status: string; req_full_name: string | null; req_department: string | null }>(
      `SELECT id, request_no, project_name, status, req_full_name, req_department FROM project_requests
        WHERE (${rw[0]}) AND (request_no LIKE ? OR project_name LIKE ? OR req_full_name LIKE ?)
        ORDER BY created_at DESC LIMIT ${LIMIT}`, [...rw[1], t, t, t])) {
      hits.push({ type: 'request', id: r.id, code: r.request_no, title: r.project_name,
        subtitle: [r.req_full_name, r.req_department].filter(Boolean).join(' · ') || null, status: r.status, link: `/requests/${r.id}` });
    }
  }

  const tw = await where(ctx, 'internal_tasks');
  if (tw) {
    for (const x of await ctx.q<{ id: number; project_id: number; task_no: string; name: string; status: string; project_code: string; owner: string | null }>(
      `SELECT t.id, t.project_id, t.task_no, t.name, t.status, p.project_code, o.full_name owner
         FROM internal_tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN profiles o ON o.id = t.owner_id
        WHERE t.id IN (SELECT id FROM internal_tasks WHERE ${tw[0]}) AND (t.task_no LIKE ? OR t.name LIKE ?)
        ORDER BY t.due_date LIMIT ${LIMIT}`, [...tw[1], t, t])) {
      hits.push({ type: 'task', id: x.id, code: x.task_no, title: x.name, subtitle: [x.project_code, x.owner].filter(Boolean).join(' · '),
        status: x.status, link: `/projects/${x.project_id}?tab=internal&task=${x.id}` });
    }
  }

  const bw = await where(ctx, 'bugs');
  if (bw) {
    for (const b of await ctx.q<{ id: number; project_id: number; bug_no: string; title: string; status: string; project_code: string; severity: string }>(
      `SELECT b.id, b.project_id, b.bug_no, b.title, b.status, b.severity, p.project_code
         FROM bugs b JOIN projects p ON p.id = b.project_id
        WHERE b.id IN (SELECT id FROM bugs WHERE ${bw[0]}) AND (b.bug_no LIKE ? OR b.title LIKE ?)
        ORDER BY b.created_at DESC LIMIT ${LIMIT}`, [...bw[1], t, t])) {
      hits.push({ type: 'bug', id: b.id, code: b.bug_no, title: b.title, subtitle: `${b.project_code} · ${b.severity}`,
        status: b.status, link: `/projects/${b.project_id}?tab=qa&bug=${b.id}` });
    }
  }
  return hits;
}
