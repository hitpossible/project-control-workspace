'use client';

import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { createElement, useEffect, useRef } from 'react';
import { toast } from 'sonner';

type LiveNotification = { id: number; title: string; body: string | null; link: string | null };

const ASKED_KEY = 'pcw:desktop-notify-asked';

const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Live notifications over SSE (/api/notifications/stream): refreshes the unread badge, shows a toast,
 * and — when the tab is in the background and the user allowed it — a desktop notification.
 */
export function useLiveNotifications(enabled: boolean, onNotification: () => void) {
  const router = useRouter();
  // latest callbacks without reopening the stream
  const handler = useRef(onNotification);
  const nav = useRef(router);
  useEffect(() => {
    handler.current = onNotification;
    nav.current = router;
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
        action: open ? { label: 'Open', onClick: open } : undefined,
      });
      if (document.hidden && desktopSupported() && Notification.permission === 'granted') {
        // tag collapses the same notification arriving in several open tabs
        const d = new Notification(n.title, { body: n.body ?? undefined, tag: `pcw-${n.id}`, icon: '/brand/logo.png' });
        d.onclick = () => {
          window.focus();
          open?.();
          d.close();
        };
      }
    });
    return () => es.close();
  }, [enabled]);

  // Browsers only allow the permission prompt from a user gesture, so offer it once via a toast button.
  useEffect(() => {
    if (!enabled || !desktopSupported() || Notification.permission !== 'default' || localStorage.getItem(ASKED_KEY)) return;
    const t = setTimeout(() => {
      toast('Get desktop notifications?', {
        toasterId: 'live',
        description: 'Show a pop-up for new notifications while this tab is in the background.',
        duration: Infinity,
        action: {
          label: 'Enable',
          onClick: () => {
            localStorage.setItem(ASKED_KEY, '1');
            void Notification.requestPermission();
          },
        },
        cancel: { label: 'Not now', onClick: () => localStorage.setItem(ASKED_KEY, '1') },
      });
    }, 3000);
    return () => clearTimeout(t);
  }, [enabled]);
}
