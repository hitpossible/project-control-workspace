import dagre from '@dagrejs/dagre';

/** Design diagrams on the project's Design tab — stored in project_diagrams.content as React Flow nodes / edges. */
export type DiagramKind = 'flowchart' | 'er';
export const DIAGRAM_KINDS: DiagramKind[] = ['flowchart', 'er'];

export type FlowShape = 'start' | 'process' | 'decision' | 'io' | 'end';
export const FLOW_SHAPES: FlowShape[] = ['start', 'process', 'decision', 'io', 'end'];

export interface ErColumn { name: string; type: string; pk?: boolean; fk?: boolean }

export interface DiagramNodeData extends Record<string, unknown> {
  label: string;
  /** flowchart nodes */
  shape?: FlowShape;
  /** ER entities */
  columns?: ErColumn[];
}

export interface DiagramNode {
  id: string;
  type: 'flow' | 'entity';
  position: { x: number; y: number };
  data: DiagramNodeData;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export interface DiagramContent { nodes: DiagramNode[]; edges: DiagramEdge[] }

export interface ProjectDiagram {
  id: number; project_id: number; kind: DiagramKind; title: string; content: DiagramContent;
  created_by: number; updated_by: number | null; created_at: string; updated_at: string;
}

export const emptyContent = (): DiagramContent => ({ nodes: [], edges: [] });

/** Compact form the LLM reads and writes — no positions, the layout is computed afterwards */
export interface DiagramDraft {
  title?: string;
  nodes: { id: string; label: string; shape?: FlowShape; columns?: ErColumn[] }[];
  edges: { from: string; to: string; label?: string }[];
}

const MAX_NODES = 80;
const MAX_LABEL = 200;
const str = (v: unknown, max = MAX_LABEL) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Untrusted draft (LLM reply) → diagram content with unique ids and no dangling edges, laid out top to bottom */
export function fromDraft(kind: DiagramKind, raw: unknown): { title: string; content: DiagramContent } {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ids = new Map<string, string>();
  const nodes: DiagramNode[] = [];
  for (const n of Array.isArray(d.nodes) ? d.nodes.slice(0, MAX_NODES) : []) {
    const o = (n ?? {}) as Record<string, unknown>;
    const key = str(o.id, 60) || `n${nodes.length + 1}`;
    if (ids.has(key)) continue;
    const id = `n${nodes.length + 1}`;
    ids.set(key, id);
    const label = str(o.label) || key;
    if (kind === 'er') {
      const columns = (Array.isArray(o.columns) ? o.columns : []).slice(0, 40).map((c) => {
        const col = (c ?? {}) as Record<string, unknown>;
        return { name: str(col.name, 80), type: str(col.type, 40), ...(col.pk ? { pk: true } : {}), ...(col.fk ? { fk: true } : {}) };
      }).filter((c) => c.name);
      nodes.push({ id, type: 'entity', position: { x: 0, y: 0 }, data: { label, columns } });
    } else {
      const shape = FLOW_SHAPES.includes(o.shape as FlowShape) ? (o.shape as FlowShape) : 'process';
      nodes.push({ id, type: 'flow', position: { x: 0, y: 0 }, data: { label, shape } });
    }
  }
  const edges: DiagramEdge[] = [];
  for (const e of Array.isArray(d.edges) ? d.edges.slice(0, MAX_NODES * 3) : []) {
    const o = (e ?? {}) as Record<string, unknown>;
    const source = ids.get(str(o.from, 60)), target = ids.get(str(o.to, 60));
    if (!source || !target) continue;
    const label = str(o.label, 60);
    edges.push({ id: `e${edges.length + 1}`, source, target, ...(label ? { label } : {}) });
  }
  return { title: str(d.title), content: layout({ nodes, edges }) };
}

/** Diagram content → the compact draft form, so the LLM can revise what is already drawn */
export function toDraft(c: DiagramContent): DiagramDraft {
  return {
    nodes: c.nodes.map((n) => ({ id: n.id, label: n.data?.label ?? '', ...(n.data?.shape ? { shape: n.data.shape } : {}), ...(n.data?.columns ? { columns: n.data.columns } : {}) })),
    edges: c.edges.map((e) => ({ from: e.source, to: e.target, ...(e.label ? { label: e.label } : {}) })),
  };
}

/** Size a node is drawn at — must match the node components in DesignTab */
export function nodeSize(n: DiagramNode): { width: number; height: number } {
  if (n.type === 'entity') return { width: 220, height: 38 + 26 * Math.max(1, n.data.columns?.length ?? 0) };
  if (n.data.shape === 'decision') return { width: 150, height: 110 };
  if (n.data.shape === 'start' || n.data.shape === 'end') return { width: 150, height: 48 };
  return { width: 170, height: 60 };
}

/** Auto layout with dagre — flowcharts top to bottom, ER diagrams left to right */
export function layout(c: DiagramContent, kind?: DiagramKind): DiagramContent {
  if (!c.nodes.length) return c;
  const er = kind ? kind === 'er' : c.nodes.some((n) => n.type === 'entity');
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: er ? 'LR' : 'TB', nodesep: er ? 60 : 50, ranksep: er ? 110 : 70 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of c.nodes) g.setNode(n.id, nodeSize(n));
  for (const e of c.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return {
    // every node has a handle on each side (t / r / b / l); connect along the layout direction
    edges: c.edges.map((e) => ({ ...e, sourceHandle: er ? 'r' : 'b', targetHandle: er ? 'l' : 't' })),
    nodes: c.nodes.map((n) => {
      const p = g.node(n.id), s = nodeSize(n);
      return { ...n, position: { x: Math.round(p.x - s.width / 2), y: Math.round(p.y - s.height / 2) } };
    }),
  };
}
