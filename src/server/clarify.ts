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

/** A new request being written with the AI (intake): the document type's criteria and the requestor's department */
export function loadIntake(me: Profile, documentTypeId: unknown) {
  return withCtx(me, async (ctx) => {
    const doc = await ctx.one<{ clarify_criteria: ClarifyCriterion[] | null }>('SELECT clarify_criteria FROM document_types WHERE id = ? AND is_active = 1', [Number(documentTypeId) || 0]);
    if (!doc) throw new AppError('Choose an active document type for the request');
    const department = me.department_id ? await ctx.val<string>('SELECT name FROM departments WHERE id = ?', [me.department_id]) : null;
    return { criteria: doc.clarify_criteria ?? [], department };
  });
}

const INTAKE_TEXT = ['project_name', 'description', 'reason', 'expectation'] as const;
const INTAKE_NUM = ['reduction_time_from', 'reduction_time_to', 'reduction_man_from', 'reduction_man_to', 'reduction_cost_from', 'reduction_cost_to'] as const;

/** The unsaved form from the browser, shaped as a request for the prompt (only the fields the AI reads) */
export function intakeRequest(v: unknown, department: string | null): ProjectRequest {
  const f = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const r: Record<string, unknown> = { req_department: department, priority: typeof f.priority === 'string' ? f.priority : 'medium', date_required: null, ai_clarifications: null };
  for (const k of INTAKE_TEXT) r[k] = typeof f[k] === 'string' ? String(f[k]).slice(0, 2000) : '';
  for (const k of INTAKE_NUM) r[k] = f[k] === '' || f[k] == null || !Number.isFinite(Number(f[k])) ? null : Number(f[k]);
  return r as unknown as ProjectRequest;
}

/** Screen language sent by the browser */
export const chatLang = (v: unknown) => (v === 'th' ? 'th' : v === 'en' ? 'en' : undefined);
