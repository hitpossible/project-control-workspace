import { NextResponse } from 'next/server';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { publishDiagram } from '@/server/diagram-bus';
import { canDeleteDiagram, loadDiagram, tabId } from '@/server/diagrams';

const MAX_CONTENT = 2_000_000;

/** The latest saved version — an open editor pulls it when someone else saved, and merges it with its own edits */
export const GET = withUser(async (me, _req, params) => {
  const id = Number(params.id);
  return withCtx(me, async (ctx) => {
    await loadDiagram(ctx, id);
    return { data: await ctx.one('SELECT title, content, updated_at FROM project_diagrams WHERE id = ?', [id]) };
  });
});

/**
 * Save a diagram. `base` is the updated_at the editor started from: when someone saved in between, the save is
 * refused with 409 and who / when, unless `force` (the user chose to overwrite). Other open editors are told.
 */
export const PUT = withUser(async (me, req, params) => {
  const id = Number(params.id);
  const body = (await req.json().catch(() => ({}))) as { title?: unknown; content?: unknown; base?: unknown; force?: unknown; tab?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const content = JSON.stringify(body.content ?? null);
  const c = body.content as { nodes?: unknown; edges?: unknown } | null;
  if (!title || !c || !Array.isArray(c.nodes) || !Array.isArray(c.edges)) throw new AppError('title and content are required');
  if (content.length > MAX_CONTENT) throw new AppError('The diagram is too large');

  const out = await withCtx(me, async (ctx) => {
    const d = await loadDiagram(ctx, id, true);
    if (body.force !== true && body.base !== d.updated_at) {
      const by = await ctx.val<string>('SELECT p.full_name FROM project_diagrams d JOIN profiles p ON p.id = COALESCE(d.updated_by, d.created_by) WHERE d.id = ?', [id]);
      return { conflict: { updated_at: d.updated_at, name: by ?? '' } };
    }
    await ctx.exec('UPDATE project_diagrams SET title = ?, content = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [title, content, me.id, id]);
    const updated_at = (await ctx.val<string>('SELECT updated_at FROM project_diagrams WHERE id = ?', [id]))!;
    ctx.onCommit(() => publishDiagram(id, { type: 'saved', tab: tabId(body.tab) ?? '', userId: me.id, name: me.full_name, updated_at, title }));
    return { updated_at };
  });
  if ('conflict' in out) return NextResponse.json({ error: { message: 'Saved by someone else', status: 409 }, data: out.conflict }, { status: 409 });
  return { data: out };
});

/** Delete a diagram (its author or the project leader); open editors are told it is gone */
export const DELETE = withUser(async (me, _req, params) => {
  const id = Number(params.id);
  await withCtx(me, async (ctx) => {
    const d = await loadDiagram(ctx, id, true);
    if (!(await canDeleteDiagram(ctx, d))) throw new AppError('Only the author or the project leader can delete this diagram', 403);
    await ctx.exec('DELETE FROM project_diagrams WHERE id = ?', [id]);
    ctx.onCommit(() => publishDiagram(id, { type: 'deleted', userId: me.id, name: me.full_name }));
  });
  return { data: null };
});
