import dagre from '@dagrejs/dagre';

/**
 * Design diagrams on the project's Design tab — stored in project_diagrams.content as React Flow nodes / edges.
 * One canvas holds flowchart shapes and ER tables side by side; a kind only says which of the two an AI draft is.
 */
export type DiagramKind = 'flowchart' | 'er';
export const DIAGRAM_KINDS: DiagramKind[] = ['flowchart', 'er'];

export type FlowShape = 'start' | 'process' | 'decision' | 'io' | 'end';
export const FLOW_SHAPES: FlowShape[] = ['start', 'process', 'decision', 'io', 'end'];

export interface ErColumn { name: string; type: string; pk?: boolean; fk?: boolean }

/** text formatting from the format panel; unset = the shape's default */
export interface TextStyle {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** text runs top to bottom */
  vertical?: boolean;
  align?: 'left' | 'center' | 'right';
  /** flowchart shapes only */
  valign?: 'top' | 'middle' | 'bottom';
}

export interface DiagramNodeData extends Record<string, unknown> {
  label: string;
  text?: TextStyle;
  /** flowchart nodes */
  shape?: FlowShape;
  /** ER entities */
  columns?: ErColumn[];
  /** ER entities: only the header is shown */
  collapsed?: boolean;
}

export interface DiagramNode {
  id: string;
  type: 'flow' | 'entity';
  position: { x: number; y: number };
  /** set once the shape has been resized by hand (ER tables: width only — their height follows the columns) */
  width?: number;
  height?: number;
  data: DiagramNodeData;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  /** how the line is routed; unset = step (right angles) */
  line?: EdgeLine;
  dashed?: boolean;
}

export type EdgeLine = 'step' | 'straight' | 'curve';
export const EDGE_LINES: EdgeLine[] = ['step', 'straight', 'curve'];

export interface DiagramContent { nodes: DiagramNode[]; edges: DiagramEdge[] }

export interface ProjectDiagram {
  id: number; project_id: number; title: string; content: DiagramContent;
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
        return { name: str(col.name, 80), type: str(col.type, 300), ...(col.pk ? { pk: true } : {}), ...(col.fk ? { fk: true } : {}) };
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

/**
 * Id of a new shape / line. Random rather than "next number": two people adding a shape at the same moment must
 * not get the same id, or the merge would keep only one of them.
 */
export const newId = (prefix: 'n' | 'e') => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
const nodeType = (kind: DiagramKind): DiagramNode['type'] => (kind === 'er' ? 'entity' : 'flow');

/** The shapes of one kind and the lines between them — what the AI gets to revise */
export function ofKind(c: DiagramContent, kind: DiagramKind): DiagramContent {
  const nodes = c.nodes.filter((n) => n.type === nodeType(kind));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: c.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/**
 * Put an AI draft on the canvas. `revise`: the draft replaces the shapes of its kind and leaves the rest;
 * otherwise it is placed to the right of what is already drawn. Draft shapes and lines get new ids.
 */
export function mergeDraft(current: DiagramContent, draft: DiagramContent, kind: DiagramKind, revise: boolean): DiagramContent {
  const keep = revise ? current.nodes.filter((n) => n.type !== nodeType(kind)) : current.nodes;
  const kept = new Set(keep.map((n) => n.id));
  const keepEdges = current.edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  const right = Math.max(...keep.map((n) => n.position.x + nodeSize(n).width));
  const top = Math.min(...keep.map((n) => n.position.y));
  const dx = keep.length ? right + 160 : 0, dy = keep.length ? top : 0;
  const ids = new Map(draft.nodes.map((n) => [n.id, newId('n')]));
  const nid = (id: string) => ids.get(id)!;
  return {
    nodes: [...keep, ...draft.nodes.map((n) => ({ ...n, id: nid(n.id), position: { x: n.position.x + dx, y: n.position.y + dy } }))],
    edges: [...keepEdges, ...draft.edges.map((e) => ({ ...e, id: newId('e'), source: nid(e.source), target: nid(e.target) }))],
  };
}

export const ENTITY_WIDTH = 240;

/** Clipboard content pasted into a drawing: new ids, moved by `offset`, returns the new node ids */
export function pasteContent(current: DiagramContent, clip: DiagramContent, offset: number): { content: DiagramContent; ids: Set<string> } {
  const map = new Map(clip.nodes.map((n) => [n.id, newId('n')]));
  const nodes = clip.nodes.map((n) => ({ ...n, id: map.get(n.id)!, position: { x: n.position.x + offset, y: n.position.y + offset } }));
  const edges = clip.edges.filter((e) => map.has(e.source) && map.has(e.target))
    .map((e) => ({ ...e, id: newId('e'), source: map.get(e.source)!, target: map.get(e.target)! }));
  return { content: { nodes: [...current.nodes, ...nodes], edges: [...current.edges, ...edges] }, ids: new Set(nodes.map((n) => n.id)) };
}

/** Size a node is drawn at — must match the node components in DesignTab */
export function nodeSize(n: DiagramNode): { width: number; height: number } {
  if (n.type === 'flow' && n.width && n.height) return { width: n.width, height: n.height };
  if (n.type === 'entity') return { width: n.width || ENTITY_WIDTH, height: 42 + (n.data.collapsed ? 0 : 30 * Math.max(1, n.data.columns?.length ?? 0) + 2) };
  if (n.data.shape === 'decision') return { width: 150, height: 110 };
  if (n.data.shape === 'start' || n.data.shape === 'end') return { width: 150, height: 48 };
  return { width: 170, height: 60 };
}

/** Auto layout with dagre — flowcharts top to bottom; left to right once there are ER tables */
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

/**
 * Three-way merge of drawings, shape by shape and line by line (by id): whatever `ours` changed since `base` wins,
 * everything else comes from `theirs`. Used when two people edit at once (ours = my edits, theirs = the saved
 * version) and for undo / redo of my own steps on top of other people's edits. Lines left without both ends go.
 */
export function merge3(base: DiagramContent, ours: DiagramContent, theirs: DiagramContent): DiagramContent {
  const pick = <T extends { id: string }>(b: T[], o: T[], t: T[]): T[] => {
    const bm = new Map(b.map((x) => [x.id, JSON.stringify(x)]));
    const om = new Map(o.map((x) => [x.id, x]));
    const tm = new Map(t.map((x) => [x.id, x]));
    const out: T[] = [];
    // theirs' order first, then what only we have
    for (const id of [...tm.keys(), ...[...om.keys()].filter((k) => !tm.has(k))]) {
      const mine = om.get(id);
      const changedByUs = (mine ? JSON.stringify(mine) : undefined) !== bm.get(id);
      const v = changedByUs ? mine : tm.get(id);
      if (v) out.push(v);
    }
    return out;
  };
  const nodes = pick(base.nodes, ours.nodes, theirs.nodes);
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: pick(base.edges, ours.edges, theirs.edges).filter((e) => ids.has(e.source) && ids.has(e.target)) };
}
