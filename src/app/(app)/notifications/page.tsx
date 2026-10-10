'use client';

import { CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EmptyState, PageHeader, labelText } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtDateTime } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Notification } from '@/lib/types';
import { cn } from '@/lib/utils';

const EVENT_COLOR: Record<string, string> = {
  task_overdue: '#e2445c', project_need_attention: '#e2445c', activity_delayed: '#e2445c', request_reject: '#e2445c',
  task_due_tomorrow: '#fdab3d', approval_waiting: '#fdab3d', request_request_more_info: '#a25ddc', request_send_back: '#fdab3d',
  request_approved: '#00c875', project_converted: '#00c875', baseline_set: '#037f4c', task_assigned: '#579bfc',
  bug_reported: '#e2445c', bug_assigned: '#579bfc', fix_due_tomorrow: '#fdab3d', fix_overdue: '#e2445c', fix_ready: '#a25ddc',
  retest_due: '#fdab3d', retest_failed: '#e2445c', bug_closed: '#00c875', evidence_missing: '#784bd1',
  baseline_revision_requested: '#fdab3d', baseline_revision_decided: '#037f4c',
};

export default function NotificationsPage() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const { refreshUnread } = useApp();
  const [rows, setRows] = useState<Notification[]>([]);
  const [tab, setTab] = useState('unread');

  const load = useCallback(async () => {
    let q = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(300);
    if (tab === 'unread') q = q.eq('is_read', false);
    const { data } = await q;
    setRows((data ?? []) as Notification[]);
    refreshUnread();
  }, [supabase, tab, refreshUnread]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="In-app notifications (also delivered by e-mail according to Notification Rules)"
        actions={<Button variant="outline" onClick={async () => { await supabase.from('notifications').update({ is_read: true }).eq('is_read', false); load(); }}><CheckCheck /> Mark all read</Button>}
      />
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList variant="line" className="w-full justify-start border-b border-grid">
          <TabsTrigger value="unread" className="flex-none px-3">Unread</TabsTrigger>
          <TabsTrigger value="all" className="flex-none px-3">All</TabsTrigger>
        </TabsList>
      </Tabs>
      {rows.length === 0 ? <EmptyState text="No notifications" /> : (
        <div className="divide-y divide-grid overflow-hidden rounded-lg border border-grid">
          {rows.map((n) => {
            const c = EVENT_COLOR[n.event_code] ?? '#c4c4c4';
            return (
              <button key={n.id} type="button"
                className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-muted', !n.is_read && 'bg-[#f0f7ff]')}
                onClick={async () => {
                  if (!n.is_read) await supabase.from('notifications').update({ is_read: true }).eq('id', n.id);
                  if (n.link) router.push(n.link); else load();
                }}>
                {!n.is_read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded px-2 py-0.5 text-[11px] font-medium capitalize" style={{ background: c, color: labelText(c) }}>{n.event_code.replace(/_/g, ' ')}</span>
                    <span className={cn('text-sm', !n.is_read && 'font-semibold')}>{n.title}</span>
                  </div>
                  {n.body && <div className="mt-0.5 text-sm text-muted-foreground">{n.body}</div>}
                  <div className="text-xs text-muted-foreground">{fmtDateTime(n.created_at)}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
