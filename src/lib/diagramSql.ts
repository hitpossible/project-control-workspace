import type { DiagramContent, DiagramDraft, DiagramNode, ErColumn } from './diagram';

/**
 * ER tables on the Design tab ↔ MySQL DDL. Export writes runnable CREATE TABLE statements (parents first, foreign
 * keys from the relationship lines); import reads CREATE TABLE / ALTER TABLE … FOREIGN KEY back into a draft that
 * fromDraft('er', …) lays out. Both are best effort: anything they cannot place becomes a comment / is skipped.
 */

const q = (name: string) => `\`${name.replace(/`/g, '')}\``;
const singular = (s: string) => s.replace(/ies$/, 'y').replace(/(ses|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, '');
/** brackets closed and quotes paired — a type cut off mid-way would break the whole script */
const balanced = (type: string) => (type.match(/\(/g)?.length ?? 0) === (type.match(/\)/g)?.length ?? 0) && (type.match(/'/g)?.length ?? 0) % 2 === 0;
const isInt = (type: string) => /^(tiny|small|medium|big)?int\b/i.test(type.trim());

/** cardinality label of a line, as seen from its source: [source side, target side] */
function ends(label: string | undefined): ['1' | 'N', '1' | 'N'] | null {
  const m = /^\s*([1N])\s*:\s*([1N])\s*$/i.exec(label ?? '');
  return m ? [m[1].toUpperCase() as '1' | 'N', m[2].toUpperCase() as '1' | 'N'] : null;
}

/** the column of `child` that most likely points at `parent` */
function fkColumn(child: ErColumn[], parent: string, used: Set<string>): string | null {
  const p = singular(parent.toLowerCase());
  const free = child.filter((c) => !used.has(c.name));
  const pick = free.find((c) => c.name.toLowerCase() === `${p}_id`)
    ?? free.find((c) => c.name.toLowerCase() === `${parent.toLowerCase()}_id`)
    ?? free.find((c) => c.fk && c.name.toLowerCase().includes(p))
    ?? free.find((c) => c.fk);
  return pick?.name ?? null;
}

export function toSql(c: DiagramContent, title: string): string {
  const tables = c.nodes.filter((n): n is DiagramNode => n.type === 'entity' && !!n.data.label.trim());
  const byId = new Map(tables.map((n) => [n.id, n]));
  const name = (n: DiagramNode) => n.data.label.trim();
  const fks = new Map<string, string[]>(); // table id → constraint lines
  const notes: string[] = [];
  const parentsOf = new Map<string, Set<string>>();
  const used = new Map<string, Set<string>>();

  for (const e of c.edges) {
    const a = byId.get(e.source), b = byId.get(e.target);
    if (!a || !b) continue;
    const card = ends(e.label);
    if (!card) { notes.push(`-- ${name(a)} — ${name(b)}: relationship "${e.label ?? ''}" not exported`); continue; }
    if (card[0] === 'N' && card[1] === 'N') { notes.push(`-- ${name(a)} N:N ${name(b)}: add a junction table`); continue; }
    // the "many" side (or the source of a 1:1) holds the foreign key
    const [child, parent] = card[0] === '1' && card[1] === 'N' ? [b, a] : [a, b];
    const u = used.get(child.id) ?? new Set<string>();
    used.set(child.id, u);
    const col = fkColumn(child.data.columns ?? [], name(parent), u);
    if (!col) { notes.push(`-- ${name(child)} → ${name(parent)}: no foreign key column found`); continue; }
    u.add(col);
    const ref = (parent.data.columns ?? []).find((x) => x.pk)?.name ?? 'id';
    const list = fks.get(child.id) ?? [];
    list.push(`  CONSTRAINT ${q(`fk_${name(child)}_${col}`.slice(0, 64))} FOREIGN KEY (${q(col)}) REFERENCES ${q(name(parent))} (${q(ref)})`);
    fks.set(child.id, list);
    if (child.id !== parent.id) parentsOf.set(child.id, (parentsOf.get(child.id) ?? new Set()).add(parent.id));
  }

  // parents first, so the script runs top to bottom; cycles fall back to drawing order
  const order: DiagramNode[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (n: DiagramNode) => {
    if (state.get(n.id)) return;
    state.set(n.id, 'visiting');
    for (const p of parentsOf.get(n.id) ?? []) if (state.get(p) !== 'visiting') visit(byId.get(p)!);
    state.set(n.id, 'done');
    order.push(n);
  };
  tables.forEach(visit);

  const out = [`-- ${title}`, `-- generated from the Design tab on ${new Date().toISOString().slice(0, 10)}`, 'SET NAMES utf8mb4;', ''];
  for (const n of order) {
    const cols = (n.data.columns ?? []).filter((x) => x.name.trim());
    const pks = cols.filter((x) => x.pk);
    const lines = cols.map((x) => {
      const type = x.type.trim() || 'VARCHAR(255)';
      if (!balanced(type)) notes.push(`-- ${name(n)}.${x.name.trim()}: type "${type}" looks incomplete — check it before running`);
      const auto = pks.length === 1 && x.pk && isInt(type) ? ' AUTO_INCREMENT' : '';
      return `  ${q(x.name.trim())} ${type}${x.pk ? ' NOT NULL' : ''}${auto}`;
    });
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.map((x) => q(x.name.trim())).join(', ')})`);
    lines.push(...(fks.get(n.id) ?? []));
    out.push(`CREATE TABLE ${q(name(n))} (`, lines.join(',\n'), ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;', '');
  }
  if (notes.length) out.push(...notes, '');
  return out.join('\n');
}

const unquote = (s: string) => s.trim().replace(/^[`"[]|[`"\]]$/g, '').split('.').pop()!.replace(/^[`"[]|[`"\]]$/g, '');
const cols = (s: string) => s.split(',').map(unquote).filter(Boolean);
const SKIP = /^(KEY|INDEX|UNIQUE|FULLTEXT|SPATIAL|CHECK)\b/i;

/** split on commas that are not inside brackets or quotes */
function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of body) {
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** MySQL DDL → ER draft for fromDraft('er', …); empty `nodes` when no CREATE TABLE was found */
export function fromSql(sql: string): DiagramDraft {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(--|#)[^\n]*/g, ' ');
  const tables = new Map<string, ErColumn[]>();
  const edges: DiagramDraft['edges'] = [];
  const seen = new Set<string>();
  const addFk = (table: string, col: string, ref: string) => {
    const c = tables.get(table)?.find((x) => x.name === col);
    if (c) c.fk = true;
    // the same key may be declared inline and again in an ALTER TABLE
    if (seen.has(`${table}.${col}`)) return;
    seen.add(`${table}.${col}`);
    edges.push({ from: table, to: ref, label: 'N:1' });
  };

  const create = /CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)\s*\(/gi;
  for (let m = create.exec(text); m; m = create.exec(text)) {
    // the body runs to the bracket that closes the one after the name
    let depth = 1, i = create.lastIndex;
    for (; i < text.length && depth; i++) depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
    const table = unquote(m[1]);
    const body = text.slice(create.lastIndex, i - 1);
    create.lastIndex = i;
    const list: ErColumn[] = [];
    tables.set(table, list);
    const later: (() => void)[] = [];
    for (const part of splitTop(body)) {
      const pk = /^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(part);
      if (pk) { later.push(() => cols(pk[1]).forEach((n) => { const c = list.find((x) => x.name === n); if (c) c.pk = true; })); continue; }
      const fk = /^(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*(?:\S+\s*)?\(([^)]*)\)\s*REFERENCES\s+([`"[\]\w.]+)/i.exec(part);
      if (fk) { later.push(() => addFk(table, cols(fk[1])[0], unquote(fk[2]))); continue; }
      if (SKIP.test(part) || /^CONSTRAINT\b/i.test(part)) continue;
      const col = /^([`"[]?[\w$]+[`"\]]?)\s+([A-Za-z]+(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?)/i.exec(part);
      if (!col) continue;
      const name = unquote(col[1]);
      list.push({ name, type: col[2].replace(/\s+/g, ' ').replace(/^[A-Za-z]+/, (k) => k.toUpperCase()), ...(/\bPRIMARY\s+KEY\b/i.test(part) ? { pk: true } : {}) });
      const ref = /\bREFERENCES\s+([`"[\]\w.]+)/i.exec(part);
      if (ref) later.push(() => addFk(table, name, unquote(ref[1])));
    }
    later.forEach((f) => f());
  }

  const alter = /ALTER\s+TABLE\s+([`"[\]\w.]+)\s+ADD\s+(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*(?:\S+\s*)?\(([^)]*)\)\s*REFERENCES\s+([`"[\]\w.]+)/gi;
  for (let m = alter.exec(text); m; m = alter.exec(text)) addFk(unquote(m[1]), cols(m[2])[0], unquote(m[3]));

  return {
    nodes: [...tables].map(([name, columns]) => ({ id: name, label: name, columns })),
    // a key may point at a table that is not in the script — the editor links it to one already on the canvas
    edges: edges.filter((e) => tables.has(e.from)),
  };
}
