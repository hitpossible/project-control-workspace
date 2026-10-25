'use client';

import { ViewportPortal, useViewport } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { Tip } from '@/components/shared/Tip';
import { type FlowNode } from './flow';

/**
 * Live link to the other open editors of this diagram (SSE /api/diagrams/[id]/stream): who has it open, the latest
 * save by someone else (the editor then pulls and merges it) and a delete. `tab` identifies this editor so its own
 * saves are not reported back to it.
 */
export function useDiagramLive(id: number) {
  const [tab] = useState(() => crypto.randomUUID());
  const [viewers, setViewers] = useState<{ tab: string; userId: number; name: string }[]>([]);
  const [remote, setRemote] = useState<{ name: string; updated_at: string } | null>(null);
  const [deleted, setDeleted] = useState<{ name: string } | null>(null);
  useEffect(() => {
    const es = new EventSource(`/api/diagrams/${id}/stream?tab=${tab}`);
    es.addEventListener('presence', (e) => setViewers((JSON.parse(e.data).viewers as typeof viewers).filter((v) => v.tab !== tab)));
    es.addEventListener('saved', (e) => {
      const d = JSON.parse(e.data);
      if (d.tab !== tab) setRemote({ name: d.name, updated_at: d.updated_at });
    });
    es.addEventListener('deleted', (e) => setDeleted({ name: JSON.parse(e.data).name }));
    return () => es.close();
  }, [id, tab]);
  return { tab, viewers, remote, deleted };
}

/** colour of a person in the live view — the same palette as realtime/server.mjs */
const PEER_COLORS = ['#e2445c', '#0073ea', '#00a862', '#a25ddc', '#ff642e', '#037f4c', '#bb3354', '#579bfc', '#9d50dd', '#d9822b'];
const peerColor = (userId: number) => PEER_COLORS[userId % PEER_COLORS.length];

type DragNode = { id: string; x: number; y: number; w: number | null; h: number | null };
type Peer = { name: string; color: string; cursor?: { x: number; y: number }; seen: number; drag?: { nodes: DragNode[]; ended?: number } };
type LiveMessage = { t: 'cursor'; x: number | null; y: number | null } | { t: 'drag'; nodes: DragNode[] } | { t: 'drag-end' };

const CURSOR_IDLE_MS = 15000;
const GHOST_AFTER_DROP_MS = 3000;
const SEND_EVERY_MS = 40;

/**
 * Cursors and shapes being dragged, live, over the realtime service (realtime/server.mjs, WebSocket). The app hands
 * out a ticket for the room (/api/diagrams/[id]/live); the socket reconnects with a fresh one when it drops. Without
 * the service everything else keeps working — only the live cursors are missing.
 */
export function useLivePointers(id: number, tab: string) {
  const ws = useRef<WebSocket | null>(null);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  useEffect(() => {
    let stopped = false, retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => { if (!stopped) timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++)); };
    async function connect() {
      try {
        const j = await fetch(`/api/diagrams/${id}/live?tab=${tab}`).then((r) => r.json());
        if (j.error || stopped) return again();
        const sock = new WebSocket(`${j.data.url}?token=${encodeURIComponent(j.data.token)}`);
        ws.current = sock;
        sock.onopen = () => { retry = 0; };
        sock.onmessage = (e) => {
          const m = JSON.parse(e.data);
          setPeers((p) => {
            if (m.t === 'gone') {
              const rest = { ...p };
              delete rest[m.tab];
              return rest;
            }
            const prev: Peer = p[m.tab] ?? { name: m.name, color: m.color, seen: 0 };
            const next: Peer = { ...prev, name: m.name, color: m.color, seen: Date.now() };
            if (m.t === 'cursor') next.cursor = m.x === null || m.y === null ? undefined : { x: m.x, y: m.y };
            if (m.t === 'drag') next.drag = { nodes: m.nodes };
            if (m.t === 'drag-end' && prev.drag) next.drag = { ...prev.drag, ended: Date.now() };
            return { ...p, [m.tab]: next };
          });
        };
        sock.onclose = () => {
          if (ws.current === sock) ws.current = null;
          setPeers({});
          again();
        };
      } catch {
        again();
      }
    }
    void connect();
    // forget idle cursors and the outlines of finished drags (the saved position has arrived by then)
    const sweep = setInterval(() => {
      const now = Date.now();
      setPeers((p) => {
        let changed = false;
        const out: Record<string, Peer> = {};
        for (const [k, v] of Object.entries(p)) {
          const n = { ...v };
          if (n.cursor && now - n.seen > CURSOR_IDLE_MS) { n.cursor = undefined; changed = true; }
          if (n.drag?.ended && now - n.drag.ended > GHOST_AFTER_DROP_MS) { n.drag = undefined; changed = true; }
          out[k] = n;
        }
        return changed ? out : p;
      });
    }, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(sweep);
      ws.current?.close();
      ws.current = null;
    };
  }, [id, tab]);

  // at most one message per kind every SEND_EVERY_MS; the latest one always goes out
  const pending = useRef<Record<string, LiveMessage>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const send = useCallback((m: LiveMessage, now = false) => {
    const raw = (x: LiveMessage) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(x)); };
    const kind = m.t === 'drag-end' ? 'drag' : m.t;
    if (now) {
      clearTimeout(timers.current[kind]);
      timers.current[kind] = undefined;
      delete pending.current[kind];
      return raw(m);
    }
    pending.current[kind] = m;
    if (timers.current[kind]) return;
    raw(m);
    delete pending.current[kind];
    timers.current[kind] = setTimeout(function flush() {
      const next = pending.current[kind];
      delete pending.current[kind];
      if (next) {
        raw(next);
        timers.current[kind] = setTimeout(flush, SEND_EVERY_MS);
      } else {
        timers.current[kind] = undefined;
      }
    }, SEND_EVERY_MS);
  }, []);
  return { peers, send };
}

/** other people's cursors and the outlines of what they are dragging, drawn in diagram coordinates */
export function RemoteLayer({ peers, nodes }: { peers: Record<string, Peer>; nodes: FlowNode[] }) {
  const { zoom } = useViewport();
  const label = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '';
  return (
    <ViewportPortal>
      {Object.entries(peers).map(([tab, p]) => (
        <Fragment key={tab}>
          {p.drag?.nodes.map((n) => (
            <div
              key={n.id}
              className="pointer-events-none absolute grid place-items-center rounded-md border-2 border-dashed px-2 text-center text-xs font-medium transition-[left,top] duration-75"
              style={{ left: n.x, top: n.y, width: n.w ?? 160, height: n.h ?? 60, borderColor: p.color, background: `${p.color}14`, color: p.color, zIndex: 1000 }}
            >
              <span className="line-clamp-2">{label(n.id)}</span>
            </div>
          ))}
          {p.cursor && (
            <div
              className="pointer-events-none absolute transition-[left,top] duration-75 ease-linear"
              style={{ left: p.cursor.x, top: p.cursor.y, transform: `scale(${1 / zoom})`, transformOrigin: '0 0', zIndex: 1001 }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-sm"><path d="M2 1.5L15.5 9 9.2 10.3 6.3 16.2Z" fill={p.color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" /></svg>
              <span className="absolute top-4 left-3 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow-sm" style={{ background: p.color }}>{p.name}</span>
            </div>
          )}
        </Fragment>
      ))}
    </ViewportPortal>
  );
}

/** avatars of the other people who have this diagram open (one per person, however many tabs) */
export function Viewers({ viewers }: { viewers: { userId: number; name: string }[] }) {
  const t = useTranslations('design.live');
  const { me } = useApp();
  const people = [...new Map(viewers.map((v) => [v.userId, v])).values()];
  if (!people.length) return null;
  const label = people.map((p) => (p.userId === me?.id ? t('youOtherTab') : p.name)).join(', ');
  return (
    <Tip title={t('viewing', { names: label })}>
      <span className="flex shrink-0 items-center -space-x-1.5" aria-label={t('viewing', { names: label })}>
        <span className="relative mr-2.5 flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#00c875] opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-[#00c875]" /></span>
        {people.slice(0, 4).map((p) => (
          <span key={p.userId} className="grid size-6 place-items-center rounded-full border-2 border-background text-[10px] font-semibold text-white" style={{ background: peerColor(p.userId) }}>
            {p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </span>
        ))}
        {people.length > 4 && <span className="grid size-6 place-items-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold">+{people.length - 4}</span>}
      </span>
    </Tip>
  );
}
