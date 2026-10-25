'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { createElement, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { handleUnauthorized } from '@/lib/db/client';
import { ASKED_KEY, desktopStatus, setDesktopEnabled, showDesktop } from '@/lib/desktopNotify';

type LiveNotification = { id: number; title: string; body: string | null; link: string | null };

/**
 * Live notifications over SSE (/api/notifications/stream): refreshes the unread badge, shows a toast,
 * and — when the tab is in the background and desktop notifications are on — an OS notification.
 */
export function useLiveNotifications(enabled: boolean, onNotification: () => void) {
  const router = useRouter();
  const t = useTranslations('notifications.live');
  // latest callbacks without reopening the stream
  const handler = useRef(onNotification);
  const nav = useRef(router);
  const tr = useRef(t);
  useEffect(() => {
    handler.current = onNotification;
    nav.current = router;
    tr.current = t;
  });

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/notifications/stream');
    es.addEventListener('notification', (ev) => {
      const n = JSON.parse((ev as MessageEvent<string>).data) as LiveNotification;
      handler.current();
      const open = n.link ? () => nav.current.push(n.link!) : undefined;
      toast(n.title, {
        toasterId: 'live',
        icon: createElement(Bell, { className: 'size-4 text-primary' }),
        description: n.body ?? undefined,
        duration: 8000,
        action: open ? { label: tr.current('open'), onClick: open } : undefined,
      });
      // tag collapses the same notification arriving in several open tabs
      if (document.hidden) showDesktop({ title: n.title, body: n.body, tag: `pcw-${n.id}`, onClick: open });
    });
    // the session was revoked / expired while the page was open (sign out everywhere, admin force sign-out)
    es.addEventListener('signed-out', () => {
      es.close();
      void handleUnauthorized();
    });
    return () => es.close();
  }, [enabled]);

  // Browsers only allow the permission prompt from a user gesture, so offer it once via a toast button.
  // Later changes go through the switch on the Notifications page.
  useEffect(() => {
    if (!enabled || desktopStatus() !== 'ask' || localStorage.getItem(ASKED_KEY)) return;
    const timer = setTimeout(() => {
      toast(tr.current('askTitle'), {
        toasterId: 'live',
        description: tr.current('askText'),
        duration: Infinity,
        action: { label: tr.current('enable'), onClick: () => void setDesktopEnabled(true) },
        cancel: { label: tr.current('notNow'), onClick: () => localStorage.setItem(ASKED_KEY, '1') },
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [enabled]);
}
