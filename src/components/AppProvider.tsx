'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SYSTEM_STAFF_ROLES } from '@/lib/constants';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Profile, Role } from '@/lib/types';

interface AppCtx {
  me: Profile | null;
  profiles: Profile[];
  profileName: (id: string | null | undefined) => string;
  hasRole: (...roles: Role[]) => boolean;
  isStaff: boolean;
  notify: (message: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;
  refreshProfiles: () => Promise<void>;
  unread: number;
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
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [unread, setUnread] = useState(0);

  const refreshProfiles = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const { data } = await supabase.from('profiles').select('*').order('full_name');
    const list = (data ?? []) as Profile[];
    setProfiles(list);
    setMe(list.find((p) => p.id === auth.user?.id) ?? null);
  }, [supabase]);

  const refreshUnread = useCallback(async () => {
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false);
    setUnread(count ?? 0);
  }, [supabase]);

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
      refreshUnread,
      signOut: async () => {
        await supabase.auth.signOut();
        router.replace('/login');
        router.refresh();
      },
    };
  }, [me, profiles, unread, refreshProfiles, refreshUnread, supabase, router]);

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
