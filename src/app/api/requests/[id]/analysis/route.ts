import { withUser } from '@/server/api';
import { startAnalysis } from '@/server/analysis';
import { AppError, withCtx } from '@/server/db';
import { canViewRequest, hasRole } from '@/server/perms';

/** Run the AI initial analysis of a submitted request again — the requestor or System Service. off: true = AI not set up */
export const POST = withUser(async (me, _req, params) => {
  const id = Number(params.id);
  await withCtx(me, async (ctx) => {
    const r = await ctx.one<{ requestor_id: number; submitted_at: string | null }>('SELECT requestor_id, submitted_at FROM project_requests WHERE id = ?', [id]);
    if (!r || !(await canViewRequest(ctx, id))) throw new AppError('Request not found', 404);
    if (r.requestor_id !== me.id && !hasRole(ctx, 'system_reviewer')) throw new AppError('Only the requestor or System Service can run the analysis', 403);
    if (!r.submitted_at) throw new AppError('Submit the request first');
  });
  return { data: { off: !(await startAnalysis(me, id)) } };
});
