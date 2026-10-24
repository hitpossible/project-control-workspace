'use client';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  AlarmClock, AtSign, BellOff, BellRing, Bug, Check, CheckCheck, CircleCheck, Clock, FileText, Flag, FolderKanban,
  ListChecks, MessageSquare, MonitorSmartphone, Paperclip, Send, TriangleAlert, type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { PageHeader, Tip } from '@/components/common';
import { ListSkeleton, useNewIds } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type DesktopStatus, desktopStatus, setDesktopEnabled } from '@/lib/desktopNotify';
import { day, fmtDateTime } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Notification } from '@/lib/types';
import { cn } from '@/lib/utils';

dayjs.extend(relativeTime);

const RED = '#e2445c', ORANGE = '#fdab3d', GREEN = '#00c875', BLUE = '#579bfc', PURPLE = '#a25ddc', TEAL = '#037f4c';

/** labels: notifications.event.<code> */
type Meta = { icon: LucideIcon; color: string };
const EVENT_META: Record<string, Meta> = {
  comment_mention: { icon: AtSign, color: BLUE },
  comment_added: { icon: MessageSquare, color: BLUE },
  task_assigned: { icon: ListChecks, color: BLUE },
  task_due_tomorrow: { icon: Clock, color: ORANGE },
  task_overdue: { icon: AlarmClock, color: RED },
  activity_delayed: { icon: AlarmClock, color: RED },
  project_need_attention: { icon: TriangleAlert, color: RED },
  project_converted: { icon: FolderKanban, color: GREEN },
  approval_waiting: { icon: FileText, color: ORANGE },
  request_approved: { icon: CircleCheck, color: GREEN },
  request_reject: { icon: FileText, color: RED },
  request_send_back: { icon: FileText, color: ORANGE },
  request_request_more_info: { icon: FileText, color: PURPLE },
  baseline_set: { icon: Flag, color: TEAL },
  baseline_revision_requested: { icon: Flag, color: ORANGE },
  baseline_revision_decided: { icon: Flag, color: TEAL },
  bug_reported: { icon: Bug, color: RED },
  bug_assigned: { icon: Bug, color: BLUE },
  fix_due_tomorrow: { icon: Bug, color: ORANGE },
  fix_overdue: { icon: Bug, color: RED },
  fix_ready: { icon: Bug, color: PURPLE },
  retest_due: { icon: Bug, color: ORANGE },
  retest_failed: { icon: Bug, color: RED },
  bug_closed: { icon: Bug, color: GREEN },
  evidence_missing: { icon: Paperclip, color: '#784bd1' },
};
const metaOf = (code: string): Meta => EVENT_META[code] ?? { icon: BellRing, color: '#8b8fa3' };

const MENTION_EVENTS = ['comment_mention'];

/** labels: notifications.day.<group> */
function dayGroup(ts: string) {
  const d = dayjs(ts);
  if (d.isSame(dayjs(), 'day')) return 'today';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'yesterday';
  if (d.isAfter(dayjs().subtract(7, 'day'), 'day')) return 'week';
  return 'older';
}

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const db = dbClient();
  const router = useRouter();
  const { unread, refreshUnread } = useApp();
  const [rows, setRows] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('unread');
  // rows sliding out after "mark as read" on the Unread tab
  const [leaving, setLeaving] = useState<number[]>([]);

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
    if (tab === 'unread') {
      setLeaving((l) => [...l, ...ids]);
      await new Promise((r) => setTimeout(r, 180));
      setLeaving((l) => l.filter((id) => !ids.includes(id)));
    }
    setRows((rs) => (tab === 'unread' ? rs.filter((r) => !ids.includes(r.id)) : rs.map((r) => (ids.includes(r.id) ? { ...r, is_read: true } : r))));
    refreshUnread();
  };

  const isNew = useNewIds(rows.map((r) => r.id), loaded);

  const groups = useMemo(() => {
    const out: { label: ReturnType<typeof dayGroup>; items: Notification[] }[] = [];
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
        title={t('title')}
        subtitle={unread ? t('unreadCount', { count: unread }) : t('caughtUp')}
        actions={(
          <Button variant="outline" disabled={!unread} onClick={async () => {
            await db.from('notifications').update({ is_read: true }).eq('is_read', false);
            await refreshUnread();
            load();
          }}><CheckCheck /> {t('markAllRead')}</Button>
        )}
      />

      <DesktopNotificationsCard />

      <div className="overflow-clip rounded-xl border bg-white">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line" className="w-full justify-start border-b border-grid px-2">
            <TabsTrigger value="unread" className="flex-none px-3">
              {t('tab.unread')} {unread > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold text-white">{unread}</span>}
            </TabsTrigger>
            <TabsTrigger value="mentions" className="flex-none px-3">{t('tab.mentions')}</TabsTrigger>
            <TabsTrigger value="all" className="flex-none px-3">{t('tab.all')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div key={tab} className="motion-rise">
        {!loaded ? <ListSkeleton /> : rows.length === 0 ? <EmptyList tab={tab} /> : groups.map((g) => (
          <section key={g.label}>
            <div className="sticky top-14 z-10 border-b border-grid bg-muted/60 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
              {t(`day.${g.label}`)}
            </div>
            <ul className="divide-y divide-grid">
              {g.items.map((n) => (
                <NotificationItem key={n.id} n={n} leaving={leaving.includes(n.id)} fresh={isNew(n.id)}
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
    </div>
  );
}

function NotificationItem({ n, leaving, fresh, onOpen, onMarkRead }: {
  n: Notification; leaving: boolean; fresh: boolean; onOpen: () => void; onMarkRead: () => void;
}) {
  const t = useTranslations('notifications');
  const m = metaOf(n.event_code);
  const Icon = m.icon;
  const label = t.has(`event.${n.event_code}` as 'event.bug_closed') ? t(`event.${n.event_code}` as 'event.bug_closed') : n.event_code.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return (
    <li className={cn('group relative flex items-start gap-3 px-4 py-3.5 transition-colors duration-300 hover:bg-muted/50',
      !n.is_read && 'bg-primary/[0.04]', fresh && 'motion-rise', leaving && 'motion-leave pointer-events-none')}>
      <span className={cn('absolute inset-y-0 left-0 w-[3px] origin-top bg-primary transition-transform duration-300', n.is_read && 'scale-y-0')} />
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-200 group-hover:scale-105" style={{ background: `${m.color}1f`, color: m.color }}>
        <Icon className="size-[18px]" />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
        <div className={cn('text-sm leading-snug', n.is_read ? 'text-foreground/80' : 'font-semibold text-foreground')}>{n.title}</div>
        {n.body && (
          <div className="mt-1 line-clamp-2 rounded-md bg-muted/70 px-2.5 py-1.5 text-[13px] text-muted-foreground">{n.body}</div>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium" style={{ color: m.color }}>{label}</span>
          <span>·</span>
          <span title={fmtDateTime(n.created_at)}>{day(n.created_at).fromNow()}</span>
        </div>
      </button>
      {!n.is_read && (
        <Tip title={t('markRead')}>
          <Button variant="ghost" size="icon" aria-label={t('markRead')} className="size-8 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={onMarkRead}>
            <Check />
          </Button>
        </Tip>
      )}
    </li>
  );
}

function EmptyList({ tab }: { tab: string }) {
  const t = useTranslations('notifications.empty');
  const key = tab === 'unread' || tab === 'mentions' ? tab : 'all';
  const [title, text] = [t(`${key}.title`), t(`${key}.text`)];
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="motion-rise mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><CheckCheck className="size-6" /></span>
      <div className="font-medium">{title}</div>
      <div className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</div>
    </div>
  );
}

function DesktopNotificationsCard() {
  const t = useTranslations('notifications.desktop');
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
    const d = new Notification(t('testTitle'), { body: t('testBody'), icon: '/brand/logo.png', tag: 'pcw-test' });
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
        <div className="text-sm font-semibold">{t('title')}</div>
        <div className={cn('text-[13px]', usable ? 'text-muted-foreground' : 'text-[#c4314b]')}>{t(`status.${status}`)}</div>
      </div>
      <div className="flex items-center gap-3">
        {status === 'on' && <Button variant="outline" size="sm" onClick={sendTest}><Send /> {t('sendTest')}</Button>}
        <Switch checked={status === 'on'} disabled={!usable} aria-label={t('title')}
          onCheckedChange={async (on) => setStatus(await setDesktopEnabled(on))} />
      </div>
    </div>
  );
}
