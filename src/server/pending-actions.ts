import { type Ctx, inList } from './db';
import { hasRole } from './perms';

/**
 * Workflow steps waiting for me (not tasks): change requests to assess / agree to / approve / implement, and
 * deliveries to accept. Mirrors the checks in rpc/change-requests.ts and rpc/closure.ts, including "not your own".
 * Shown on My work and in the AI agenda (GET /api/me/agenda).
 */
export type PendingAction = {
  kind: 'change_request' | 'closure';
  action: 'assess' | 'agree' | 'approve' | 'implement' | 'accept_delivery';
  id: number;
  ref: string;
  title: string;
  project_id: number;
  project_code: string;
  project_name: string;
  since: string;
  link: string;
};

const ids = async (ctx: Ctx, sql: string, params: unknown[]) => (await ctx.q<{ id: number }>(sql, params)).map((r) => r.id);

export async function myPendingActions(ctx: Ctx): Promise<PendingAction[]> {
  const me = ctx.uid;
  if (!me) return [];
  const led = await ids(ctx, `SELECT id FROM projects WHERE leader_id = ? UNION SELECT project_id FROM project_members WHERE user_id = ? AND member_role = 'leader'`, [me, me]);
  const accept = await ids(ctx,
    `SELECT p.id FROM projects p JOIN project_requests r ON r.id = p.request_id WHERE r.requestor_id = ?
     UNION SELECT project_id FROM project_members WHERE user_id = ? AND member_role = 'requestor_rep'`, [me, me]);
  // Manager / Supervisor by role approve everywhere (canApproveBaseline); otherwise where they are on the team as one
  const approveAll = hasRole(ctx, 'manager') || hasRole(ctx, 'supervisor');
  const approve = approveAll ? null : await ids(ctx, `SELECT project_id id FROM project_members WHERE user_id = ? AND member_role IN ('manager','supervisor')`, [me]);

  const out: PendingAction[] = [];
  const crs = async (action: PendingAction['action'], status: string, projects: number[] | null, extra = '', extraParams: unknown[] = []) => {
    if (projects !== null && !projects.length) return;
    const [ph, pp] = projects === null ? ['', []] : inList(projects);
    const rows = await ctx.q<{ id: number; cr_no: string; title: string; project_id: number; project_code: string; project_name: string; since: string }>(
      `SELECT c.id, c.cr_no, c.title, c.project_id, p.project_code, p.project_name,
              COALESCE(c.agreed_at, c.assessed_at, c.decided_at, c.requested_at) since
         FROM change_requests c JOIN projects p ON p.id = c.project_id
        WHERE c.status = ? ${projects === null ? '' : `AND c.project_id IN (${ph})`} ${extra}`,
      [status, ...pp, ...extraParams]);
    for (const r of rows) {
      out.push({ kind: 'change_request', action, id: r.id, ref: r.cr_no, title: r.title, project_id: r.project_id, project_code: r.project_code,
        project_name: r.project_name, since: r.since, link: `/projects/${r.project_id}?tab=changes&cr=${r.id}` });
    }
  };
  await crs('assess', 'submitted', led);
  await crs('agree', 'assessed', accept, 'AND (c.assessed_by IS NULL OR c.assessed_by <> ?)', [me]);
  await crs('approve', 'agreed', approve, 'AND c.requested_by <> ?', [me]);
  await crs('implement', 'approved', led);

  if (accept.length) {
    const [ph, pp] = inList(accept);
    const rows = await ctx.q<{ id: number; round_no: number; project_id: number; project_code: string; project_name: string; since: string }>(
      `SELECT c.id, c.round_no, c.project_id, p.project_code, p.project_name, c.requested_at since
         FROM project_closures c JOIN projects p ON p.id = c.project_id
        WHERE c.status = 'pending' AND c.project_id IN (${ph}) AND c.requested_by <> ?`, [...pp, me]);
    for (const r of rows) {
      out.push({ kind: 'closure', action: 'accept_delivery', id: r.id, ref: `#${r.round_no}`, title: r.project_name, project_id: r.project_id,
        project_code: r.project_code, project_name: r.project_name, since: r.since, link: `/projects/${r.project_id}?tab=overview` });
    }
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}
