'use client';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  AlarmClock, AtSign, BellOff, BellRing, Bug, Check, CheckCheck, CircleCheck, Clock, FileText, Flag, FolderKanban,
  ListChecks, MessageSquare, MonitorSmartphone, Paperclip, Send, TriangleAlert, type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { PageHeader, Tip } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type DesktopStatus, desktopStatus, setDesktopEnabled } from '@/lib/desktopNotify';
import { fmtDateTime } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Notification } from '@/lib/types';
import { cn } from '@/lib/utils';

dayjs.extend(relativeTime);

const RED = '#e2445c', ORANGE = '#fdab3d', GREEN = '#00c875', BLUE = '#579bfc', PURPLE = '#a25ddc', TEAL = '#037f4c';

type Meta = { label: string; icon: LucideIcon; color: string };
const EVENT_META: Record<string, Meta> = {
  comment_mention: { label: 'Mention', icon: AtSign, color: BLUE },
  comment_added: { label: 'Comment', icon: MessageSquare, color: BLUE },
  task_assigned: { label: 'Task assigned', icon: ListChecks, color: BLUE },
  task_due_tomorrow: { label: 'Due tomorrow', icon: Clock, color: ORANGE },
  task_overdue: { label: 'Task overdue', icon: AlarmClock, color: RED },
  activity_delayed: { label: 'Delayed', icon: AlarmClock, color: RED },
  project_need_attention: { label: 'Needs attention', icon: TriangleAlert, color: RED },
  project_converted: { label: 'Project created', icon: FolderKanban, color: GREEN },
  approval_waiting: { label: 'Approval', icon: FileText, color: ORANGE },
  request_approved: { label: 'Request approved', icon: CircleCheck, color: GREEN },
  request_reject: { label: 'Request rejected', icon: FileText, color: RED },
  request_send_back: { label: 'Sent back', icon: FileText, color: ORANGE },
  request_request_more_info: { label: 'More info needed', icon: FileText, color: PURPLE },
  baseline_set: { label: 'Baseline', icon: Flag, color: TEAL },
  baseline_revision_requested: { label: 'Baseline revision', icon: Flag, color: ORANGE },
  baseline_revision_decided: { label: 'Baseline revision', icon: Flag, color: TEAL },
  bug_reported: { label: 'Bug reported', icon: Bug, color: RED },
  bug_assigned: { label: 'Bug assigned', icon: Bug, color: BLUE },
  fix_due_tomorrow: { label: 'Fix due tomorrow', icon: Bug, color: ORANGE },
  fix_overdue: { label: 'Fix overdue', icon: Bug, color: RED },
  fix_ready: { label: 'Ready to retest', icon: Bug, color: PURPLE },
  retest_due: { label: 'Retest due', icon: Bug, color: ORANGE },
  retest_failed: { label: 'Retest failed', icon: Bug, color: RED },
  bug_closed: { label: 'Bug closed', icon: Bug, color: GREEN },
  evidence_missing: { label: 'Evidence missing', icon: Paperclip, color: '#784bd1' },
};
const metaOf = (code: string): Meta =>
  EVENT_META[code] ?? { label: code.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), icon: BellRing, color: '#8b8fa3' };

const MENTION_EVENTS = ['comment_mention'];

function dayGroup(ts: string): string {
  const d = dayjs(ts);
  if (d.isSame(dayjs(), 'day')) return 'Today';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  if (d.isAfter(dayjs().subtract(7, 'day'), 'day')) return 'This week';
  return 'Older';
}

export default function NotificationsPage() {
  const db = dbClient();
  const router = useRouter();
  const { unread, refreshUnread } = useApp();
  const [rows, setRows] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('unread');

  const load = useCallback(async () => {
    let q = db.from('notifications').select('*').order('created_at', { ascending: false }).limit(300);
    if (tab === 'unread') q = q.eq('is_read', false);
    if (tab === 'mentions') q = q.in('event_code', MENTION_EVENTS);
    const { data } = await q;
    setRows((data ?? []) as Notification[]);
    setLoaded(true);
  }, [db, tab]);

  // reload when the tab changes and when a live notification moves the unread count
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load, unread]);

  const markRead = async (ids: number[]) => {
    if (!ids.length) return;
    await db.from('notifications').update({ is_read: true }).in('id', ids);
    setRows((rs) => (tab === 'unread' ? rs.filter((r) => !ids.includes(r.id)) : rs.map((r) => (ids.includes(r.id) ? { ...r, is_read: true } : r))));
    refreshUnread();
  };

  const groups = useMemo(() => {
    const out: { label: string; items: Notification[] }[] = [];
    for (const n of rows) {
      const label = dayGroup(n.created_at);
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1)!.items.push(n);
    }
    return out;
  }, [rows]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Notifications"
        subtitle={unread ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}` : 'You are all caught up'}
        actions={(
          <Button variant="outline" disabled={!unread} onClick={async () => {
            await db.from('notifications').update({ is_read: true }).eq('is_read', false);
            await refreshUnread();
            load();
          }}><CheckCheck /> Mark all read</Button>
        )}
      />

      <DesktopNotificationsCard />

      <div className="overflow-clip rounded-xl border bg-white">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line" className="w-full justify-start border-b border-grid px-2">
            <TabsTrigger value="unread" className="flex-none px-3">
              Unread {unread > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold text-white">{unread}</span>}
            </TabsTrigger>
            <TabsTrigger value="mentions" className="flex-none px-3">Mentions</TabsTrigger>
            <TabsTrigger value="all" className="flex-none px-3">All</TabsTrigger>
          </TabsList>
        </Tabs>

        {loaded && rows.length === 0 ? <EmptyList tab={tab} /> : groups.map((g) => (
          <section key={g.label}>
            <div className="sticky top-14 z-10 border-b border-grid bg-muted/60 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
              {g.label}
            </div>
            <ul className="divide-y divide-grid">
              {g.items.map((n) => (
                <NotificationItem key={n.id} n={n}
                  onOpen={async () => {
                    if (!n.is_read) await markRead([n.id]);
                    if (n.link) router.push(n.link);
                  }}
                  onMarkRead={() => markRead([n.id])} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function NotificationItem({ n, onOpen, onMarkRead }: { n: Notification; onOpen: () => void; onMarkRead: () => void }) {
  const m = metaOf(n.event_code);
  const Icon = m.icon;
  return (
    <li className={cn('group relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50', !n.is_read && 'bg-primary/[0.04]')}>
      {!n.is_read && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full" style={{ background: `${m.color}1f`, color: m.color }}>
        <Icon className="size-[18px]" />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
        <div className={cn('text-sm leading-snug', n.is_read ? 'text-foreground/80' : 'font-semibold text-foreground')}>{n.title}</div>
        {n.body && (
          <div className="mt-1 line-clamp-2 rounded-md bg-muted/70 px-2.5 py-1.5 text-[13px] text-muted-foreground">{n.body}</div>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium" style={{ color: m.color }}>{m.label}</span>
          <span>·</span>
          <span title={fmtDateTime(n.created_at)}>{dayjs(n.created_at).fromNow()}</span>
        </div>
      </button>
      {!n.is_read && (
        <Tip title="Mark as read">
          <Button variant="ghost" size="icon" aria-label="Mark as read" className="size-8 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={onMarkRead}>
            <Check />
          </Button>
        </Tip>
      )}
    </li>
  );
}

function EmptyList({ tab }: { tab: string }) {
  const [title, text] = tab === 'unread' ? ['No unread notifications', 'New activity on your projects, tasks and requests will show up here.']
    : tab === 'mentions' ? ['No mentions yet', 'When someone @mentions you in a comment, it will show up here.']
      : ['No notifications', 'Nothing has happened yet.'];
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><CheckCheck className="size-6" /></span>
      <div className="font-medium">{title}</div>
      <div className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</div>
    </div>
  );
}

const STATUS_TEXT: Record<DesktopStatus, string> = {
  on: 'On — a pop-up appears on your screen when a notification arrives while this tab is in the background.',
  off: 'Off — you only see notifications inside the app.',
  ask: 'Get a pop-up on your screen for new notifications, even while you work in another tab.',
  blocked: 'Blocked by your browser. Click the lock icon next to the address bar → Notifications → Allow, then reload this page.',
  unsupported: 'Not available here. Browsers only allow desktop notifications over HTTPS (or on localhost).',
};

function DesktopNotificationsCard() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state
    setStatus(desktopStatus());
    // permission may change in the browser's site settings while the page is open
    const sync = () => setStatus(desktopStatus());
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  if (!status) return null;
  const usable = status !== 'blocked' && status !== 'unsupported';
  const sendTest = () => {
    const d = new Notification('Test notification', { body: 'Desktop notifications are working.', icon: '/brand/logo.png', tag: 'pcw-test' });
    d.onclick = () => {
      window.focus();
      d.close();
    };
  };

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', status === 'on' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
        {usable ? <MonitorSmartphone className="size-5" /> : <BellOff className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Desktop notifications</div>
        <div className={cn('text-[13px]', usable ? 'text-muted-foreground' : 'text-[#c4314b]')}>{STATUS_TEXT[status]}</div>
      </div>
      <div className="flex items-center gap-3">
        {status === 'on' && <Button variant="outline" size="sm" onClick={sendTest}><Send /> Send test</Button>}
        <Switch checked={status === 'on'} disabled={!usable} aria-label="Desktop notifications"
          onCheckedChange={async (on) => setStatus(await setDesktopEnabled(on))} />
      </div>
    </div>
  );
}
