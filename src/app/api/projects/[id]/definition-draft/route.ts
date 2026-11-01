import enDefinition from '@/i18n/messages/en/definition.json';
import type { AiAnalysis } from '@/lib/clarify';
import { definitionText, isEmptyDefinition, MAX_TEXT, normalizeDefinition, type ProjectDefinition } from '@/lib/definition';
import { meetingsForAnalysis, type ProjectMeeting } from '@/lib/meetings';
import type { ProjectRequest } from '@/lib/types';
import { aiEnabled, draftProjectDefinition } from '@/server/ai';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { canPlanProject, canViewInternal } from '@/server/perms';

/**
 * Company LLM drafts the project definition from the request, the clarification interview, the initial analysis and
 * the team's notes — with update: true it revises the saved definition instead of starting over.
 * Nothing is saved: the team reviews the draft in the editor and saves it. off: true = AI not set up.
 */
export const POST = withUser(async (me, req, params) => {
  const id = Number(params.id);
  const body = (await req.json().catch(() => ({}))) as { notes?: unknown; update?: unknown };
  const typed = typeof body.notes === 'string' ? body.notes.trim().slice(0, MAX_TEXT * 2) : '';

  const context = await withCtx(me, async (ctx) => {
    if (!(await canViewInternal(ctx, id))) throw new AppError('Project not found', 404);
    if (!(await canPlanProject(ctx, id))) throw new AppError('Only the project leader, a Supervisor or a Manager can draft the project definition', 403);
    const p = await ctx.one<{ project_code: string; project_name: string; request_id: number | null }>(
      'SELECT project_code, project_name, request_id FROM projects WHERE id = ?', [id]);
    if (!p) throw new AppError('Project not found', 404);
    const request = p.request_id ? await ctx.one<ProjectRequest>('SELECT * FROM project_requests WHERE id = ?', [p.request_id]) : null;
    const acts = await ctx.q<{ name: string }>('SELECT name FROM activities WHERE project_id = ? ORDER BY seq, plan_start LIMIT 30', [id]);
    const saved = body.update === true
      ? await ctx.one<{ content: ProjectDefinition }>('SELECT content FROM project_definitions WHERE project_id = ?', [id])
      : null;
    const current = saved ? normalizeDefinition(saved.content) : null;
    // what the held meetings decided and learned (their MOM) is extra input, after the notes typed here
    const held = await ctx.q<ProjectMeeting>("SELECT * FROM project_meetings WHERE project_id = ? AND status = 'held' ORDER BY start_at", [id]);
    const minutes = meetingsForAnalysis(held);
    return {
      notes: [typed, minutes && `MEETING MINUTES (decisions and information obtained):\n${minutes}`].filter(Boolean).join('\n\n'),
      project: { code: p.project_code, name: p.project_name },
      request,
      analysis: (request?.ai_analysis ?? null) as AiAnalysis | null,
      activities: acts.map((a) => a.name),
      current: current && !isEmptyDefinition(current) ? definitionText(current, enDefinition) : null,
    };
  });

  if (!aiEnabled()) return { data: { off: true } };
  if (!context.request && !context.notes && !context.current) {
    throw new AppError('This project has no request to work from — paste meeting notes or requirements in the notes box first');
  }
  const raw = await draftProjectDefinition(context);
  if (!raw) throw new AppError('The AI could not draft the project definition — please try again', 502);
  return { data: normalizeDefinition(raw) };
});
