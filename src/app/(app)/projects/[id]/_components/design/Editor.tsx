'use client';

import { Background, ConnectionMode, Controls, type Edge, MiniMap, ReactFlow, ViewportPortal, addEdge, getNodesBounds, getViewportForBounds, type NodeChange, type NodePositionChange, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { ChevronDown, Database, FileCode, FileInput, Check, Grid3x3, Loader2, Download, Info, LayoutGrid, Maximize2, Minimize2, Redo2, Scan, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { Tip } from '@/components/shared/common';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { type DiagramContent, FLOW_SHAPES, type FlowShape, type ProjectDiagram, emptyContent, fromDraft, layout, merge3, mergeDraft, newId, nodeSize, pasteContent } from '@/lib/diagram';
import { errMsg, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type FlowNode, GRID, alignTo, edgeStyle, toContent, toFlow } from './flow';
import { RemoteLayer, Viewers, useDiagramLive, useLivePointers } from './live';
import { type History, pushed, snapOf } from './history';
import { EDGE_TYPES, ErMarkers, NODE_TYPES, ShapeGlyph } from './nodes';
import { FormatPanel } from './FormatPanel';
import { SqlDialog } from './SqlDialog';
import { AiDraftDialog } from './AiDraftDialog';

const CLIPBOARD_KEY = 'pcw-diagram-clipboard';

const AUTOSAVE_MS = 1000;

type Saved = { title: string; content: DiagramContent; updated_at: string };
const DRAG_TYPE = 'application/x-pcw-shape';

type Tool = FlowShape | 'entity';

/** small caption between the groups of the left tool bar */
function ToolGroup({ label }: { label: string }) {
  return <span className="mt-1.5 mb-0.5 w-11 border-t pt-1 text-center text-[9px] leading-tight font-semibold text-muted-foreground uppercase first:mt-0 first:border-t-0 first:pt-0">{label}</span>;
}

function TableGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-foreground/80">
      <rect x="3" y="4" width="18" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h18M3 13.5h18M8 9v11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function Editor({ diagram, picker, canDelete, onDirty, onSaved, onDeleted }: {
  diagram: ProjectDiagram; picker: React.ReactNode; canDelete: boolean;
  onDirty: (v: boolean) => void; onSaved: (s: Saved) => void; onDeleted: () => Promise<void>;
}) {
  const t = useTranslations('design');
  const { notify } = useApp();
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow<FlowNode, Edge>();
  const initial = useMemo(() => toFlow(diagram.content ?? emptyContent()), [diagram.content]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [title, setTitle] = useState(diagram.title);
  const live = useDiagramLive(diagram.id);
  const pointers = useLivePointers(diagram.id, live.tab);
  const [aiOpen, setAiOpen] = useState(false);
  const [fitPending, setFitPending] = useState(false);
  const [maximized, setMaximized] = useState(false);
  // every node has been measured (also the ones just added) — fitting before that frames the old drawing
  const measured = nodes.every((n) => n.measured?.width);


  const replace = (c: DiagramContent) => {
    const f = toFlow(c);
    setNodes(f.nodes);
    setEdges(f.edges);
    setFitPending(true);
  };

  /*
   * Undo / redo: every settled change of the drawing by me (not selection or zoom, not other people's edits) becomes
   * a step. Changes are recorded once they pause, so a drag or a resize is one step; the title is not part of it.
   */
  const snap = useMemo(() => JSON.stringify(toContent(nodes, edges)), [nodes, edges]);
  const [hist, setHist] = useState<History>({ past: [], future: [], last: snap });
  const busy = nodes.some((n) => n.dragging || n.resizing);
  useEffect(() => {
    if (busy || snap === hist.last) return;
    const id = setTimeout(() => setHist((h) => pushed(h, snap)), 300);
    return () => clearTimeout(id);
  }, [snap, busy, hist.last]);
  const step = (dir: 'undo' | 'redo') => {
    // a change still waiting to be recorded becomes a step first
    const h = busy ? hist : pushed(hist, snap);
    const st = (dir === 'undo' ? h.past : h.future).at(-1);
    if (!st) return setHist(h);
    const [from, to] = dir === 'undo' ? [st.after, st.before] : [st.before, st.after];
    const f = toFlow(merge3(JSON.parse(from), JSON.parse(to), JSON.parse(snap)));
    setHist(dir === 'undo'
      ? { past: h.past.slice(0, -1), future: [...h.future, st], last: JSON.stringify(toContent(f.nodes, f.edges)) }
      : { past: [...h.past, st], future: h.future.slice(0, -1), last: JSON.stringify(toContent(f.nodes, f.edges)) });
    setNodes(f.nodes);
    setEdges(f.edges);
  };
  const canUndo = hist.past.length > 0 || (!busy && snap !== hist.last);
  const canRedo = hist.future.length > 0;

  /*
   * Autosave + live sync. `synced` is the version last known to be on the server. A second after the drawing (or
   * title) settles, it is saved against that version; when someone saved in between (409) the editor pulls theirs,
   * merges my edits on top shape by shape and tries again. When someone else saves, the editor pulls and merges the
   * same way, so their changes appear on my canvas without a reload.
   */
  const [synced, setSynced] = useState(() => ({ snap, title: diagram.title, updated_at: diagram.updated_at }));
  const dirty = snap !== synced.snap || title !== synced.title;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const latest = useRef({ snap, title, synced, remote: live.remote });
  useEffect(() => { latest.current = { snap, title, synced, remote: live.remote }; });
  const saving = useRef(false);

  /** put a drawing that came from the server (or a merge with it) on screen — not an undo step of mine */
  const applyExternal = (c: DiagramContent) => {
    const f = toFlow(c);
    setNodes((ns) => {
      const sel = new Set(ns.filter((n) => n.selected).map((n) => n.id));
      return f.nodes.map((n) => (sel.has(n.id) ? { ...n, selected: true } : n));
    });
    setEdges((es) => {
      const sel = new Set(es.filter((e) => e.selected).map((e) => e.id));
      return f.edges.map((e) => (sel.has(e.id) ? { ...e, selected: true } : e));
    });
    setHist((h) => ({ ...h, last: JSON.stringify(toContent(f.nodes, f.edges)) }));
    latest.current.snap = JSON.stringify(toContent(f.nodes, f.edges));
  };
  const fetchLatest = async (): Promise<Saved> => {
    const j = await fetch(`/api/diagrams/${diagram.id}`).then((r) => r.json());
    if (j.error) throw new Error(j.error.message);
    return j.data;
  };
  /** take the server's version: merged with my unsaved edits, if any */
  const adopt = (server: Saved) => {
    const { snap: mine, title: myTitle, synced: base } = latest.current;
    applyExternal(mine === base.snap ? server.content : merge3(JSON.parse(base.snap), JSON.parse(mine), server.content));
    if (myTitle === base.title) setTitle(server.title);
    const s = { snap: snapOf(server.content), title: server.title, updated_at: server.updated_at };
    setSynced(s);
    latest.current.synced = s;
    if (myTitle === base.title) latest.current.title = server.title;
    onSaved(server);
  };

  const pull = async () => {
    if (saving.current) return; // the save in progress merges on its own when it meets the newer version
    try {
      const server = await fetchLatest();
      if (server.updated_at === latest.current.synced.updated_at) return;
      adopt(server);
      setUpdatedBy(latest.current.remote?.name ?? null);
    } catch (e) {
      console.warn('[design] could not load the latest version', e);
    }
  };

  const save = async () => {
    if (saving.current || live.deleted) return;
    saving.current = true;
    setStatus('saving');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { snap: mine, title: myTitle, synced: base } = latest.current;
        const body = { title: myTitle.trim() || t('untitled'), content: JSON.parse(mine) as DiagramContent, base: base.updated_at, tab: live.tab };
        const res = await fetch(`/api/diagrams/${diagram.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await res.json();
        if (res.status === 409) {
          // someone saved in between: take theirs, put my edits on top, save again
          adopt(await fetchLatest());
          continue;
        }
        if (j.error) throw new Error(j.error.message);
        const s = { snap: mine, title: myTitle, updated_at: j.data.updated_at as string };
        setSynced(s);
        latest.current.synced = s;
        onSaved({ title: body.title, content: body.content, updated_at: s.updated_at });
        setStatus('idle');
        return;
      }
      throw new Error(t('autosave.busy'));
    } catch (e) {
      setStatus('error');
      notify(errMsg(e), 'error');
    } finally {
      saving.current = false;
      // a save by someone else may have come in while mine was on its way
      const r = latest.current.remote;
      if (r && r.updated_at > latest.current.synced.updated_at) void pull();
    }
  };
  const saveRef = useRef(save);
  const pullRef = useRef(pull);
  useEffect(() => { saveRef.current = save; pullRef.current = pull; });

  // autosave once the drawing / title has been still for a moment (not mid-drag)
  useEffect(() => {
    if (!dirty || busy || live.deleted || status === 'error') return;
    const id = setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [snap, title, dirty, busy, live.deleted, status]);
  // someone else saved: pull it in (after my drag ends)
  useEffect(() => {
    if (live.remote && !busy) void pullRef.current();
  }, [live.remote, busy]);
  // "updated by …" fades after a few seconds
  useEffect(() => {
    if (!updatedBy) return;
    const id = setTimeout(() => setUpdatedBy(null), 5000);
    return () => clearTimeout(id);
  }, [updatedBy]);

  const selectedNodes = nodes.filter((n) => n.selected);

  /*
   * Clipboard: ⌘C / ⌘X copy the selected shapes and the lines between them (kept in localStorage, so they paste
   * into another diagram too), ⌘V pastes them a little offset each time, ⌘D duplicates, ⌘A selects everything.
   * Returns whether the key was handled, so the browser default (copying page text …) still works otherwise.
   */
  const pasteCount = useRef(0);
  const clip = (k: string): boolean => {
    const sel = nodes.filter((n) => n.selected);
    const copySel = () => {
      const ids = new Set(sel.map((n) => n.id));
      const c = toContent(sel, edges.filter((e) => ids.has(e.source) && ids.has(e.target)));
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(c));
      pasteCount.current = 0;
      return c;
    };
    const paste = (c: DiagramContent) => {
      pasteCount.current += 1;
      const { content, ids } = pasteContent(toContent(nodes, edges), c, 32 * pasteCount.current);
      const f = toFlow(content);
      setNodes(f.nodes.map((n) => ({ ...n, selected: ids.has(n.id) })));
      setEdges(f.edges);
    };
    if (k === 'a') {
      setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
      return true;
    }
    if (k === 'v') {
      try {
        const c = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? 'null') as DiagramContent | null;
        if (!c?.nodes?.length) return false;
        paste(c);
        return true;
      } catch {
        return false;
      }
    }
    if (!sel.length) return false;
    const c = copySel();
    if (k === 'x') rf.deleteElements({ nodes: sel.map((n) => ({ id: n.id })) });
    if (k === 'd') paste(c);
    return true;
  };
  const clipRef = useRef(clip);
  useEffect(() => { clipRef.current = clip; });

  // Ctrl / ⌘ + Z undoes, + Shift + Z or + Y redoes — except while typing, where the field keeps its own undo; ⌘S saves now
  const stepRef = useRef(step);
  const saveNowRef = useRef(() => saveRef.current());
  useEffect(() => { stepRef.current = step; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        stepRef.current(k === 'y' || e.shiftKey ? 'redo' : 'undo');
      } else if (k === 's') {
        e.preventDefault();
        void saveNowRef.current();
      } else if (['c', 'x', 'v', 'd', 'a'].includes(k) && clipRef.current(k)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);


  /*
   * Alignment guides: while one shape is dragged, it snaps to the left / centre / right (top / middle / bottom) of
   * the other shapes when within a few pixels, and a dashed guide shows the line it lines up with. Otherwise the
   * grid snap (when on) applies.
   */
  const [snapOn, setSnapOn] = useState(true);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const dragId = useRef<string | null>(null);
  const handleNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const c = changes.length === 1 && changes[0].type === 'position' ? changes[0] : null;
    // the drop sends one last position (dragging: false) that the grid would snap again — align that one too
    if (c?.position && (c.dragging || dragId.current === c.id)) {
      const g = alignTo(c.id, c.position, nodes);
      c.position = { x: c.position.x + g.dx, y: c.position.y + g.dy };
      dragId.current = c.dragging ? c.id : null;
      setGuides(c.dragging ? { x: g.x, y: g.y } : {});
    } else if (guides.x !== undefined || guides.y !== undefined) {
      setGuides({});
    }
    // let the others see the shapes move while I drag them
    const moving = changes.filter((x): x is NodePositionChange => x.type === 'position' && !!x.dragging && !!x.position);
    if (moving.length) {
      pointers.send({
        t: 'drag',
        nodes: moving.map((x) => {
          const n = nodes.find((y) => y.id === x.id);
          return { id: x.id, x: x.position!.x, y: x.position!.y, w: n?.measured?.width ?? null, h: n?.measured?.height ?? null };
        }),
      });
    }
    onNodesChange(changes);
  };

  const [sqlOpen, setSqlOpen] = useState<'export' | 'import' | null>(null);

  // fit once React Flow has measured the replaced nodes (or the resized canvas)
  useEffect(() => {
    if (!fitPending || !measured) return;
    const id = requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 300 }));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot flag
    setFitPending(false);
    return () => cancelAnimationFrame(id);
  }, [fitPending, measured, rf]);

  const addNode = (tool: Tool, at?: { x: number; y: number }) => {
    const box = document.querySelector(`[data-diagram="${diagram.id}"]`)?.getBoundingClientRect();
    const position = at ?? rf.screenToFlowPosition(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: 0, y: 0 });
    const id = newId('n');
    const node: FlowNode = tool === 'entity'
      ? { id, type: 'entity', position, data: { label: t('newTable'), columns: [{ name: 'id', type: 'INT', pk: true }] }, selected: true }
      : { id, type: 'flow', position, data: { label: tool === 'decision' ? '?' : t(tool === 'process' ? 'newStep' : `shape.${tool}`), shape: tool }, selected: true };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: t('delete.title'), description: t('delete.description', { title: diagram.title }), confirmText: t('delete.button'), destructive: true });
    if (!ok) return;
    const j = await fetch(`/api/diagrams/${diagram.id}`, { method: 'DELETE' }).then((r) => r.json()).catch((e) => ({ error: { message: errMsg(e) } }));
    if (j.error) return notify(j.error.message, 'error');
    notify(t('delete.done'));
    await onDeleted();  };

  const exportPng = async () => {
    const el = document.querySelector<HTMLElement>(`[data-diagram="${diagram.id}"] .react-flow__viewport`);
    if (!el || !nodes.length) return;
    const bounds = getNodesBounds(nodes);
    const width = Math.min(4000, Math.max(800, bounds.width + 160)), height = Math.min(4000, Math.max(500, bounds.height + 160));
    const vp = getViewportForBounds(bounds, width, height, 0.2, 2, 0.08);
    try {
      const url = await toPng(el, {
        backgroundColor: resolvedTheme === 'dark' ? '#181b34' : '#ffffff', width, height,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title || diagram.title).replace(/[\\/:*?"<>|]+/g, '_')}.png`;
      a.click();
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  // warn before closing the page while edits are not on the server yet
  useEffect(() => {
    if (!dirty && status !== 'saving') return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, status]);

  // Esc leaves the maximized view (unless it is closing an inline edit)
  useEffect(() => {
    if (!maximized) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        setMaximized(false);
        setFitPending(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [maximized]);

  const tool = (key: string, tip: string, content: React.ReactNode, onClick: () => void, drag?: Tool, disabled?: boolean) => (
    <Tip key={key} title={tip} side="right">
      <Button
        size="icon" variant="ghost" className="size-10" onClick={onClick} disabled={disabled}
        draggable={!!drag} onDragStart={drag ? (e) => { e.dataTransfer.setData(DRAG_TYPE, drag); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      >
        {content}
      </Button>
    </Tip>
  );

  return (
    <>
      <div className={cn('flex flex-col gap-2', maximized && 'fixed inset-0 z-40 bg-background p-3')}>
        {/* one line on desktop: the status text truncates, so the canvas below never jumps when it changes */}
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          {picker}
          <Input aria-label={t('titleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 w-72 min-w-32 shrink font-semibold" maxLength={200} />
          <Viewers viewers={live.viewers} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-muted-foreground" aria-live="polite">
            {status === 'error' ? (
              <>
                <span className="font-medium text-destructive">{t('autosave.failed')}</span>
                <Button size="xs" variant="outline" onClick={() => { setStatus('idle'); void saveRef.current(); }}>{t('autosave.retry')}</Button>
              </>
            ) : dirty || status === 'saving' ? (
              <><Loader2 className="size-3 animate-spin" /> {t('autosave.saving')}</>
            ) : (
              <>
                <Check className="size-3 text-[#00a862]" /> {t('autosave.saved', { time: fmtDateTime(synced.updated_at) })}
                {updatedBy && <span className="font-medium text-[#0073ea]">· {t('autosave.updatedBy', { name: updatedBy })}</span>}
              </>
            )}
          </span>
          <div className="ml-auto flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}><Sparkles className="text-[#a25ddc]" /> {t('ai.button')}</Button>
            <Button size="sm" variant="outline" disabled={!nodes.length} onClick={exportPng}><Download /> {t('exportPng')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline"><Database /> SQL <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!nodes.some((n) => n.type === 'entity')} onSelect={() => setSqlOpen('export')}><FileCode /> {t('sql.export')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSqlOpen('import')}><FileInput /> {t('sql.import')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canDelete && <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}><Trash2 /> {t('delete.button')}</Button>}
          </div>
        </div>

        <div
          data-diagram={diagram.id}
          className={cn('relative overflow-hidden rounded-lg border border-grid bg-background', maximized ? 'min-h-0 flex-1' : 'h-[max(600px,calc(100vh-290px))]')}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
          onMouseMove={(e) => pointers.send({ t: 'cursor', ...rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })}
          onMouseLeave={() => pointers.send({ t: 'cursor', x: null, y: null }, true)}
          onDrop={(e) => {
            const shape = e.dataTransfer.getData(DRAG_TYPE);
            if (!shape) return;
            e.preventDefault();
            const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            const tl = shape as Tool, entity = tl === 'entity';
            const size = nodeSize({ id: '', type: entity ? 'entity' : 'flow', position: at, data: { label: '', shape: entity ? undefined : (tl as FlowShape), columns: [{ name: 'id', type: 'INT' }] } });
            addNode(tl, { x: at.x - size.width / 2, y: at.y - size.height / 2 });
          }}
        >
          <div className="absolute top-1/2 left-2 z-10 flex max-h-[calc(100%-1rem)] -translate-y-1/2 flex-col items-center overflow-y-auto rounded-lg border bg-background/95 p-1 shadow-md">
            <ToolGroup label={t('group.edit')} />
            {tool('undo', t('undo'), <Undo2 className="size-5" />, () => step('undo'), undefined, !canUndo)}
            {tool('redo', t('redo'), <Redo2 className="size-5" />, () => step('redo'), undefined, !canRedo)}
            <ToolGroup label={t('group.flowchart')} />
            {FLOW_SHAPES.map((s) => tool(s, t(`shape.${s}`), <ShapeGlyph shape={s} className="size-6 text-foreground" />, () => addNode(s), s))}
            <ToolGroup label={t('group.er')} />
            {tool('table', t('addTable'), <TableGlyph />, () => addNode('entity'), 'entity')}
            <ToolGroup label={t('group.view')} />
            {tool('layout', t('layout'), <LayoutGrid className="size-5" />, () => { if (nodes.length) replace(layout(toContent(nodes, edges))); })}
            {tool('fit', t('fit'), <Scan className="size-5" />, () => rf.fitView({ padding: 0.15, duration: 300 }))}
            <Tip title={t(snapOn ? 'snapOff' : 'snapOn')} side="right">
              <Button size="icon" variant={snapOn ? 'secondary' : 'ghost'} className="size-10" aria-pressed={snapOn} onClick={() => setSnapOn((v) => !v)}><Grid3x3 className="size-5" /></Button>
            </Tip>
            {tool('max', maximized ? t('restore') : t('maximize'), maximized ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />, () => {
              setMaximized((m) => !m);
              setFitPending(true);
            })}
            <Tip title={t('hint')} side="right">
              <span className="grid size-10 place-items-center text-muted-foreground"><Info className="size-4" /></span>
            </Tip>
          </div>
          {live.deleted && (
            <div className="absolute top-2 left-1/2 z-20 flex max-w-[calc(100%-22rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/40 bg-background px-3 py-1.5 text-xs text-destructive shadow-md">
              <Trash2 className="size-3.5 shrink-0" />
              <span>{t('live.deletedBy', { name: live.deleted.name })}</span>
            </div>
          )}
          {selectedNodes.length > 0 && <FormatPanel key={selectedNodes.map((n) => n.id).join()} selected={selectedNodes} />}
          <ReactFlow<FlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            connectionMode={ConnectionMode.Loose}
            colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={() => { setGuides({}); pointers.send({ t: 'drag-end' }, true); }}
            onConnect={(c) => {
              setEdges((es) => {
                const edge = edgeStyle({ ...c, id: newId('e') }, nodes);
                // a new relationship: the table the line is dragged from is the "one" side, the other the "many"
                return addEdge(edge.data?.er ? { ...edge, label: '1:N' } : edge, es);
              });
            }}
            snapToGrid={snapOn}
            snapGrid={[GRID, GRID]}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={GRID} />
            <ErMarkers />
            <RemoteLayer peers={pointers.peers} nodes={nodes} />
            <ViewportPortal>
              {guides.x !== undefined && <div className="pointer-events-none absolute border-l border-dashed border-[#0073ea]" style={{ left: guides.x, top: -100000, height: 200000 }} />}
              {guides.y !== undefined && <div className="pointer-events-none absolute border-t border-dashed border-[#0073ea]" style={{ top: guides.y, left: -100000, width: 200000 }} />}
            </ViewportPortal>
            <Controls showInteractive={false} showFitView={false} position="bottom-right" className="md:!mr-[220px]" />
            <MiniMap pannable zoomable className="!hidden md:!block" />
          </ReactFlow>
        </div>
      </div>

      <SqlDialog
        mode={sqlOpen} onClose={() => setSqlOpen(null)} title={title || diagram.title} content={toContent(nodes, edges)}
        onImport={(draft, replaceTables) => {
          const names = new Set(draft.nodes.map((n) => n.id));
          const added = fromDraft('er', { ...draft, edges: draft.edges.filter((e) => names.has(e.to)) }).content;
          const merged = mergeDraft(toContent(nodes, edges), added, 'er', replaceTables);
          // keys to tables that are not in the script: link them to a table of that name already on the canvas
          const fresh = merged.nodes.slice(-added.nodes.length), old = merged.nodes.slice(0, -added.nodes.length);
          for (const e of draft.edges.filter((x) => !names.has(x.to))) {
            const from = fresh.find((n) => n.data.label === e.from), to = old.find((n) => n.type === 'entity' && n.data.label === e.to);
            if (from && to) merged.edges.push({ id: newId('e'), source: from.id, target: to.id, label: 'N:1' });
          }
          replace(merged);
        }}
      />
      <AiDraftDialog
        open={aiOpen} onOpenChange={setAiOpen} projectId={diagram.project_id} current={toContent(nodes, edges)}
        onDraft={(d, kind, revise) => {
          if (d.title && (!title.trim() || title === t('untitled'))) setTitle(d.title);
          replace(mergeDraft(toContent(nodes, edges), d.content, kind, revise));
        }}
      />
    </>
  );
}
