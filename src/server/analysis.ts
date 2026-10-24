import 'server-only';
import { after } from 'next/server';
import type { AiAnalysis } from '@/lib/clarify';
import type { Profile, ProjectRequest } from '@/lib/types';
import { aiEnabled, analyzeRequest, type AnalysisCatalog } from './ai';
import { type Ctx, withCtx } from './db';

const save = (me: Profile, id: number, a: AiAnalysis) =>
  withCtx(me, (ctx) => ctx.exec('UPDATE project_requests SET ai_analysis = ? WHERE id = ?', [JSON.stringify(a), id]));

/** earlier projects given to the AI to compare with — the most recent ones keep the prompt short */
const PAST_PROJECTS = 40;

async function loadCatalog(ctx: Ctx, requestId: number): Promise<AnalysisCatalog> {
  const types = await ctx.q<{ id: number; name: string }>('SELECT id, name FROM project_types WHERE is_active = 1 ORDER BY name');
  const templates = (await ctx.q<{ id: number; name: string; project_type_id: number | null; description: string | null; default_activities: { name: string; duration_days?: number }[] | null }>(
    'SELECT id, name, project_type_id, description, default_activities FROM project_templates WHERE is_active = 1 ORDER BY name'))
    .map(({ default_activities, ...t }) => ({ ...t, activities: (default_activities ?? []).map((a) => ({ name: a.name, duration_days: a.duration_days })) }));
  const projects = await ctx.q<AnalysisCatalog['projects'][number]>(
    `SELECT p.id, p.project_code code, p.project_name name, t.name type, p.status,
            DATE_FORMAT(p.start_date, '%Y-%m-%d') start, DATE_FORMAT(p.target_date, '%Y-%m-%d') target,
            IF(p.status = 'completed', (SELECT DATE_FORMAT(MAX(a.actual_finish), '%Y-%m-%d') FROM activities a WHERE a.project_id = p.id), NULL) finished,
            r.description
       FROM projects p
       LEFT JOIN project_types t ON t.id = p.project_type_id
       LEFT JOIN project_requests r ON r.id = p.request_id
      WHERE p.status <> 'cancelled' AND (p.request_id IS NULL OR p.request_id <> ?)
      ORDER BY p.created_at DESC LIMIT ${PAST_PROJECTS}`, [requestId]);
  return { types, templates, projects };
}

/**
 * Mark the request's AI initial analysis as pending and write it once the response has gone out — the model can take
 * a while, and submit must not wait for it. No-op when AI is off.
 */
export async function startAnalysis(me: Profile, id: number) {
  if (!aiEnabled()) return false;
  await save(me, id, { status: 'pending', analyzed_at: new Date().toISOString() });
  after(async () => {
    try {
      const loaded = await withCtx(me, async (ctx) => {
        const r = await ctx.one<ProjectRequest>('SELECT * FROM project_requests WHERE id = ?', [id]);
        return r && { r, catalog: await loadCatalog(ctx, id) };
      });
      if (!loaded) return;
      const a = await analyzeRequest(loaded.r, loaded.r.ai_coverage, loaded.r.ai_chat ?? [], loaded.catalog);
      await save(me, id, a ?? { status: 'failed', analyzed_at: new Date().toISOString() });
    } catch (e) {
      console.warn('[ai] could not save the request analysis:', e instanceof Error ? e.message : e);
    }
  });
  return true;
}
