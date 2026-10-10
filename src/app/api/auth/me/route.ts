import { withUser } from '@/server/api';

export const GET = withUser(async (me) => ({ data: me }));
