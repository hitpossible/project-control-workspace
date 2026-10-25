'use client';

import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, Handle, type NodeProps, NodeResizeControl, NodeResizer, NodeToolbar, Position, ResizeControlVariant, ViewportPortal, getBezierPath, getSmoothStepPath, getStraightPath, useReactFlow } from '@xyflow/react';
import { Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Tip } from '@/components/shared/common';
import { Button } from '@/components/ui/button';
import { type DiagramNodeData, type ErColumn, FLOW_SHAPES, type EdgeLine, EDGE_LINES, type FlowShape, type TextStyle, ENTITY_WIDTH, nodeSize } from '@/lib/diagram';
import { cn } from '@/lib/utils';
import { type EdgeData, type FlowNode, cardinality } from './flow';

const CARDINALITIES = ['1:1', 'N:1', '1:N', 'N:N'];

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

export function ShapeGlyph({ shape, className }: { shape: FlowShape; className?: string }) {
  const common = { fill: 'var(--background)', stroke: 'currentColor', strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)}>
      {shape === 'decision' ? <polygon points="12,3 21,12 12,21 3,12" {...common} />
        : shape === 'io' ? <polygon points="7,6 22,6 17,18 2,18" {...common} />
          : <rect x="2.5" y="6" width="19" height="12" rx={shape === 'process' ? 2 : 6} {...common} />}
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
export function ErMarkers() {
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

export const NODE_TYPES = { flow: FlowShapeNode, entity: EntityNode };
export const EDGE_TYPES = { labeled: LabeledEdge };
