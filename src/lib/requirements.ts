/**
 * Requirement summary of a project (project_requirement_summaries.content): a working summary of what the system must
 * do, in fixed sections. Drafted by the AI, edited by the team; AI skill suggestions cite its features as F1, F2, …
 */

/** text = one paragraph; list = one item per line */
export const SUMMARY_SECTIONS = [
  { key: 'objective', kind: 'text' },
  { key: 'users', kind: 'text' },
  { key: 'features', kind: 'list' },
  { key: 'out_of_scope', kind: 'list' },
  { key: 'integrations', kind: 'list' },
  { key: 'data_reports', kind: 'list' },
  { key: 'environment', kind: 'text' },
  { key: 'constraints', kind: 'list' },
  { key: 'open_questions', kind: 'list' },
] as const;

export type SummarySection = (typeof SUMMARY_SECTIONS)[number];
export type TextKey = Extract<SummarySection, { kind: 'text' }>['key'];
export type ListKey = Extract<SummarySection, { kind: 'list' }>['key'];
export type RequirementSummary = { [K in TextKey]: string } & { [K in ListKey]: string[] };

export const MAX_TEXT = 2000;
export const MAX_ITEM = 400;
export const MAX_ITEMS = 40;

/** reference used in skill suggestions for the n-th feature (0-based) */
export const featureRef = (i: number) => `F${i + 1}`;

export function emptySummary(): RequirementSummary {
  return Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s.key, s.kind === 'list' ? [] : ''])) as unknown as RequirementSummary;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+$/g, '').trim().slice(0, max) : '');
/** list items: strip bullets / numbering the AI or a paste may add ("- ", "1. ", "F3: ") */
const item = (v: unknown) => clean(v, MAX_ITEM).replace(/^(?:[-*•]\s+|\d+[.)]\s+|F\d+[:.)]\s*)/i, '').trim();

/** Any untrusted value (AI reply, browser) → a well-formed summary: known sections only, trimmed and bounded */
export function normalizeSummary(v: unknown): RequirementSummary {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = emptySummary() as Record<string, string | string[]>;
  for (const s of SUMMARY_SECTIONS) {
    const raw = o[s.key];
    if (s.kind === 'text') out[s.key] = clean(Array.isArray(raw) ? raw.join('\n') : raw, MAX_TEXT);
    else {
      const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : [];
      out[s.key] = items.map(item).filter(Boolean).slice(0, MAX_ITEMS);
    }
  }
  return out as unknown as RequirementSummary;
}

export const isEmptySummary = (s: RequirementSummary) =>
  SUMMARY_SECTIONS.every((x) => (x.kind === 'list' ? !s[x.key as ListKey].length : !s[x.key as TextKey]));

/** Plain-text rendering for prompts: sections in order, features numbered F1… so the AI can cite them */
export function summaryText(s: RequirementSummary, labels: Record<SummarySection['key'], string>): string {
  const lines: string[] = [];
  for (const x of SUMMARY_SECTIONS) {
    const v = s[x.key as keyof RequirementSummary];
    if (!v.length) continue;
    lines.push(`${labels[x.key]}:`);
    if (Array.isArray(v)) v.forEach((it, i) => lines.push(x.key === 'features' ? `  ${featureRef(i)}. ${it}` : `  - ${it}`));
    else lines.push(`  ${v}`);
  }
  return lines.join('\n');
}

/** One AI skill suggestion for a project (from its requirement summary) */
export type SkillSuggestion = {
  skill_id: number;
  required_level: number;
  weight: number;
  is_mandatory: boolean;
  reason: string;
  /** features of the summary it comes from, e.g. ["F2", "F5"] */
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
 * refs only to features the summary has, most important first.
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
