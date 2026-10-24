import { DIAGRAM_KINDS, type DiagramContent, type DiagramKind, fromDraft, toDraft } from '@/lib/diagram';
import type { AiCoverage } from '@/lib/clarify';
import type { ProjectRequest } from '@/lib/types';
import { aiEnabled, draftDiagram } from '@/server/ai';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { canViewInternal } from '@/server/perms';

const MAX_PROMPT = 2000;

/**
 * Company LLM drafts a flowchart / ER diagram for the Design tab — or revises `current`. Nothing is saved: the team
 * reviews the draft in the editor and saves it themselves. off: true = AI not set up.
 */
export const POST = withUser(async (me, req, params) => {
  const id = Number(params.id);
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; prompt?: unknown; current?: DiagramContent | null };
  const kind = DIAGRAM_KINDS.find((k) => k === body.kind);
  if (!kind) throw new AppError('Unknown diagram kind');
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT) : '';

  const context = await withCtx(me, async (ctx) => {
    if (!(await canViewInternal(ctx, id))) throw new AppError('Project not found', 404);
    const p = await ctx.one<{ project_code: string; project_name: string; request_id: number | null }>(
      'SELECT project_code, project_name, request_id FROM projects WHERE id = ?', [id]);
    if (!p) throw new AppError('Project not found', 404);
    const r = p.request_id
      ? await ctx.one<Pick<ProjectRequest, 'project_name' | 'description' | 'reason' | 'expectation'> & { ai_coverage: AiCoverage | null }>(
        'SELECT project_name, description, reason, expectation, ai_coverage FROM project_requests WHERE id = ?', [p.request_id])
      : null;
    const acts = await ctx.q<{ name: string }>('SELECT name FROM activities WHERE project_id = ? ORDER BY seq, plan_start LIMIT 30', [id]);
    return {
      project: { code: p.project_code, name: p.project_name },
      request: r && { project_name: r.project_name, description: r.description, reason: r.reason, expectation: r.expectation },
      coverage: r?.ai_coverage ?? null,
      activities: acts.map((a) => a.name),
    };
  });

  if (!aiEnabled()) return { data: { off: true } };
  const current = Array.isArray(body.current?.nodes) && Array.isArray(body.current?.edges) ? toDraft(body.current) : null;
  const raw = await draftDiagram(kind as DiagramKind, prompt, context, current);
  if (!raw) throw new AppError('The AI could not draft the diagram — please try again', 502);
  return { data: fromDraft(kind, raw) };
});
