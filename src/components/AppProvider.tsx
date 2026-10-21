'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { canActOnStep } from '@/lib/approval';
import { SYSTEM_STAFF_ROLES } from '@/lib/constants';
import { dbClient, handleUnauthorized } from '@/lib/db/client';
import type { ApprovalStep, Profile, Role } from '@/lib/types';

interface AppCtx {
  me: Profile | null;
  profiles: Profile[];
  profileName: (id: number | null | undefined) => string;
  hasRole: (...roles: Role[]) => boolean;
  isStaff: boolean;
  notify: (message: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;
  refreshProfiles: () => Promise<void>;
  unread: number;
  /** requests waiting for my approval (same rule as the Waiting My Action tab) */
  pendingApprovals: number;
  refreshUnread: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be used inside AppProvider');
  return c;
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const db = dbClient();
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState(0);
  const [waitingSteps, setWaitingSteps] = useState<{ steps: ApprovalStep[]; requestor: Map<number, number> }>({ steps: [], requestor: new Map() });

  const refreshProfiles = useCallback(async () => {
    const [auth, { data }] = await Promise.all([
      fetch('/api/auth/me').then((r) => {
        if (r.status === 401) void handleUnauthorized();
        return r.ok ? r.json() : { data: null };
      }).catch(() => ({ data: null })),
      db.from('profiles').select('*').order('full_name'),
    ]);
    // profiles store ids — add the names the UI shows
    const [d, s, p] = await Promise.all([db.from('departments').select('id,name'), db.from('sections').select('id,name'), db.from('positions').select('id,name')]);
    const names = (rows: { id: number; name: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
    const [dn, sn, pn] = [names(d.data), names(s.data), names(p.data)];
    const list = ((data ?? []) as Profile[]).map((x) => ({
      ...x, department: dn.get(x.department_id!) ?? null, section: sn.get(x.section_id!) ?? null, position: pn.get(x.position_id!) ?? null,
    }));
    setProfiles(list);
    setMe(list.find((p) => p.id === auth.data?.id) ?? null);
  }, [db]);

  const refreshUnread = useCallback(async () => {
    const { count } = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false);
    setUnread(count ?? 0);
    const { data: steps } = await db.from('approval_steps').select('*').eq('status', 'waiting');
    const ids = [...new Set(((steps ?? []) as ApprovalStep[]).map((x) => x.request_id))];
    const { data: reqs } = ids.length ? await db.from('project_requests').select('id,requestor_id').in('id', ids) : { data: [] };
    setWaitingSteps({
      steps: (steps ?? []) as ApprovalStep[],
      requestor: new Map(((reqs ?? []) as { id: number; requestor_id: number }[]).map((r) => [r.id, r.requestor_id])),
    });
  }, [db]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    refreshProfiles();
    refreshUnread();
    const t = setInterval(refreshUnread, 30000);
    return () => clearInterval(t);
  }, [refreshProfiles, refreshUnread]);

  const value = useMemo<AppCtx>(() => {
    const roles = me?.roles ?? [];
    const hasRole = (...r: Role[]) => roles.includes('admin') || r.some((x) => roles.includes(x));
    return {
      me,
      profiles,
      profileName: (id) => (id ? profiles.find((p) => p.id === id)?.full_name ?? '—' : '-'),
      hasRole,
      isStaff: roles.some((r) => SYSTEM_STAFF_ROLES.includes(r)),
      notify: (message, severity = 'success') => toast[severity](message, { duration: severity === 'error' ? 8000 : 3500 }),
      refreshProfiles,
      unread,
      pendingApprovals: new Set(waitingSteps.steps.filter((x) => canActOnStep(x, me, waitingSteps.requestor.get(x.request_id))).map((x) => x.request_id)).size,
      refreshUnread,
      signOut: async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.replace('/login');
        router.refresh();
      },
    };
  }, [me, profiles, unread, waitingSteps, refreshProfiles, refreshUnread, router]);

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

/** Fire-and-forget: deliver queued e-mail notifications (Mailpit in local dev) */
export function dispatchEmails() {
  fetch('/api/notifications/dispatch', { method: 'POST' }).catch(() => undefined);
}
