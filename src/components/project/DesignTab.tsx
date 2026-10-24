'use client';

import '@xyflow/react/dist/style.css';
import {
  Background, ConnectionMode, Controls, type Edge, Handle, MarkerType, MiniMap, type Node, type NodeProps, Position, ReactFlow,
  ReactFlowProvider, addEdge, getNodesBounds, getViewportForBounds, useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import { Database, Download, KeyRound, Link2, LayoutGrid, Plus, Save, Sparkles, Trash2, Undo2, Workflow, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EmptyState } from '@/components/common';
import { confirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { dbClient } from '@/lib/db/client';
import {
  type DiagramContent, type DiagramEdge, type DiagramKind, type DiagramNode, type DiagramNodeData, type ErColumn, FLOW_SHAPES,
  type FlowShape, type ProjectDiagram, emptyContent, layout, nodeSize,
} from '@/lib/diagram';
import { errMsg, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

type FlowNode = Node<DiagramNodeData>;

const SHAPE_COLORS: Record<FlowShape, string> = {
  start: '#00c875', process: '#0073ea', decision: '#fdab3d', io: '#a25ddc', end: '#e2445c',
};
const CARDINALITIES = ['1:1', 'N:1', '1:N', 'N:N'];

/** a handle on every side; with ConnectionMode.Loose any of them can start or end a line */
function Handles() {
  const cls = '!size-2 !border-white !bg-[#676879] opacity-0 transition-opacity group-hover:opacity-100';
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" className={cls} />
      <Handle type="source" position={Position.Right} id="r" className={cls} />
      <Handle type="source" position={Position.Bottom} id="b" className={cls} />
      <Handle type="source" position={Position.Left} id="l" className={cls} />
    </>
  );
}

function FlowShapeNode({ data, selected }: NodeProps<FlowNode>) {
  const shape = data.shape ?? 'process';
  const color = SHAPE_COLORS[shape];
  const { width, height } = nodeSize({ id: '', type: 'flow', position: { x: 0, y: 0 }, data });
  const ring = selected ? 'drop-shadow-[0_0_0.35rem_rgba(0,115,234,0.55)]' : '';
  const text = <span className="relative line-clamp-3 px-3 text-center text-xs leading-tight font-medium text-foreground">{data.label}</span>;
  if (shape === 'decision' || shape === 'io') {
    const points = shape === 'decision' ? `${width / 2},2 ${width - 2},${height / 2} ${width / 2},${height - 2} 2,${height / 2}` : `22,2 ${width - 2},2 ${width - 22},${height - 2} 2,${height - 2}`;
    return (
      <div className={cn('group relative grid place-items-center', ring)} style={{ width, height }}>
        <svg className="absolute inset-0" width={width} height={height}>
          <polygon points={points} fill="var(--background)" />
          <polygon points={points} fill={`${color}1f`} stroke={color} strokeWidth={2} />
        </svg>
        {text}
        <Handles />
      </div>
    );
  }
  return (
    <div
      className={cn('group relative grid place-items-center border-2 bg-background', shape === 'process' ? 'rounded-md' : 'rounded-full', ring)}
      style={{ width, height, borderColor: color, backgroundImage: `linear-gradient(${color}1f, ${color}1f)` }}
    >
      {text}
      <Handles />
    </div>
  );
}

function EntityNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div className={cn('group relative w-[220px] overflow-hidden rounded-md border-2 border-[#0073ea] bg-background text-xs shadow-sm', selected && 'ring-2 ring-[#0073ea]/40')}>
      <div className="flex h-9 items-center gap-1.5 bg-[#0073ea] px-2.5 font-semibold text-white"><Database className="size-3.5" />{data.label}</div>
      {(data.columns?.length ? data.columns : [{ name: '…', type: '' }]).map((c, i) => (
        <div key={i} className="flex h-[26px] items-center gap-1.5 border-t border-grid px-2.5">
          <span className="w-3.5 shrink-0">
            {c.pk ? <KeyRound className="size-3.5 text-[#fdab3d]" /> : c.fk ? <Link2 className="size-3.5 text-[#a25ddc]" /> : null}
          </span>
          <span className={cn('truncate', c.pk && 'font-semibold')}>{c.name}</span>
          <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{c.type}</span>
        </div>
      ))}
      <Handles />
    </div>
  );
}

const NODE_TYPES = { flow: FlowShapeNode, entity: EntityNode };

const toFlow = (c: DiagramContent): { nodes: FlowNode[]; edges: Edge[] } => ({ nodes: c.nodes, edges: c.edges });
function toContent(nodes: FlowNode[], edges: Edge[]): DiagramContent {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type as DiagramNode['type'], position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
    edges: edges.map((e): DiagramEdge => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
      ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
    })),
  };
}
const nextId = (prefix: string, items: { id: string }[]) => {
  const max = Math.max(0, ...items.map((i) => Number(i.id.replace(/^\D+/, '')) || 0));
  return `${prefix}${max + 1}`;
};

export default function DesignTab({ data, perm }: TabProps) {
  const t = useTranslations('design');
  const db = dbClient();
  const { me, profileName, notify } = useApp();
  const projectId = data.project.id;
  const [list, setList] = useState<ProjectDiagram[] | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const { data: rows } = await db.from('project_diagrams').select('*').eq('project_id', projectId).order('updated_at', { ascending: false });
    const all = (rows ?? []) as ProjectDiagram[];
    setList(all);
    return all;
  }, [db, projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load().then((all) => setSelId((s) => s ?? all[0]?.id ?? null));
  }, [load]);

  const leave = async () => !dirty || confirmDialog({
    title: t('discard.title'), description: t('discard.description', { title: list?.find((d) => d.id === selId)?.title ?? '' }),
    confirmText: t('discard.confirm'), destructive: true,
  });
  const open = async (id: number) => {
    if (id === selId || !(await leave())) return;
    setDirty(false);
    setSelId(id);
  };
  const create = async (kind: DiagramKind) => {
    if (!(await leave())) return;
    const { data: row, error } = await db.from('project_diagrams')
      .insert({ project_id: projectId, kind, title: t(`untitled.${kind}`), content: emptyContent() }).select('*').single();
    if (error) return notify(error.message, 'error');
    await load();
    setDirty(false);
    setSelId((row as ProjectDiagram).id);
  };

  const current = list?.find((d) => d.id === selId) ?? null;
  if (!list) return null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-2 lg:w-60">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => create('flowchart')}><Workflow /> {t('newFlowchart')}</Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => create('er')}><Database /> {t('newEr')}</Button>
        </div>
        {!list.length && <EmptyState text={t('empty')} />}
        <div className="flex flex-col gap-1">
          {list.map((d) => (
            <button key={d.id} type="button" onClick={() => open(d.id)}
              className={cn('flex items-start gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted', d.id === selId ? 'border-primary bg-selected' : 'border-transparent')}>
              {d.kind === 'er' ? <Database className="mt-0.5 size-4 shrink-0 text-[#0073ea]" /> : <Workflow className="mt-0.5 size-4 shrink-0 text-[#00c875]" />}
              <span className="min-w-0">
                <span className="block truncate font-medium">{d.title}{d.id === selId && dirty ? ' •' : ''}</span>
                <span className="block truncate text-xs text-muted-foreground">{t(`kind.${d.kind}`)} · {fmtDateTime(d.updated_at)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {current && (
          <ReactFlowProvider key={current.id}>
            <Editor
              diagram={current}
              canDelete={current.created_by === me?.id || perm.manage}
              onDirty={setDirty}
              onSaved={async () => { setDirty(false); await load(); }}
              onDeleted={async () => {
                setDirty(false);
                const all = await load();
                setSelId(all[0]?.id ?? null);
              }}
              editorName={profileName(current.updated_by ?? current.created_by)}
            />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}

function Editor({ diagram, canDelete, onDirty, onSaved, onDeleted, editorName }: {
  diagram: ProjectDiagram; canDelete: boolean; editorName: string;
  onDirty: (v: boolean) => void; onSaved: () => Promise<void>; onDeleted: () => Promise<void>;
}) {
  const t = useTranslations('design');
  const db = dbClient();
  const { me, notify } = useApp();
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow<FlowNode, Edge>();
  const er = diagram.kind === 'er';
  const initial = useMemo(() => toFlow(diagram.content ?? emptyContent()), [diagram.content]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [title, setTitle] = useState(diagram.title);
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [beforeAi, setBeforeAi] = useState<{ nodes: FlowNode[]; edges: Edge[] } | null>(null);
  const [fitPending, setFitPending] = useState(false);
  const measured = useNodesInitialized();

  const setDirty = useCallback((v: boolean) => { setDirtyState(v); onDirty(v); }, [onDirty]);
  const touch = useCallback(() => setDirty(true), [setDirty]);

  const selNode = nodes.find((n) => n.selected) ?? null;
  const selEdge = selNode ? null : edges.find((e) => e.selected) ?? null;

  const edgeDefaults = useMemo(() => ({
    type: 'smoothstep',
    ...(er ? {} : { markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } }),
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
  }), [er]);

  const replace = (c: DiagramContent) => {
    const f = toFlow(c);
    setNodes(f.nodes);
    setEdges(f.edges);
    touch();
    setFitPending(true);
  };

  // fit once React Flow has measured the replaced nodes
  useEffect(() => {
    if (!fitPending || !measured) return;
    rf.fitView({ padding: 0.15, duration: 300 });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot flag
    setFitPending(false);
  }, [fitPending, measured, rf]);

  const addNode = (shape?: FlowShape) => {
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = nextId('n', nodes);
    const node: FlowNode = er
      ? { id, type: 'entity', position: center, data: { label: t('newTable'), columns: [{ name: 'id', type: 'INT', pk: true }] }, selected: true }
      : { id, type: 'flow', position: center, data: { label: shape === 'decision' ? '?' : t(shape === 'process' ? 'newStep' : `shape.${shape ?? 'process'}`), shape }, selected: true };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
    touch();
  };

  const patchNode = (id: string, patch: Partial<DiagramNodeData>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    touch();
  };
  const patchEdge = (id: string, label: string) => {
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)));
    touch();
  };
  const removeSelected = () => {
    const gone = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !n.selected));
    setEdges((es) => es.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)));
    touch();
  };

  const save = async () => {
    setSaving(true);
    const { error } = await db.from('project_diagrams')
      .update({ title: title.trim() || t(`untitled.${diagram.kind}`), content: toContent(nodes, edges), updated_by: me?.id })
      .eq('id', diagram.id);
    setSaving(false);
    if (error) return notify(error.message, 'error');
    notify(t('saved'));
    setBeforeAi(null);
    await onSaved();
    setDirtyState(false);
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: t('delete.title'), description: t('delete.description', { title: diagram.title }), confirmText: t('delete.button'), destructive: true });
    if (!ok) return;
    const { error } = await db.from('project_diagrams').delete().eq('id', diagram.id);
    if (error) return notify(error.message, 'error');
    notify(t('delete.done'));
    await onDeleted();
  };

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

  // warn before closing the page with unsaved work
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label={t('titleLabel')} value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} className="h-9 max-w-sm font-semibold" maxLength={200} />
        <span className="text-xs text-muted-foreground">
          {dirty ? <span className="font-medium text-[#d9822b]">{t('unsaved')}</span> : t('updated', { time: fmtDateTime(diagram.updated_at), name: editorName })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {beforeAi && (
            <Button size="sm" variant="ghost" onClick={() => { replace(toContent(beforeAi.nodes, beforeAi.edges)); setBeforeAi(null); }}><Undo2 /> {t('ai.undo')}</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}><Sparkles className="text-[#a25ddc]" /> {t('ai.button')}</Button>
          <Button size="sm" variant="outline" disabled={!nodes.length} onClick={() => replace(layout(toContent(nodes, edges), diagram.kind))}><LayoutGrid /> {t('layout')}</Button>
          <Button size="sm" variant="outline" disabled={!nodes.length} onClick={exportPng}><Download /> {t('exportPng')}</Button>
          {canDelete && <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}><Trash2 /> {t('delete.button')}</Button>}
          <Button size="sm" disabled={!dirty || saving} onClick={save}><Save /> {t('save')}</Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row">
        <div data-diagram={diagram.id} className="relative h-[max(520px,calc(100vh-360px))] min-w-0 flex-1 overflow-hidden rounded-lg border border-grid bg-background">
          <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
            {er ? (
              <Button size="sm" variant="ghost" onClick={() => addNode()}><Plus /> {t('addTable')}</Button>
            ) : FLOW_SHAPES.map((s) => (
              <Button key={s} size="sm" variant="ghost" onClick={() => addNode(s)}>
                <span className={cn('inline-block size-3 border-2', s === 'start' || s === 'end' ? 'rounded-full' : s === 'decision' ? 'rotate-45' : s === 'io' ? '-skew-x-12' : 'rounded-[2px]')} style={{ borderColor: SHAPE_COLORS[s] }} />
                {t(`shape.${s}`)}
              </Button>
            ))}
          </div>
          <ReactFlow<FlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            defaultEdgeOptions={edgeDefaults}
            connectionMode={ConnectionMode.Loose}
            colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            onNodesChange={(ch) => { onNodesChange(ch); if (ch.some((c) => c.type === 'position' || c.type === 'remove')) touch(); }}
            onEdgesChange={(ch) => { onEdgesChange(ch); if (ch.some((c) => c.type === 'remove')) touch(); }}
            onConnect={(c) => { setEdges((es) => addEdge({ ...c, id: nextId('e', es), ...(er ? { label: 'N:1' } : {}) }, es)); touch(); }}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden md:!block" />
          </ReactFlow>
        </div>

        <aside className="rounded-lg border border-grid p-3 xl:w-72">
          {selNode ? (
            <NodePanel key={selNode.id} node={selNode} er={er} onChange={(p) => patchNode(selNode.id, p)} onRemove={removeSelected} />
          ) : selEdge ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{er ? t('props.cardinality') : t('props.edgeLabel')}</Label>
                <Input value={typeof selEdge.label === 'string' ? selEdge.label : ''} onChange={(e) => patchEdge(selEdge.id, e.target.value)} maxLength={60} />
                {er && (
                  <div className="flex gap-1">
                    {CARDINALITIES.map((c) => <Button key={c} size="xs" variant={selEdge.label === c ? 'default' : 'outline'} onClick={() => patchEdge(selEdge.id, c)}>{c}</Button>)}
                  </div>
                )}
              </div>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={removeSelected}><Trash2 /> {t('props.remove')}</Button>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{t('props.none')}</p>
              <p className="text-xs">{t('hint')}</p>
            </div>
          )}
        </aside>
      </div>

      <AiDraftDialog
        open={aiOpen} onOpenChange={setAiOpen} projectId={diagram.project_id} kind={diagram.kind}
        current={nodes.length ? toContent(nodes, edges) : null}
        onDraft={(d) => {
          setBeforeAi({ nodes, edges });
          if (d.title && (!title.trim() || title === t(`untitled.${diagram.kind}`))) setTitle(d.title);
          replace(d.content);
        }}
      />
    </div>
  );
}

function NodePanel({ node, er, onChange, onRemove }: { node: FlowNode; er: boolean; onChange: (p: Partial<DiagramNodeData>) => void; onRemove: () => void }) {
  const t = useTranslations('design');
  const cols = node.data.columns ?? [];
  const setCol = (i: number, p: Partial<ErColumn>) => onChange({ columns: cols.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{er ? t('props.tableName') : t('props.label')}</Label>
        {er
          ? <Input value={node.data.label} onChange={(e) => onChange({ label: e.target.value })} className="font-mono" maxLength={200} />
          : <Textarea value={node.data.label} onChange={(e) => onChange({ label: e.target.value })} rows={3} maxLength={200} />}
      </div>
      {!er && (
        <div className="space-y-1.5">
          <Label>{t('props.shape')}</Label>
          <div className="flex flex-wrap gap-1">
            {FLOW_SHAPES.map((s) => (
              <Button key={s} size="xs" variant={(node.data.shape ?? 'process') === s ? 'default' : 'outline'} onClick={() => onChange({ shape: s })}>{t(`shape.${s}`)}</Button>
            ))}
          </div>
        </div>
      )}
      {er && (
        <div className="space-y-1.5">
          <Label>{t('props.columns')}</Label>
          <div className="space-y-1">
            {cols.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input value={c.name} placeholder={t('props.colName')} onChange={(e) => setCol(i, { name: e.target.value })} className="h-7 min-w-0 flex-1 px-1.5 font-mono text-xs" />
                <Input value={c.type} placeholder={t('props.colType')} onChange={(e) => setCol(i, { type: e.target.value })} className="h-7 w-20 px-1.5 font-mono text-xs" />
                <label className="flex items-center gap-0.5 text-[10px]" title="Primary key"><Checkbox checked={!!c.pk} onCheckedChange={(v) => setCol(i, { pk: !!v || undefined })} />PK</label>
                <label className="flex items-center gap-0.5 text-[10px]" title="Foreign key"><Checkbox checked={!!c.fk} onCheckedChange={(v) => setCol(i, { fk: !!v || undefined })} />FK</label>
                <Button size="icon-xs" variant="ghost" aria-label={t('props.remove')} onClick={() => onChange({ columns: cols.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            ))}
          </div>
          <Button size="xs" variant="outline" onClick={() => onChange({ columns: [...cols, { name: '', type: 'VARCHAR(100)' }] })}><Plus /> {t('props.addColumn')}</Button>
        </div>
      )}
      <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}><Trash2 /> {t('props.remove')}</Button>
    </div>
  );
}

function AiDraftDialog({ open, onOpenChange, projectId, kind, current, onDraft }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: number; kind: DiagramKind; current: DiagramContent | null;
  onDraft: (d: { title: string; content: DiagramContent }) => void;
}) {
  const t = useTranslations('design.ai');
  const tc = useTranslations('common');
  const { notify } = useApp();
  const [prompt, setPrompt] = useState('');
  const [revise, setRevise] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const j = await fetch(`/api/projects/${projectId}/diagram-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, prompt, current: revise ? current : null }),
      }).then((r) => r.json());
      if (j.error) return notify(j.error.message, 'error');
      if (j.data?.off) return notify(t('off'), 'warning');
      onDraft(j.data);
      notify(t('done'));
      onOpenChange(false);
    } catch {
      notify(t('failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-[#a25ddc]" /> {t('button')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="diagram-prompt">{t('prompt')}</Label>
            <Textarea id="diagram-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={2000} placeholder={t(`placeholder.${kind}`)} />
          </div>
          {current && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={revise} onCheckedChange={(v) => setRevise(!!v)} /> {t('revise')}</label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button disabled={busy} onClick={run}><Sparkles /> {busy ? t('running') : t('run')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
