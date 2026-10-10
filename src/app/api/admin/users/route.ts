import { withUser } from '@/server/api';
import { hashPassword } from '@/server/auth';
import { AppError, uuid, withCtx } from '@/server/db';
import { insertRow } from '@/server/engine';

const ROLES = ['requestor', 'requestor_approver', 'system_reviewer', 'authority_approver', 'project_leader', 'developer', 'qa', 'supervisor', 'manager', 'management_view', 'admin'];

function validRoles(roles: unknown): string[] {
  const list = Array.isArray(roles) && roles.length ? roles.map(String) : ['requestor'];
  const bad = list.filter((r) => !ROLES.includes(r));
  if (bad.length) throw new AppError(`Unknown role(s): ${bad.join(', ')}`);
  return list;
}

/**
 * Admin: create a user. With AD login a username is enough (password optional);
 * a password creates a local account (break-glass / no AD).
 */
export const POST = withUser(async (me, req) => {
  if (!me.roles.includes('admin')) throw new AppError('Administrator only', 403);
  const b = await req.json();
  if (!b.full_name || (!b.username && !b.email)) throw new AppError('Full name and a username (AD) or e-mail are required');
  if (b.password && String(b.password).length < 8) throw new AppError('Password must be at least 8 characters');
  return withCtx(me, async (ctx) => {
    const row = await insertRow(ctx, 'profiles', {
      id: uuid(), username: b.username?.trim() || null, email: b.email?.trim() || null, full_name: b.full_name, employee_id: b.employee_id ?? null,
      department: b.department ?? null, section: b.section ?? null, telephone: b.telephone ?? null, extension: b.extension ?? null,
      roles: validRoles(b.roles), is_active: b.is_active ?? true, password_hash: b.password ? await hashPassword(String(b.password)) : null,
    });
    return { id: row.id };
  });
});

/** Admin: set / clear a local password */
export const PATCH = withUser(async (me, req) => {
  if (!me.roles.includes('admin')) throw new AppError('Administrator only', 403);
  const b = await req.json();
  if (!b.id) throw new AppError('id is required');
  if (b.password && String(b.password).length < 8) throw new AppError('Password must be at least 8 characters');
  return withCtx(me, async (ctx) => {
    const res = await ctx.exec('UPDATE profiles SET password_hash = ? WHERE id = ?', [b.password ? await hashPassword(String(b.password)) : null, b.id]);
    if (!res.affectedRows) throw new AppError('User not found', 404);
    return { data: true };
  });
});
