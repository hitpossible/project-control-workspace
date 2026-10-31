import { myAgenda } from '@/server/agenda';
import { withApiUser } from '@/server/api';

/** My open tasks, bugs and retests relative to ?date=YYYY-MM-DD (default today). Accepts a personal access token. */
export const GET = withApiUser(async (me, req) => {
  const url = new URL(req.url);
  return { data: await myAgenda(me, url.searchParams.get('date'), url.origin) };
});
