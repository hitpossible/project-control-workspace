import { withApiUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { updateWorkItem, workItemDetail, workType } from '@/server/work-items';

const target = (params: Record<string, string>) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Not found', 404);
  return { type: workType(params.type), id };
};

const base = (req: Request) => process.env.APP_URL ?? new URL(req.url).origin;

/** One task / bug in full: description, steps, fixes, retests, sub-tasks, comments. Accepts a personal access token. */
export const GET = withApiUser(async (me, req, params) => {
  const { type, id } = target(params);
  return { data: await withCtx(me, (ctx) => workItemDetail(ctx, type, id, base(req))) };
});

/**
 * Update as the user — task: { status?, progress?, comment? }; bug: { action?: 'start_fix' | 'fix_ready', fix_description?, … comment? }.
 * Needs a write-scope token (or the browser session). Returns the item after the change.
 */
export const POST = withApiUser(async (me, req, params) => {
  const { type, id } = target(params);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Send a JSON object');
  return { data: await withCtx(me, (ctx) => updateWorkItem(ctx, type, id, body, base(req))) };
}, { write: true });
