import type { AiCoverage, ClarifyCriterion } from '@/lib/clarify';
import type { ProjectRequest } from '@/lib/types';
import { assessRequest } from '@/server/ai';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';

const OPEN = `status IN ('draft','need_more_information')`;

/**
 * One AI round for the requestor's own draft, just before submit: checks the document type's criteria,
 * stores the result on the request (ai_coverage) and returns the next questions.
 * questions: null = AI off / unavailable, [] = nothing more to ask.
 */
export const POST = withUser(async (me, _req, params) => {
  const { r, criteria, moreInfo } = await withCtx(me, async (ctx) => {
    const r = await ctx.one<ProjectRequest>('SELECT * FROM project_requests WHERE id = ?', [params.id]);
    if (!r || r.requestor_id !== me.id) throw new AppError('Request not found', 404);
    if (!['draft', 'need_more_information'].includes(r.status)) throw new AppError(`Request cannot be submitted from status ${r.status}`);
    const criteria = (await ctx.val<ClarifyCriterion[]>('SELECT clarify_criteria FROM document_types WHERE id = ?', [r.document_type_id])) ?? [];
    const moreInfo = r.status === 'need_more_information'
      ? await ctx.val<string>(`SELECT comment FROM approval_steps WHERE request_id = ? AND status = 'more_info' LIMIT 1`, [r.id])
      : null;
    return { r, criteria, moreInfo };
  });
  // outside a transaction: the model can take a while and must not hold a DB connection
  const a = await assessRequest(r, criteria, moreInfo);
  if (!a) return { data: { questions: null, coverage: null } };

  const coverage: AiCoverage = { checked_at: new Date().toISOString(), criteria: a.coverage };
  await withCtx(me, (ctx) => ctx.exec(`UPDATE project_requests SET ai_coverage = ? WHERE id = ? AND requestor_id = ? AND ${OPEN}`,
    [JSON.stringify(coverage), r.id, me.id]));
  return { data: { questions: a.questions, coverage } };
});
