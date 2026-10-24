import 'server-only';
import { MAX_CHAT_MESSAGE, type ChatMessage, type ClarifyCriterion } from '@/lib/clarify';
import type { Profile, ProjectRequest } from '@/lib/types';
import { AppError, withCtx } from './db';

/** The requestor's own open request with its document type's criteria and the approver's "more info" comment */
export function loadForClarify(me: Profile, id: string) {
  return withCtx(me, async (ctx) => {
    const r = await ctx.one<ProjectRequest>('SELECT * FROM project_requests WHERE id = ?', [id]);
    if (!r || r.requestor_id !== me.id) throw new AppError('Request not found', 404);
    if (!['draft', 'need_more_information'].includes(r.status)) throw new AppError(`Request cannot be submitted from status ${r.status}`);
    const criteria = (await ctx.val<ClarifyCriterion[]>('SELECT clarify_criteria FROM document_types WHERE id = ?', [r.document_type_id])) ?? [];
    const moreInfo = r.status === 'need_more_information'
      ? await ctx.val<string>(`SELECT comment FROM approval_steps WHERE request_id = ? AND status = 'more_info' LIMIT 1`, [r.id])
      : null;
    return { r, criteria, moreInfo };
  });
}

/** The browser sends the conversation; keep only well-formed messages */
export function cleanMessages(v: unknown): ChatMessage[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-60).flatMap((m): ChatMessage[] => {
    if (!m || (m.role !== 'assistant' && m.role !== 'user') || typeof m.content !== 'string' || !m.content.trim()) return [];
    return [{
      role: m.role,
      content: m.content.trim().slice(0, MAX_CHAT_MESSAGE),
      at: typeof m.at === 'string' ? m.at : new Date().toISOString(),
      ...(m.role === 'assistant' && Array.isArray(m.criteria) ? { criteria: m.criteria.map(String).slice(0, 5) } : {}),
      ...(m.voice === true ? { voice: true } : {}),
    }];
  });
}
