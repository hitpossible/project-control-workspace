'use client';

import '@xyflow/react/dist/style.css';
import {
  Background, BaseEdge, ConnectionMode, Controls, type Edge, EdgeLabelRenderer, type EdgeProps, Handle, MarkerType, MiniMap, type Node,
  type NodeProps, NodeResizeControl, NodeResizer, NodeToolbar, Position, ResizeControlVariant, ReactFlow, ReactFlowProvider, ViewportPortal, addEdge, getBezierPath, getNodesBounds, getSmoothStepPath, getStraightPath, getViewportForBounds,
  type NodeChange, useEdgesState, useNodesState, useReactFlow,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, ChevronDown, Copy, Database, FileCode, FileInput, FoldVertical,
  Grid3x3, Italic, Type, Underline, Download, Info, LayoutGrid, Maximize2, Minimize2, PenTool, Plus, Redo2, Save, Scan, Sparkles, Trash2, Undo2, Workflow, X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EmptyState, Tip } from '@/components/common';
import { confirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { dbClient } from '@/lib/db/client';
import {
  type DiagramContent, type DiagramEdge, type DiagramKind, type DiagramNode, type DiagramNodeData, type ErColumn, FLOW_SHAPES,
  type DiagramDraft, type EdgeLine, EDGE_LINES, type FlowShape, type ProjectDiagram, type TextStyle, ENTITY_WIDTH, emptyContent, fromDraft, layout, mergeDraft, nodeSize, ofKind, pasteContent,
} from '@/lib/diagram';
import { fromSql, toSql } from '@/lib/diagramSql';
import { errMsg, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

type FlowNode = Node<DiagramNodeData>;

const CARDINALITIES = ['1:1', 'N:1', '1:N', 'N:N'];
const MAX_HISTORY = 100;
const GRID = 16;
const GUIDE_SNAP = 6;
const CLIPBOARD_KEY = 'pcw-diagram-clipboard';

/** how far to move a dragged shape so one of its edges / centre lines up with another shape, and where the guide goes */
function alignTo(id: string, pos: { x: number; y: number }, nodes: FlowNode[]) {
  const me = nodes.find((n) => n.id === id);
  const w = me?.measured?.width ?? 0, h = me?.measured?.height ?? 0;
  const mine = { x: [pos.x, pos.x + w / 2, pos.x + w], y: [pos.y, pos.y + h / 2, pos.y + h] };
  let best = { dx: 0, x: undefined as number | undefined, ex: GUIDE_SNAP + 1, dy: 0, y: undefined as number | undefined, ey: GUIDE_SNAP + 1 };
  for (const o of nodes) {
    if (o.id === id || !o.measured?.width) continue;
    const ow = o.measured.width, oh = o.measured.height ?? 0;
    const theirs = { x: [o.position.x, o.position.x + ow / 2, o.position.x + ow], y: [o.position.y, o.position.y + oh / 2, o.position.y + oh] };
    for (const a of mine.x) for (const b of theirs.x) if (Math.abs(b - a) < best.ex) best = { ...best, dx: b - a, x: b, ex: Math.abs(b - a) };
    for (const a of mine.y) for (const b of theirs.y) if (Math.abs(b - a) < best.ey) best = { ...best, dy: b - a, y: b, ey: Math.abs(b - a) };
  }
  return { dx: best.dx, dy: best.dy, x: best.x, y: best.y };
}

/** undo history of a drawing: earlier states, undone states, and the state now on screen (JSON of DiagramContent) */
type History = { past: string[]; future: string[]; last: string };
const pushed = (h: History, current: string): History =>
  (current === h.last ? h : { past: [...h.past.slice(-(MAX_HISTORY - 1)), h.last], future: [], last: current });
const DRAG_TYPE = 'application/x-pcw-shape';

/**
 * Text edited in place: a click while its shape is selected (or a double-click any time) turns it into an input;
 * Enter or leaving the field keeps the change, Esc drops it. `nodrag nopan` keeps React Flow from dragging while typing.
 */
function InlineText({ value, onCommit, active, multiline, placeholder, className, inputClassName, style }: {
  value: string; onCommit: (v: string) => void; active?: boolean; multiline?: boolean; placeholder?: string;
  className?: string; inputClassName?: string; style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onCommit(draft.trim());
    setDraft(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') setDraft(null);
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); commit(); }
  };
  if (draft !== null) {
    const cls = cn('nodrag nopan w-full rounded-sm bg-background px-1 outline-2 outline-[#0073ea]', inputClassName);
    return multiline
      ? <textarea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={keys} onFocus={(e) => e.target.select()} className={cn(cls, 'resize-none text-center')} style={style} />
      : <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={keys} onFocus={(e) => e.target.select()} className={cls} style={style} />;
  }
  return (
    <span
      className={cn(active && 'cursor-text', !value && 'text-muted-foreground/70 italic', className)} style={style}
      onClick={(e) => { if (active) { e.stopPropagation(); setDraft(value); } }}
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(value); }}
    >
      {value || placeholder}
    </span>
  );
}

const FLEX: Record<string, string> = { top: 'flex-start', left: 'flex-start', middle: 'center', center: 'center', bottom: 'flex-end', right: 'flex-end' };

/** CSS for text formatted in the format panel; `base` is the shape's own default */
function textCss(ts: TextStyle | undefined, base: { size: number; weight?: number }): React.CSSProperties {
  return {
    fontFamily: ts?.font, fontSize: ts?.size ?? base.size, fontWeight: ts?.bold ? 700 : base.weight,
    fontStyle: ts?.italic ? 'italic' : undefined, textDecoration: ts?.underline ? 'underline' : undefined,
    writingMode: ts?.vertical ? 'vertical-rl' : undefined,
  };
}

/** a handle on every side; with ConnectionMode.Loose any of them can start or end a line */
function Handles() {
  const cls = '!size-2.5 !border-white !bg-[#0073ea] opacity-0 transition-opacity group-hover:opacity-100';
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" className={cls} />
      <Handle type="source" position={Position.Right} id="r" className={cls} />
      <Handle type="source" position={Position.Bottom} id="b" className={cls} />
      <Handle type="source" position={Position.Left} id="l" className={cls} />
    </>
  );
}

function ShapeGlyph({ shape, className }: { shape: FlowShape; className?: string }) {
  const common = { fill: 'var(--background)', stroke: 'currentColor', strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)}>
      {shape === 'decision' ? <polygon points="12,3 21,12 12,21 3,12" {...common} />
        : shape === 'io' ? <polygon points="7,6 22,6 17,18 2,18" {...common} />
          : <rect x="2.5" y="6" width="19" height="12" rx={shape === 'process' ? 2 : 6} {...common} />}
    </svg>
  );
}

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

function DeleteTool({ id }: { id: string }) {
  const t = useTranslations('design.props');
  const { deleteElements } = useReactFlow();
  return (
    <Tip title={t('remove')}>
      <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => deleteElements({ nodes: [{ id }] })}><Trash2 /></Button>
    </Tip>
  );
}

/** flowchart shape: white with a black outline, resizable by its corner / edge handles when selected */
function FlowShapeNode({ id, data, selected, width: w, height: h }: NodeProps<FlowNode>) {
  const t = useTranslations('design');
  const { updateNodeData } = useReactFlow();
  const shape = data.shape ?? 'process';
  const { width, height } = nodeSize({ id, type: 'flow', position: { x: 0, y: 0 }, width: w, height: h, data });
  const set = (patch: Partial<DiagramNodeData>) => { updateNodeData(id, patch); };
  const ts = data.text;
  const slant = Math.min(22, width / 5);
  // keep the text inside the drawn outline: a diamond / parallelogram has less room than its box
  const padding = shape === 'decision' ? `${Math.round(height * 0.2)}px ${Math.round(width * 0.2)}px`
    : shape === 'io' ? `4px ${Math.round(slant + 4)}px` : shape === 'process' ? '4px 8px' : '4px 14px';
  const label = (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{ padding, justifyContent: FLEX[ts?.valign ?? 'middle'], alignItems: ts?.vertical ? FLEX[ts.align ?? 'center'] : 'stretch' }}
    >
      <InlineText value={data.label} active={selected} multiline onCommit={(v) => set({ label: v })}
        className="leading-tight break-words whitespace-pre-wrap" inputClassName="text-xs"
        style={{ ...textCss(ts, { size: 12, weight: 500 }), textAlign: ts?.align ?? 'center' }} />
    </div>
  );
  const toolbar = (
    <NodeToolbar isVisible={selected} position={Position.Top} className="flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-md">
      {FLOW_SHAPES.map((s) => (
        <Tip key={s} title={t(`shape.${s}`)}>
          <Button size="icon-sm" variant={s === shape ? 'secondary' : 'ghost'} onClick={() => set({ shape: s })}><ShapeGlyph shape={s} /></Button>
        </Tip>
      ))}
      <span className="mx-0.5 h-5 w-px bg-border" />
      <DeleteTool id={id} />
    </NodeToolbar>
  );
  const resizer = (
    <NodeResizer isVisible={selected} minWidth={60} minHeight={36} color="#0073ea"
      handleClassName="!size-2 !rounded-[2px] !border-white" lineClassName="!border-[#0073ea]/60" />
  );
  const ring = selected ? 'drop-shadow-[0_0_0.3rem_rgba(0,115,234,0.45)]' : '';
  if (shape === 'decision' || shape === 'io') {
    const points = shape === 'decision'
      ? `${width / 2},1.5 ${width - 1.5},${height / 2} ${width / 2},${height - 1.5} 1.5,${height / 2}`
      : `${slant},1.5 ${width - 1.5},1.5 ${width - slant},${height - 1.5} 1.5,${height - 1.5}`;
    return (
      <div className={cn('group relative', ring)} style={{ width, height }}>
        {resizer}
        {toolbar}
        <svg className="absolute inset-0 text-foreground" width={width} height={height}>
          <polygon points={points} fill="var(--background)" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
        {label}
        <Handles />
      </div>
    );
  }
  return (
    <div
      className={cn('group relative border-[1.5px] border-foreground bg-background', shape === 'process' ? 'rounded-[3px]' : 'rounded-full', ring)}
      style={{ width, height }}
    >
      {resizer}
      {toolbar}
      {label}
      <Handles />
    </div>
  );
}

/** ER table in the draw.io style: name bar with a collapse box, PK rows above a rule, other columns below */
function EntityNode({ id, data, selected, width }: NodeProps<FlowNode>) {
  const t = useTranslations('design');
  const { updateNodeData, updateNode } = useReactFlow();
  const cols = data.columns ?? [];
  const set = (patch: Partial<DiagramNodeData>) => { updateNodeData(id, patch); };
  const setCol = (i: number, p: Partial<ErColumn>) => set({ columns: cols.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  // click the key cell to step through none → PK → FK
  const cycleKey = (i: number) => {
    const c = cols[i];
    setCol(i, c.pk ? { pk: undefined, fk: true } : c.fk ? { pk: undefined, fk: undefined } : { pk: true, fk: undefined });
  };
  const ts = data.text;
  const size = ts?.size ?? 13;
  const keyed = cols.map((c, i) => ({ c, i }));
  const pks = keyed.filter((x) => x.c.pk), rest = keyed.filter((x) => !x.c.pk);

  const row = ({ c, i }: { c: ErColumn; i: number }) => (
    <div key={i} className="group/row grid min-h-[30px] grid-cols-[44px_1fr] items-stretch">
      <button
        type="button" disabled={!selected} onClick={() => cycleKey(i)} title={selected ? 'PK / FK' : undefined}
        className={cn('nodrag flex items-center justify-center border-r-2 border-foreground/85 text-xs font-bold', selected && 'hover:bg-muted', c.fk && !c.pk && 'font-semibold text-[#a25ddc]')}
      >
        {c.pk ? 'PK' : c.fk ? 'FK' : ''}
      </button>
      <div className="flex min-w-0 items-center gap-1.5 px-2.5">
        <InlineText value={c.name} active={selected} placeholder={t('props.colName')} onCommit={(v) => setCol(i, { name: v })}
          className={cn('min-w-0 truncate', c.pk && 'font-semibold underline underline-offset-2')} style={textCss({ ...ts, vertical: false }, { size })} />
        <InlineText value={c.type} active={selected} placeholder={t('props.colType')} onCommit={(v) => setCol(i, { type: v })}
          className="ml-auto max-w-[45%] shrink-0 truncate font-mono text-muted-foreground" inputClassName="ml-auto w-[45%] font-mono"
          style={{ fontSize: Math.max(9, size - 3) }} />
        {selected && (
          <button type="button" aria-label={t('props.remove')} onClick={() => set({ columns: cols.filter((_, j) => j !== i) })}
            className="nodrag -mr-1 hidden size-4 shrink-0 place-items-center rounded text-muted-foreground group-hover/row:grid hover:bg-destructive/10 hover:text-destructive">
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={cn('group relative border-2 border-foreground/85 bg-background', selected && 'outline-2 outline-offset-2 outline-[#0073ea]')} style={{ width: width || ENTITY_WIDTH }}>
      {selected && (['left', 'right'] as const).map((side) => (
        <NodeResizeControl
          key={side} position={side} variant={ResizeControlVariant.Line} resizeDirection="horizontal" minWidth={160} maxWidth={640}
          className="!border-x-[3px] !border-[#0073ea]/50"
          // the resizer also pins the height; drop it so the table keeps growing with its columns
          onResizeEnd={() => updateNode(id, { height: undefined })}
        />
      ))}
      <NodeToolbar isVisible={selected} position={Position.Top} className="flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-md">
        <Button size="sm" variant="ghost" onClick={() => set({ columns: [...cols, { name: '', type: 'VARCHAR(100)' }], collapsed: false })}><Plus /> {t('props.addColumn')}</Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <DeleteTool id={id} />
      </NodeToolbar>
      <div className="relative flex min-h-10 items-center border-b-2 border-foreground/85 px-8" style={{ justifyContent: FLEX[ts?.align ?? 'center'] }}>
        <button
          type="button" aria-label="collapse" onClick={() => set({ collapsed: !data.collapsed })}
          className="nodrag absolute top-1.5 left-1.5 grid size-3.5 place-items-center border border-foreground/60 bg-muted text-[11px] leading-none font-bold"
        >
          {data.collapsed ? '+' : '−'}
        </button>
        <InlineText value={data.label} active={selected} onCommit={(v) => set({ label: v || t('newTable') })}
          className="truncate" inputClassName="text-center"
          style={{ ...textCss({ ...ts, vertical: false }, { size: size + 1, weight: 700 }), fontWeight: 700 }} />
      </div>
      {!data.collapsed && (
        <>
          {pks.map(row)}
          {pks.length > 0 && rest.length > 0 && <div className="border-t-2 border-foreground/85" />}
          {rest.map(row)}
          {!cols.length && <div className="grid h-[30px] grid-cols-[44px_1fr]"><span className="border-r-2 border-foreground/85" /></div>}
        </>
      )}
      <Handles />
    </div>
  );
}

/** markers for ER relationships (crow's foot), drawn inside the viewport so the PNG export keeps them */
function ErMarkers() {
  const common = { viewBox: '0 0 16 16', refX: 16, refY: 8, markerWidth: 16, markerHeight: 16, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' } as const;
  const stroke = { fill: 'none', strokeWidth: 1.4, style: { stroke: 'var(--xy-edge-stroke, #b1b1b7)' } };
  return (
    <ViewportPortal>
      <svg className="absolute size-0 overflow-visible" aria-hidden>
        <defs>
          <marker id="pcw-many" {...common}><path d="M1 8H16M3 8L16 1.5M3 8L16 14.5" {...stroke} /></marker>
          <marker id="pcw-one" {...common}><path d="M1 8H16M9 2.5V13.5M13 2.5V13.5" {...stroke} /></marker>
        </defs>
      </svg>
    </ViewportPortal>
  );
}

/** cardinality "N:1" → which end of the line is "many" */
function cardinality(label: string): ['1' | 'N', '1' | 'N'] | null {
  const m = /^\s*([1N])\s*:\s*([1N])\s*$/i.exec(label);
  return m ? [m[1].toUpperCase() as '1' | 'N', m[2].toUpperCase() as '1' | 'N'] : null;
}

const LINE_ICON: Record<EdgeLine, React.ReactNode> = {
  step: <svg viewBox="0 0 16 16" className="size-4"><path d="M2 13V8h12V3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>,
  straight: <svg viewBox="0 0 16 16" className="size-4"><path d="M2 14L14 2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>,
  curve: <svg viewBox="0 0 16 16" className="size-4"><path d="M2 14C2 6 14 10 14 2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>,
};

/**
 * A line: routed step / straight / curve, solid or dashed. Flowchart lines carry free text; a line touching an ER
 * table is a relationship drawn with crow's-foot ends, its cardinality picked from the bar shown while selected.
 */
function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, selected, markerEnd, style, data }: EdgeProps<Edge>) {
  const t = useTranslations('design');
  const { setEdges } = useReactFlow();
  const d = (data ?? {}) as EdgeData;
  const geo = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, lx, ly] = d.line === 'straight' ? getStraightPath(geo) : d.line === 'curve' ? getBezierPath(geo) : getSmoothStepPath(geo);
  const text = typeof label === 'string' ? label : '';
  const patch = (p: Partial<Edge>) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const setData = (p: Partial<EdgeData>) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...p } } : e)));
  const card = d.er ? cardinality(text) : null;
  const mark = (side: '1' | 'N') => (side === 'N' ? 'url(#pcw-many)' : 'url(#pcw-one)');
  return (
    <>
      <BaseEdge
        id={id} path={path}
        markerStart={card ? mark(card[0]) : undefined}
        markerEnd={card ? mark(card[1]) : markerEnd}
        style={{ ...style, strokeWidth: selected ? 2.5 : 1.5, stroke: selected ? '#0073ea' : style?.stroke, strokeDasharray: d.dashed ? '6 4' : undefined }}
      />
      {((text && !card) || selected) && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan absolute flex flex-col items-center gap-1" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'all' }}>
            {!d.er && (
              <InlineText value={text} active={selected} onCommit={(v) => patch({ label: v || undefined })} placeholder={`+ ${t('props.edgeLabel')}`}
                className="rounded border bg-background px-1.5 py-0.5 text-[11px]" inputClassName="w-28 border text-[11px]" />
            )}
            {selected && (
              <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-sm">
                {d.er && CARDINALITIES.map((c) => <Button key={c} size="xs" variant={text === c ? 'default' : 'ghost'} onClick={() => patch({ label: c })}>{c}</Button>)}
                {d.er && <span className="mx-0.5 h-4 w-px bg-border" />}
                {EDGE_LINES.map((l) => (
                  <Tip key={l} title={t(`line.${l}`)}>
                    <Button size="icon-xs" variant={(d.line ?? 'step') === l ? 'secondary' : 'ghost'} onClick={() => setData({ line: l === 'step' ? undefined : l })}>{LINE_ICON[l]}</Button>
                  </Tip>
                ))}
                <Tip title={t('line.dashed')}>
                  <Button size="icon-xs" variant={d.dashed ? 'secondary' : 'ghost'} onClick={() => setData({ dashed: !d.dashed || undefined })}>
                    <svg viewBox="0 0 16 16" className="size-4"><path d="M1 8H15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2" /></svg>
                  </Button>
                </Tip>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const FONTS = ['Sarabun', 'Helvetica', 'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];
const DEFAULT_FONT = 'default';

/** right-hand panel: text formatting of the selected shapes / tables (draw.io's "Text" panel) */
function FormatPanel({ selected }: { selected: FlowNode[] }) {
  const t = useTranslations('design.format');
  const { updateNodeData } = useReactFlow();
  const ts = selected[0].data.text ?? {};
  const onlyTables = selected.every((n) => n.type === 'entity');
  const apply = (patch: Partial<TextStyle>) => {
    for (const n of selected) updateNodeData(n.id, (node) => ({ text: { ...(node.data as DiagramNodeData).text, ...patch } }));
  };
  const [size, setSize] = useState(String(ts.size ?? ''));
  const commitSize = () => {
    const v = Math.round(Number(size));
    apply({ size: size.trim() && v ? Math.min(72, Math.max(8, v)) : undefined });
  };
  const btn = (key: string, tip: string, icon: React.ReactNode, on: boolean, onClick: () => void, disabled?: boolean) => (
    <Tip key={key} title={tip}>
      <Button size="icon-sm" variant={on ? 'secondary' : 'ghost'} aria-pressed={on} disabled={disabled} onClick={onClick}>{icon}</Button>
    </Tip>
  );
  return (
    <div className="nowheel absolute top-2 right-2 z-10 w-56 space-y-2.5 rounded-lg border bg-background/95 p-3 shadow-md">
      <p className="text-xs font-semibold">{t('title')}</p>
      <Select value={ts.font ?? DEFAULT_FONT} onValueChange={(v) => apply({ font: v === DEFAULT_FONT ? undefined : v })}>
        <SelectTrigger size="sm" className="w-full" aria-label={t('font')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_FONT}>{t('defaultFont')}</SelectItem>
          {FONTS.map((f) => <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-0.5">
        {btn('b', t('bold'), <Bold />, !!ts.bold, () => apply({ bold: !ts.bold || undefined }))}
        {btn('i', t('italic'), <Italic />, !!ts.italic, () => apply({ italic: !ts.italic || undefined }))}
        {btn('u', t('underline'), <Underline />, !!ts.underline, () => apply({ underline: !ts.underline || undefined }))}
        {btn('v', t('vertical'), <Type className="-rotate-90" />, !!ts.vertical, () => apply({ vertical: !ts.vertical || undefined }), onlyTables)}
        <div className="ml-auto flex items-center gap-1">
          <Input
            type="number" min={8} max={72} value={size} placeholder={onlyTables ? '13' : '12'} aria-label={t('size')}
            onChange={(e) => setSize(e.target.value)} onBlur={commitSize} onKeyDown={(e) => { if (e.key === 'Enter') commitSize(); }}
            className="h-7 w-14 px-1.5 text-right text-xs"
          />
          <span className="text-xs text-muted-foreground">px</span>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        {btn('al', t('alignLeft'), <AlignLeft />, ts.align === 'left', () => apply({ align: 'left' }))}
        {btn('ac', t('alignCenter'), <AlignCenter />, (ts.align ?? 'center') === 'center', () => apply({ align: undefined }))}
        {btn('ar', t('alignRight'), <AlignRight />, ts.align === 'right', () => apply({ align: 'right' }))}
        <span className="mx-auto h-5 w-px bg-border" />
        {btn('vt', t('top'), <ArrowUpToLine />, ts.valign === 'top', () => apply({ valign: 'top' }), onlyTables)}
        {btn('vm', t('middle'), <FoldVertical />, !onlyTables && (ts.valign ?? 'middle') === 'middle', () => apply({ valign: undefined }), onlyTables)}
        {btn('vb', t('bottom'), <ArrowDownToLine />, ts.valign === 'bottom', () => apply({ valign: 'bottom' }), onlyTables)}
      </div>
    </div>
  );
}

const NODE_TYPES = { flow: FlowShapeNode, entity: EntityNode };
const EDGE_TYPES = { labeled: LabeledEdge };

const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
/** what a line keeps in React Flow's `data` (line / dashed are saved on the DiagramEdge itself) */
type EdgeData = { er?: boolean; line?: EdgeLine; dashed?: boolean };

/** a line touching an ER table is a relationship: no arrow, the label is its cardinality */
function edgeStyle(e: DiagramEdge | Edge, nodes: { id: string; type?: string }[]): Edge {
  const er = nodes.some((n) => (n.id === e.source || n.id === e.target) && n.type === 'entity');
  const old = ('data' in e ? e.data : undefined) as EdgeData | undefined;
  const { line, dashed, ...rest } = e as DiagramEdge;
  return {
    ...(rest as Edge), type: 'labeled', markerEnd: er ? undefined : ARROW,
    data: { er, line: line ?? old?.line, dashed: dashed ?? old?.dashed },
  };
}
const toFlow = (c: DiagramContent): { nodes: FlowNode[]; edges: Edge[] } => ({ nodes: c.nodes, edges: c.edges.map((e) => edgeStyle(e, c.nodes)) });
function toContent(nodes: FlowNode[], edges: Edge[]): DiagramContent {
  return {
    nodes: nodes.map((n) => ({
      id: n.id, type: n.type as DiagramNode['type'], position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      ...(n.type === 'flow' && n.width && n.height ? { width: Math.round(n.width), height: Math.round(n.height) } : {}),
      ...(n.type === 'entity' && n.width ? { width: Math.round(n.width) } : {}),
      data: n.data,
    })),
    edges: edges.map((e): DiagramEdge => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
      ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
      ...((e.data as EdgeData | undefined)?.line ? { line: (e.data as EdgeData).line } : {}),
      ...((e.data as EdgeData | undefined)?.dashed ? { dashed: true } : {}),
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
  const create = async () => {
    if (!(await leave())) return;
    const { data: row, error } = await db.from('project_diagrams')
      .insert({ project_id: projectId, title: t('untitled'), content: emptyContent() }).select('*').single();
    if (error) return notify(error.message, 'error');
    await load();
    setDirty(false);
    setSelId((row as ProjectDiagram).id);
  };

  const current = list?.find((d) => d.id === selId) ?? null;
  if (!list) return null;

  if (!current) {
    return (
      <div className="rounded-lg border border-dashed border-grid py-6">
        <EmptyState text={t('empty')} />
        <div className="flex justify-center">
          <Button variant="outline" onClick={create}><Plus /> {t('newDiagram')}</Button>
        </div>
      </div>
    );
  }

  const picker = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('diagrams')}><PenTool className="text-[#0073ea]" /> {t('diagrams')} ({list.length})<ChevronDown /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {list.map((d) => (
          <DropdownMenuItem key={d.id} onSelect={() => open(d.id)} className={cn(d.id === selId && 'bg-selected')}>
            <PenTool className="text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{d.title}{d.id === selId && dirty ? ' •' : ''}</span>
              <span className="block truncate text-xs text-muted-foreground">{fmtDateTime(d.updated_at)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={create}><Plus /> {t('newDiagram')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ReactFlowProvider key={current.id}>
      <Editor
        diagram={current}
        picker={picker}
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
  );
}

function Editor({ diagram, picker, canDelete, onDirty, onSaved, onDeleted, editorName }: {
  diagram: ProjectDiagram; picker: React.ReactNode; canDelete: boolean; editorName: string;
  onDirty: (v: boolean) => void; onSaved: () => Promise<void>; onDeleted: () => Promise<void>;
}) {
  const t = useTranslations('design');
  const db = dbClient();
  const { me, notify } = useApp();
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow<FlowNode, Edge>();
  const initial = useMemo(() => toFlow(diagram.content ?? emptyContent()), [diagram.content]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [title, setTitle] = useState(diagram.title);
  const [saving, setSaving] = useState(false);
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
   * Undo / redo: every settled change of the drawing (not selection or zoom) becomes a step. Changes are recorded
   * once they pause, so a drag or a resize is one step; the title is not part of the history.
   */
  const snap = useMemo(() => JSON.stringify(toContent(nodes, edges)), [nodes, edges]);
  const [hist, setHist] = useState<History>({ past: [], future: [], last: snap });
  // unsaved = differs from what was last loaded or saved (so undoing back to it clears the flag)
  const [saved, setSaved] = useState({ snap, title: diagram.title });
  const dirty = snap !== saved.snap || title !== saved.title;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const busy = nodes.some((n) => n.dragging || n.resizing);
  useEffect(() => {
    if (busy || snap === hist.last) return;
    const id = setTimeout(() => setHist((h) => pushed(h, snap)), 300);
    return () => clearTimeout(id);
  }, [snap, busy, hist.last]);
  const step = (dir: 'undo' | 'redo') => {
    // a change still waiting to be recorded becomes a step first
    const h = busy ? hist : pushed(hist, snap);
    const target = (dir === 'undo' ? h.past : h.future).at(-1);
    if (target === undefined) return setHist(h);
    setHist(dir === 'undo'
      ? { past: h.past.slice(0, -1), future: [...h.future, h.last], last: target }
      : { past: [...h.past, h.last], future: h.future.slice(0, -1), last: target });
    const f = toFlow(JSON.parse(target) as DiagramContent);
    setNodes(f.nodes);
    setEdges(f.edges);
  };
  const canUndo = hist.past.length > 0 || (!busy && snap !== hist.last);
  const canRedo = hist.future.length > 0;
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

  // Ctrl / ⌘ + Z undoes, + Shift + Z or + Y redoes — except while typing, where the field keeps its own undo
  const stepRef = useRef(step);
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
    const id = nextId('n', nodes);
    const node: FlowNode = tool === 'entity'
      ? { id, type: 'entity', position, data: { label: t('newTable'), columns: [{ name: 'id', type: 'INT', pk: true }] }, selected: true }
      : { id, type: 'flow', position, data: { label: tool === 'decision' ? '?' : t(tool === 'process' ? 'newStep' : `shape.${tool}`), shape: tool }, selected: true };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
  };

  const save = async () => {
    setSaving(true);
    const { error } = await db.from('project_diagrams')
      .update({ title: title.trim() || t('untitled'), content: toContent(nodes, edges), updated_by: me?.id })
      .eq('id', diagram.id);
    setSaving(false);
    if (error) return notify(error.message, 'error');
    setSaved({ snap, title });
    notify(t('saved'));
    await onSaved();
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
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {dirty ? <span className="font-medium text-[#d9822b]">{t('unsaved')}</span> : t('updated', { time: fmtDateTime(diagram.updated_at), name: editorName })}
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
            <Button size="sm" disabled={!dirty || saving} onClick={save}><Save /> {t('save')}</Button>
          </div>
        </div>

        <div
          data-diagram={diagram.id}
          className={cn('relative overflow-hidden rounded-lg border border-grid bg-background', maximized ? 'min-h-0 flex-1' : 'h-[max(600px,calc(100vh-290px))]')}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
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
            onNodeDragStop={() => setGuides({})}
            onConnect={(c) => {
              setEdges((es) => {
                const edge = edgeStyle({ ...c, id: nextId('e', es) }, nodes);
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
            if (from && to) merged.edges.push({ id: nextId('e', merged.edges), source: from.id, target: to.id, label: 'N:1' });
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

function AiDraftDialog({ open, onOpenChange, projectId, current, onDraft }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: number; current: DiagramContent;
  onDraft: (d: { title: string; content: DiagramContent }, kind: DiagramKind, revise: boolean) => void;
}) {
  const t = useTranslations('design.ai');
  const tk = useTranslations('design.kind');
  const tc = useTranslations('common');
  const { notify } = useApp();
  const [prompt, setPrompt] = useState('');
  // default to whatever the canvas already has the most of
  const [kind, setKind] = useState<DiagramKind>(() => {
    const tables = current.nodes.filter((n) => n.type === 'entity').length;
    return tables > current.nodes.length - tables ? 'er' : 'flowchart';
  });
  const [revise, setRevise] = useState(true);
  const [busy, setBusy] = useState(false);
  const existing = ofKind(current, kind);
  const others = current.nodes.length - existing.nodes.length;

  const run = async () => {
    setBusy(true);
    const rev = revise && existing.nodes.length > 0;
    try {
      const j = await fetch(`/api/projects/${projectId}/diagram-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, prompt, current: rev ? existing : null }),
      }).then((r) => r.json());
      if (j.error) return notify(j.error.message, 'error');
      if (j.data?.off) return notify(t('off'), 'warning');
      onDraft(j.data, kind, rev);
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
            <Label>{t('what')}</Label>
            <div className="flex gap-2">
              {(['flowchart', 'er'] as const).map((k) => (
                <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)}>
                  {k === 'er' ? <Database /> : <Workflow />} {tk(k)}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diagram-prompt">{t('prompt')}</Label>
            <Textarea id="diagram-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={2000} placeholder={t(`placeholder.${kind}`)} />
          </div>
          {existing.nodes.length > 0 && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={revise} onCheckedChange={(v) => setRevise(!!v)} /> {t(`revise.${kind}`)}</label>
          )}
          {(others > 0 || (existing.nodes.length > 0 && !revise)) && (
            <p className="text-xs text-muted-foreground">{t('placedBeside')}</p>
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

/** ER ↔ SQL: export shows the CREATE TABLE script (copy / download), import reads pasted DDL into tables */
function SqlDialog({ mode, onClose, title, content, onImport }: {
  mode: 'export' | 'import' | null; onClose: () => void; title: string; content: DiagramContent;
  onImport: (draft: DiagramDraft, replaceTables: boolean) => void;
}) {
  const t = useTranslations('design.sql');
  const tc = useTranslations('common');
  const { notify } = useApp();
  const [text, setText] = useState('');
  const [replaceTables, setReplaceTables] = useState(false);
  const sql = useMemo(() => (mode === 'export' ? toSql(content, title) : ''), [mode, content, title]);
  const hasTables = content.nodes.some((n) => n.type === 'entity');

  const copy = async () => {
    await navigator.clipboard.writeText(sql);
    notify(t('copied'));
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sql], { type: 'application/sql' }));
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.sql`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const runImport = () => {
    const draft = fromSql(text);
    if (!draft.nodes.length) return notify(t('noTables'), 'warning');
    onImport(draft, replaceTables);
    notify(t('imported', { n: draft.nodes.length }));
    setText('');
    onClose();
  };

  return (
    <Dialog open={!!mode} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Database className="size-4 text-[#0073ea]" /> {mode === 'import' ? t('import') : t('export')}</DialogTitle>
          <DialogDescription>{mode === 'import' ? t('importHint') : t('exportHint')}</DialogDescription>
        </DialogHeader>
        {mode === 'export' ? (
          <Textarea readOnly value={sql} rows={18} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        ) : (
          <div className="space-y-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="font-mono text-xs" placeholder={'CREATE TABLE customers (\n  id INT PRIMARY KEY,\n  name VARCHAR(100)\n);'} />
            {hasTables && (
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={replaceTables} onCheckedChange={(v) => setReplaceTables(!!v)} /> {t('replace')}</label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>
          {mode === 'export' ? (
            <>
              <Button variant="outline" onClick={copy}><Copy /> {t('copy')}</Button>
              <Button onClick={download}><Download /> {t('download')}</Button>
            </>
          ) : (
            <Button disabled={!text.trim()} onClick={runImport}><FileInput /> {t('run')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
