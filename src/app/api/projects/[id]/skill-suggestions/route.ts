import enRequirements from '@/i18n/messages/en/requirements.json';
import { isEmptySummary, normalizeSummary, parseSkillSuggestions, type RequirementSummary, summaryText } from '@/lib/requirements';
import { aiEnabled, type SkillCatalogItem, suggestProjectSkills } from '@/server/ai';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { canPlanProject } from '@/server/perms';

/**
 * Company LLM suggests the project's skill requirements from its saved requirement summary. Nothing is saved: the
 * leader / Supervisor / Manager picks which to add. off: true = AI not set up; no_summary: true = write the summary first.
 */
export const POST = withUser(async (me, _req, params) => {
  const id = Number(params.id);
  const context = await withCtx(me, async (ctx) => {
    if (!(await canPlanProject(ctx, id))) throw new AppError('Not allowed', 403);
    const p = await ctx.one<{ project_code: string; project_name: string }>('SELECT project_code, project_name FROM projects WHERE id = ?', [id]);
    if (!p) throw new AppError('Project not found', 404);
    const saved = await ctx.one<{ content: RequirementSummary }>('SELECT content FROM project_requirement_summaries WHERE project_id = ?', [id]);
    const summary = saved ? normalizeSummary(saved.content) : null;
    // how many active developers hold each skill at level 3+ (verified, else self) — the team's usual stack
    const catalog = await ctx.q<SkillCatalogItem>(
      `SELECT s.id, s.name, s.category, s.description,
              (SELECT COUNT(*) FROM profile_skills ps JOIN profiles u ON u.id = ps.user_id
                WHERE ps.skill_id = s.id AND u.is_active = 1 AND COALESCE(ps.verified_level, ps.self_level) >= 3) holders
         FROM skills s WHERE s.is_active = 1 ORDER BY s.category, s.name`);
    const required = (await ctx.q<{ skill_id: number }>('SELECT skill_id FROM project_skill_requirements WHERE project_id = ?', [id])).map((r) => r.skill_id);
    return { project: { code: p.project_code, name: p.project_name }, summary, catalog: catalog.map((c) => ({ ...c, holders: Number(c.holders) })), required };
  });

  if (!aiEnabled()) return { data: { off: true } };
  const { summary } = context;
  if (!summary || isEmptySummary(summary) || !summary.features.length) return { data: { no_summary: true } };
  const raw = await suggestProjectSkills(context.project, summaryText(summary, enRequirements.section), context.catalog);
  if (!raw) throw new AppError('The AI could not suggest skills — please try again', 502);
  return {
    data: parseSkillSuggestions(raw, { skillIds: new Set(context.catalog.map((c) => c.id)), required: new Set(context.required), features: summary.features.length }),
  };
});
