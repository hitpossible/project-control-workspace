import { AppError, type Ctx, type Row, inList } from '../db';
import { STAFF_ROLES } from '../perms';
import { notifyEvent } from './common';

/** Comments on internal Tasks / Bugs with @mention notifications */
const MAX_LENGTH = 5000;

type Entity = { project_id: string; label: string; link: string; watchers: (string | null)[] };

async function entityOf(ctx: Ctx, type: string, id: string): Promise<Entity> {
  if (type === 'task') {
    const t = await ctx.one<{ project_id: string; task_no: string; name: string; owner_id: string; reviewer_id: string | null }>(
      'SELECT project_id, task_no, name, owner_id, reviewer_id FROM internal_tasks WHERE id = ?', [id]);
    if (!t) throw new AppError('Task not found', 404);
    return { project_id: t.project_id, label: `${t.task_no} ${t.name}`, link: `/projects/${t.project_id}?tab=internal&task=${id}&panel=comments`, watchers: [t.owner_id, t.reviewer_id] };
  }
  if (type === 'bug') {
    const b = await ctx.one<{ project_id: string; bug_no: string; title: string; assigned_dev_id: string | null; reporter_id: string | null }>(
      'SELECT project_id, bug_no, title, assigned_dev_id, reporter_id FROM bugs WHERE id = ?', [id]);
    if (!b) throw new AppError('Bug not found', 404);
    return { project_id: b.project_id, label: `${b.bug_no} ${b.title}`, link: `/projects/${b.project_id}?tab=qa&bug=${id}&panel=comments`, watchers: [b.assigned_dev_id, b.reporter_id] };
  }
  throw new AppError('Comments are available on tasks and bugs only');
}

/** Only people who can open the internal plan of the project can be mentioned */
async function mentionable(ctx: Ctx, projectId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const [ph, params] = inList(ids);
  const rows = await ctx.q<{ id: string; roles: string[]; member: number }>(
    `SELECT p.id, p.roles,
            EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ? AND m.user_id = p.id
                     AND m.member_role IN ('leader','developer','qa','support','supervisor','manager')) member
       FROM profiles p WHERE p.is_active = 1 AND p.id IN (${ph})`, [projectId, ...params]);
  return rows.filter((r) => Number(r.member) === 1 || r.roles.some((x) => STAFF_ROLES.includes(x))).map((r) => r.id);
}

async function clean(ctx: Ctx, c: Row, projectId: string, author: string) {
  const body = String(c.body ?? '').trim();
  if (!body) throw new AppError('Comment is empty');
  if (body.length > MAX_LENGTH) throw new AppError(`Comment is too long (max ${MAX_LENGTH} characters)`);
  c.body = body;
  const ids = Array.isArray(c.mentions) ? [...new Set(c.mentions.map(String))].filter((id) => id !== author) : [];
  c.mentions = await mentionable(ctx, projectId, ids);
}

const snippet = (s: unknown) => {
  const t = String(s).replace(/\s+/g, ' ');
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
};

async function notify(ctx: Ctx, c: Row, mentioned: string[], withWatchers: boolean) {
  const e = await entityOf(ctx, String(c.entity_type), String(c.entity_id));
  const author = ctx.me?.full_name ?? 'Someone';
  if (mentioned.length) {
    await notifyEvent(ctx, {
      event: 'comment_mention', projectId: e.project_id, explicit: mentioned,
      title: `${author} mentioned you on ${e.label}`, body: snippet(c.body), link: e.link, dedupe: `mention:${c.id}:${mentioned.join(',')}`,
    });
  }
  if (withWatchers) {
    const watchers = e.watchers.filter((u): u is string => !!u && u !== c.created_by && !mentioned.includes(u));
    if (watchers.length) {
      await notifyEvent(ctx, {
        event: 'comment_added', projectId: e.project_id, explicit: watchers,
        title: `${author} commented on ${e.label}`, body: snippet(c.body), link: e.link, dedupe: `comment:${c.id}`,
      });
    }
  }
}

export const commentHooks = {
  async beforeInsert(ctx: Ctx, c: Row) {
    // the entity decides the project (never trust the client's project_id)
    const e = await entityOf(ctx, String(c.entity_type), String(c.entity_id));
    if (c.project_id && c.project_id !== e.project_id) throw new AppError('Comment does not belong to this project');
    c.project_id = e.project_id;
    await clean(ctx, c, e.project_id, String(c.created_by));
  },
  async beforeUpdate(ctx: Ctx, n: Row, o: Row) {
    if (n.project_id !== o.project_id || n.entity_type !== o.entity_type || n.entity_id !== o.entity_id) {
      throw new AppError('A comment cannot be moved to another item', 403);
    }
    await clean(ctx, n, String(o.project_id), String(o.created_by));
    if (n.body !== o.body) n.edited_at = new Date().toISOString();
  },
  afterInsert: (ctx: Ctx, c: Row) => notify(ctx, c, c.mentions as string[], true),
  // edits notify only people newly mentioned
  afterUpdate: (ctx: Ctx, c: Row, o: Row) =>
    notify(ctx, c, (c.mentions as string[]).filter((id) => !(o.mentions as string[]).includes(id)), false),
};
