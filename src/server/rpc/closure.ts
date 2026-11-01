import type { Project } from '@/lib/types';
import { AppError, type Ctx } from '../db';
import { getRow, insertRow, updateRow } from '../engine';
import { notifyEvent } from '../logic/common';
import { assertCanComplete } from '../logic/project';
import { canManageProject } from '../perms';
import { getObjectBuffer, putObject, removeObject } from '../storage';

/**
 * Closure sign-off for projects that came from a request: the leader sends the delivery for acceptance,
 * the requestor (or a requestor representative on the team) accepts — which completes the project — or asks for changes.
 */
export type Closure = {
  id: number; project_id: number; round_no: number; summary: string; status: 'pending' | 'accepted' | 'changes_requested' | 'withdrawn';
  requested_by: number; requested_at: string; decided_by: number | null; decided_at: string | null; decision_comment: string | null; signature_path: string | null;
};

const blank = (s: unknown) => !s || String(s).trim() === '';
const MAX = 4000;
const link = (pid: number) => `/projects/${pid}?tab=overview`;

async function project(ctx: Ctx, id: number): Promise<Project> {
  const p = (await getRow(ctx, 'projects', id, true)) as unknown as Project | null;
  if (!p) throw new AppError('Project not found', 404);
  return p;
}

async function lockClosure(ctx: Ctx, id: number): Promise<Closure> {
  const c = await ctx.one<Closure>('SELECT * FROM project_closures WHERE id = ? FOR UPDATE', [id]);
  if (!c) throw new AppError('Closure not found', 404);
  return c;
}

/** People who may accept: the requestor of the request + requestor representatives on the team */
export async function closureAcceptors(ctx: Ctx, p: Pick<Project, 'id' | 'request_id'>): Promise<number[]> {
  const ids = new Set<number>();
  if (p.request_id) {
    const r = await ctx.val<number>('SELECT requestor_id FROM project_requests WHERE id = ?', [p.request_id]);
    if (r) ids.add(r);
  }
  for (const m of await ctx.q<{ user_id: number }>(`SELECT user_id FROM project_members WHERE project_id = ? AND member_role = 'requestor_rep'`, [p.id])) ids.add(m.user_id);
  return [...ids];
}

export async function requestClosure(ctx: Ctx, a: { p_project_id: number; p_summary: string }) {
  const p = await project(ctx, a.p_project_id);
  if (!(await canManageProject(ctx, p.id))) throw new AppError('Only the Project Leader can send the project for acceptance', 403);
  if (!p.request_id) throw new AppError('This project has no request — close it directly');
  if (['completed', 'cancelled'].includes(p.status)) throw new AppError(`The project is already ${p.status}`);
  if (blank(a.p_summary)) throw new AppError('Summarise what is being handed over');
  if (String(a.p_summary).length > MAX) throw new AppError(`Summary is too long (max ${MAX} characters)`);
  if (await ctx.val(`SELECT 1 FROM project_closures WHERE project_id = ? AND status = 'pending' LIMIT 1`, [p.id])) {
    throw new AppError('This project is already waiting for acceptance');
  }
  await assertCanComplete(ctx, p.id);
  const acceptors = await closureAcceptors(ctx, p);
  if (!acceptors.length) throw new AppError('Nobody can accept this project: the requestor is missing — add a requestor representative to the team');

  const round = Number(await ctx.val('SELECT COALESCE(MAX(round_no), 0) + 1 FROM project_closures WHERE project_id = ?', [p.id]));
  const c = await ctx.asWorkflow(() => insertRow(ctx, 'project_closures', {
    project_id: p.id, round_no: round, summary: String(a.p_summary).trim(), requested_by: ctx.uid,
  }));
  await notifyEvent(ctx, {
    event: 'closure_requested', projectId: p.id, requestId: p.request_id, explicit: acceptors,
    title: `Please accept the delivery: ${p.project_code}`,
    body: `${p.project_name} is ready to close. Review the handover and accept it or ask for changes.`,
    link: link(p.id), dedupe: `closure_requested:${c.id}`,
  });
  return c;
}

export async function decideClosure(ctx: Ctx, a: { p_closure_id: number; p_accept: boolean; p_comment?: string | null }) {
  const c = await lockClosure(ctx, a.p_closure_id);
  if (c.status !== 'pending') throw new AppError(`This closure is already ${c.status.replace('_', ' ')}`);
  const p = await project(ctx, c.project_id);
  if (!(await closureAcceptors(ctx, p)).includes(ctx.uid ?? -1)) throw new AppError('Only the requestor (or a requestor representative) can accept the delivery', 403);
  // a leader who is also on the team as requestor representative cannot sign off their own delivery
  if (c.requested_by === ctx.uid) throw new AppError('You sent this delivery for acceptance — the requestor (or another representative) has to decide on it', 403);
  const comment = blank(a.p_comment) ? null : String(a.p_comment).trim();
  if (comment && comment.length > MAX) throw new AppError(`Comment is too long (max ${MAX} characters)`);
  const now = new Date().toISOString();

  if (!a.p_accept) {
    if (!comment) throw new AppError('Say what still needs to change');
    const r = await ctx.asWorkflow(() => updateRow(ctx, 'project_closures', c.id, { status: 'changes_requested', decided_by: ctx.uid, decided_at: now, decision_comment: comment }));
    await notifyEvent(ctx, {
      event: 'closure_changes_requested', projectId: p.id, requestId: p.request_id, explicit: [c.requested_by],
      title: `Changes requested before closing: ${p.project_code}`, body: comment, link: link(p.id), dedupe: `closure_changes:${c.id}`,
    });
    return r;
  }

  // the state may have moved since the leader sent it (a reopened activity, a new critical bug)
  await assertCanComplete(ctx, p.id);
  const sig = await ctx.val<string>('SELECT signature_path FROM profiles WHERE id = ?', [ctx.uid]);
  if (!sig) throw new AppError('Set up your signature first (My profile → My signature)');
  // the signature as it was at acceptance — a later change of "My signature" does not alter this record
  const key = `closures/project-${p.id}/round-${c.round_no}-signature.png`;
  await putObject(key, await getObjectBuffer(sig), 'image/png');
  try {
    return await ctx.asWorkflow(async () => {
      const r = await updateRow(ctx, 'project_closures', c.id, { status: 'accepted', decided_by: ctx.uid, decided_at: now, decision_comment: comment, signature_path: key });
      // the projects afterUpdate hook tells the requestor and the team
      await updateRow(ctx, 'projects', p.id, { status: 'completed' });
      return r;
    });
  } catch (e) {
    // the transaction rolls back: do not leave the copied signature behind
    await removeObject(key).catch(() => undefined);
    throw e;
  }
}

export async function withdrawClosure(ctx: Ctx, a: { p_closure_id: number }) {
  const c = await lockClosure(ctx, a.p_closure_id);
  if (!(await canManageProject(ctx, c.project_id))) throw new AppError('Only the Project Leader can withdraw it', 403);
  if (c.status !== 'pending') throw new AppError(`This closure is already ${c.status.replace('_', ' ')}`);
  return ctx.asWorkflow(() => updateRow(ctx, 'project_closures', c.id, { status: 'withdrawn' }));
}
