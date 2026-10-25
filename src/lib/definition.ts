/**
 * Project definition (project_definitions.content): what the team must know to build the system — scope, features,
 * data, technical and delivery — in fixed groups and sections. The AI drafts what the request supports, the team
 * fills in and edits the rest. Not the SRS (the formal signed document). AI skill suggestions cite features as F1, F2, …
 */

/** text = one paragraph; list = one item per line; features = the feature table */
export type SectionKind = 'text' | 'list' | 'features';

/**
 * ai: the request / clarification interview usually says something about it, so the AI drafts it;
 * otherwise the team fills it in (the AI still uses team notes for it).
 */
export const DEFINITION_GROUPS = [
  { key: 'overview', sections: [
    { key: 'background', kind: 'text', ai: true },
    { key: 'objectives', kind: 'list', ai: true },
    { key: 'stakeholders', kind: 'list', ai: true },
  ] },
  { key: 'scope', sections: [
    { key: 'in_scope', kind: 'list', ai: true },
    { key: 'out_of_scope', kind: 'list', ai: true },
    { key: 'assumptions', kind: 'list', ai: false },
    { key: 'constraints', kind: 'list', ai: true },
  ] },
  { key: 'functional', sections: [
    { key: 'roles', kind: 'list', ai: true },
    { key: 'process', kind: 'text', ai: true },
    { key: 'features', kind: 'features', ai: true },
    { key: 'business_rules', kind: 'list', ai: true },
    { key: 'screens', kind: 'list', ai: false },
    { key: 'reports', kind: 'list', ai: true },
    { key: 'notifications', kind: 'list', ai: true },
  ] },
  { key: 'data', sections: [
    { key: 'entities', kind: 'list', ai: true },
    { key: 'migration', kind: 'text', ai: true },
    { key: 'data_volume', kind: 'text', ai: true },
  ] },
  { key: 'technical', sections: [
    { key: 'integrations', kind: 'list', ai: true },
    { key: 'non_functional', kind: 'list', ai: true },
    { key: 'environment', kind: 'text', ai: true },
    { key: 'tech_approach', kind: 'text', ai: false },
  ] },
  { key: 'delivery', sections: [
    { key: 'milestones', kind: 'list', ai: false },
    { key: 'testing', kind: 'text', ai: false },
    { key: 'go_live', kind: 'text', ai: false },
    { key: 'risks', kind: 'list', ai: true },
    { key: 'open_questions', kind: 'list', ai: true },
  ] },
] as const;

type Sections = (typeof DEFINITION_GROUPS)[number]['sections'][number];
export type GroupKey = (typeof DEFINITION_GROUPS)[number]['key'];
export type SectionKey = Sections['key'];
type TextKey = Extract<Sections, { kind: 'text' }>['key'];
type ListKey = Extract<Sections, { kind: 'list' }>['key'];

export const DEFINITION_SECTIONS: readonly { key: SectionKey; kind: SectionKind; ai: boolean; group: GroupKey }[] =
  DEFINITION_GROUPS.flatMap((g) => g.sections.map((s) => ({ ...s, group: g.key })));

export const PRIORITIES = ['must', 'should', 'could'] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Feature = { title: string; detail: string; priority: Priority; acceptance: string };

export type ProjectDefinition = { [K in TextKey]: string } & { [K in ListKey]: string[] } & { features: Feature[] };

export const MAX_TEXT = 3000;
export const MAX_ITEM = 400;
export const MAX_ITEMS = 50;
export const MAX_FEATURES = 80;

/** reference for the n-th feature (0-based), used by AI skill suggestions */
export const featureRef = (i: number) => `F${i + 1}`;

export function emptyDefinition(): ProjectDefinition {
  return Object.fromEntries(DEFINITION_SECTIONS.map((s) => [s.key, s.kind === 'text' ? '' : []])) as unknown as ProjectDefinition;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** list items: strip bullets / numbering the AI or a paste may add ("- ", "1. ", "F3: ") */
const item = (v: unknown) => clean(v, MAX_ITEM).replace(/^(?:[-*•]\s+|\d+[.)]\s+|F\d+[:.)]\s*)/i, '').trim();
const listOf = (raw: unknown) => (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : []).map(item).filter(Boolean).slice(0, MAX_ITEMS);

function feature(v: unknown): Feature | null {
  if (typeof v === 'string') {
    const title = item(v);
    return title ? { title, detail: '', priority: 'must', acceptance: '' } : null;
  }
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const title = item(o.title ?? o.name);
  if (!title) return null;
  const p = String(o.priority ?? '').toLowerCase();
  return {
    title: title.slice(0, 200), detail: clean(o.detail ?? o.description, 1000),
    priority: (PRIORITIES as readonly string[]).includes(p) ? (p as Priority) : 'must',
    acceptance: clean(o.acceptance ?? o.acceptance_criteria, 1000),
  };
}

/** the first requirement summary (9 sections) → this model, so saved summaries open in the new layout */
const LEGACY: Record<string, SectionKey> = {
  objective: 'objectives', users: 'roles', data_reports: 'reports',
};

/** Any untrusted value (AI reply, browser, old summary) → a well-formed definition: known sections only, trimmed and bounded */
export function normalizeDefinition(v: unknown): ProjectDefinition {
  const o = { ...((v && typeof v === 'object' ? v : {}) as Record<string, unknown>) };
  for (const [old, now] of Object.entries(LEGACY)) if (o[old] !== undefined && o[now] === undefined) o[now] = o[old];
  const out = emptyDefinition() as Record<string, unknown>;
  for (const s of DEFINITION_SECTIONS) {
    const raw = o[s.key];
    if (s.kind === 'text') out[s.key] = clean(Array.isArray(raw) ? raw.join('\n') : raw, MAX_TEXT);
    else if (s.kind === 'list') out[s.key] = listOf(raw);
    else out[s.key] = (Array.isArray(raw) ? raw : []).map(feature).filter((f): f is Feature => !!f).slice(0, MAX_FEATURES);
  }
  return out as ProjectDefinition;
}

export const isFilled = (d: ProjectDefinition, key: SectionKey) => d[key].length > 0;
export const isEmptyDefinition = (d: ProjectDefinition) => DEFINITION_SECTIONS.every((s) => !isFilled(d, s.key));
/** sections filled / all sections */
export const completeness = (d: ProjectDefinition) => ({ filled: DEFINITION_SECTIONS.filter((s) => isFilled(d, s.key)).length, total: DEFINITION_SECTIONS.length });

/** Plain-text rendering for prompts: groups and sections in order, features numbered F1… with priority and acceptance */
export function definitionText(d: ProjectDefinition, labels: { group: Record<GroupKey, string>; section: Record<SectionKey, string> }): string {
  const lines: string[] = [];
  for (const g of DEFINITION_GROUPS) {
    const filled = g.sections.filter((s) => isFilled(d, s.key));
    if (!filled.length) continue;
    lines.push(`## ${labels.group[g.key]}`);
    for (const s of filled) {
      lines.push(`${labels.section[s.key]}:`);
      if (s.kind === 'features') {
        d.features.forEach((f, i) => {
          lines.push(`  ${featureRef(i)} [${f.priority}] ${f.title}${f.detail ? ` — ${f.detail}` : ''}`);
          if (f.acceptance) lines.push(`     Acceptance: ${f.acceptance}`);
        });
      } else if (s.kind === 'list') for (const it of d[s.key as ListKey]) lines.push(`  - ${it}`);
      else lines.push(`  ${d[s.key as TextKey]}`);
    }
  }
  return lines.join('\n');
}

/** One AI skill suggestion for a project (from its definition) */
export type SkillSuggestion = {
  skill_id: number;
  required_level: number;
  weight: number;
  is_mandatory: boolean;
  reason: string;
  /** features it comes from, e.g. ["F2", "F5"] */
  refs: string[];
};

/** A skill the AI thinks the project needs that is not in the skill list — for an assessor to add */
export type MissingSkill = { name: string; category: string; reason: string };

export type SkillSuggestions = { suggestions: SkillSuggestion[]; missing: MissingSkill[] };

const CATEGORIES = ['frontend', 'backend', 'database', 'mobile', 'devops', 'integration', 'domain', 'other'];
const level = (v: unknown, fallback: number) => {
  const n = v == null || v === '' ? NaN : Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : fallback;
};

/**
 * The AI's untrusted reply → suggestions for skills that exist and are not required yet (one per skill),
 * refs only to features the definition has, most important first.
 */
export function parseSkillSuggestions(raw: unknown, opts: { skillIds: Set<number>; required: Set<number>; features: number }): SkillSuggestions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { skills?: unknown; missing?: unknown };
  const seen = new Set<number>();
  const suggestions: SkillSuggestion[] = [];
  for (const x of Array.isArray(o.skills) ? o.skills : []) {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = Number(r.skill_id);
    if (!opts.skillIds.has(id) || opts.required.has(id) || seen.has(id)) continue;
    seen.add(id);
    const refs = (Array.isArray(r.refs) ? r.refs : []).map((v) => String(v).trim().toUpperCase())
      .filter((v) => /^F\d+$/.test(v) && Number(v.slice(1)) >= 1 && Number(v.slice(1)) <= opts.features);
    suggestions.push({
      skill_id: id, required_level: level(r.required_level, 3), weight: level(r.weight, 3), is_mandatory: r.is_mandatory === true,
      reason: clean(r.reason, 300), refs: [...new Set(refs)],
    });
  }
  suggestions.sort((a, b) => Number(b.is_mandatory) - Number(a.is_mandatory) || b.weight - a.weight);
  const missing: MissingSkill[] = (Array.isArray(o.missing) ? o.missing : []).flatMap((x) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const name = clean(r.name, 100);
    return name ? [{ name, category: CATEGORIES.includes(String(r.category)) ? String(r.category) : 'other', reason: clean(r.reason, 300) }] : [];
  }).slice(0, 5);
  return { suggestions, missing };
}
