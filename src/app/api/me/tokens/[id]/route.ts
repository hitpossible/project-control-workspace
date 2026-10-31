import { withUser } from '@/server/api';
import { revokeToken } from '@/server/api-tokens';
import { AppError } from '@/server/db';

export const DELETE = withUser(async (me, _req, params) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new AppError('Token not found', 404);
  await revokeToken(me.id, id);
  return { data: true };
});
