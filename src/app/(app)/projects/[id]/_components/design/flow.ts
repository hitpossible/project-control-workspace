import { type Edge, MarkerType, type Node } from '@xyflow/react';
import { type DiagramContent, type DiagramEdge, type DiagramNode, type DiagramNodeData, type EdgeLine } from '@/lib/diagram';

export type FlowNode = Node<DiagramNodeData>;

export const GRID = 16;
const GUIDE_SNAP = 6;

/** how far to move a dragged shape so one of its edges / centre lines up with another shape, and where the guide goes */
export function alignTo(id: string, pos: { x: number; y: number }, nodes: FlowNode[]) {
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

/** cardinality "N:1" → which end of the line is "many" */
export function cardinality(label: string): ['1' | 'N', '1' | 'N'] | null {
  const m = /^\s*([1N])\s*:\s*([1N])\s*$/i.exec(label);
  return m ? [m[1].toUpperCase() as '1' | 'N', m[2].toUpperCase() as '1' | 'N'] : null;
}

const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
/** what a line keeps in React Flow's `data` (line / dashed are saved on the DiagramEdge itself) */
export type EdgeData = { er?: boolean; line?: EdgeLine; dashed?: boolean };

/** a line touching an ER table is a relationship: no arrow, the label is its cardinality */
export function edgeStyle(e: DiagramEdge | Edge, nodes: { id: string; type?: string }[]): Edge {
  const er = nodes.some((n) => (n.id === e.source || n.id === e.target) && n.type === 'entity');
  const old = ('data' in e ? e.data : undefined) as EdgeData | undefined;
  const { line, dashed, ...rest } = e as DiagramEdge;
  return {
    ...(rest as Edge), type: 'labeled', markerEnd: er ? undefined : ARROW,
    data: { er, line: line ?? old?.line, dashed: dashed ?? old?.dashed },
  };
}
export const toFlow = (c: DiagramContent): { nodes: FlowNode[]; edges: Edge[] } => ({ nodes: c.nodes, edges: c.edges.map((e) => edgeStyle(e, c.nodes)) });
export function toContent(nodes: FlowNode[], edges: Edge[]): DiagramContent {
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
