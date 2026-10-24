import 'server-only';
import { AppError, type Ctx } from './db';
import { canManageProject, canViewInternal } from './perms';

export type DiagramRow = { id: number; project_id: number; title: string; created_by: number; updated_at: string };

/** the diagram, when the signed-in user may open it (the project's internal team) — 404 otherwise */
export async function loadDiagram(ctx: Ctx, id: number, lock = false): Promise<DiagramRow> {
  const d = await ctx.one<DiagramRow>(
    `SELECT id, project_id, title, created_by, updated_at FROM project_diagrams WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!d || !(await canViewInternal(ctx, d.project_id))) throw new AppError('Diagram not found', 404);
  return d;
}

export async function canDeleteDiagram(ctx: Ctx, d: DiagramRow) {
  return d.created_by === ctx.uid || canManageProject(ctx, d.project_id);
}

/** short random id of one open editor (browser tab), sent by the client */
export const tabId = (v: unknown) => (typeof v === 'string' && /^[\w-]{6,40}$/.test(v) ? v : null);
