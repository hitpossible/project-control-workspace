/**
 * AI clarification before submit: each document type has a list of criteria — what the team needs to know about a
 * project at request time. The requestor chats with the AI, which checks after every answer which criteria are covered
 * and asks about the rest, until the required (and the relevant optional) ones are covered, MAX_AI_TURNS is reached or
 * the requestor stops. The requestor then reviews the AI's summary per criterion before submitting.
 */
export interface ClarifyCriterion {
  key: string;
  label: string;
  /** what to find out — guides the AI's question */
  hint: string;
  /** required = must be covered; optional = only when it applies to this kind of system */
  required: boolean;
}

export type CoverageStatus = 'covered' | 'missing' | 'not_applicable';

export interface CriterionCoverage {
  key: string;
  label: string;
  required: boolean;
  status: CoverageStatus;
  /** the AI's short reason — lets the reviewer double-check */
  note: string | null;
  /** what is known about it, 1–2 lines — written by the AI, confirmed / edited by the requestor */
  summary?: string | null;
}

export interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
  at: string;
  /** criterion keys an assistant message asks about */
  criteria?: string[];
  /** said out loud in a Gemini Live voice session (the text is its transcript) */
  voice?: boolean;
}

/** Form fields the AI filled in from an intake conversation (a new request written by talking to the AI) */
export interface IntakeForm {
  project_name?: string;
  description?: string;
  reason?: string;
  expectation?: string;
  reduction_time_from?: number; reduction_time_to?: number;
  reduction_man_from?: number; reduction_man_to?: number;
  reduction_cost_from?: number; reduction_cost_to?: number;
}

/** A function the system must have, drafted by the AI from the conversation; becomes a project requirement (draft) on conversion */
export interface AiRequirement {
  title: string;
  /** module / area it belongs to */
  category: string | null;
  description: string | null;
  /** MoSCoW */
  priority: 'must' | 'should' | 'could' | 'wont';
  /** testable checks, one per line */
  acceptance_criteria: string | null;
}

export interface AiCoverage {
  checked_at: string;
  criteria: CriterionCoverage[];
  /** the requirements the conversation has made clear so far (the AI rebuilds the whole list every turn) */
  requirements?: AiRequirement[];
}

export const MAX_AI_REQUIREMENTS = 40;
const REQ_PRIORITY = ['must', 'should', 'could', 'wont'] as const;

/** Well-formed requirements from untrusted JSON (the AI's reply or a stored coverage): trimmed, bounded, no duplicates */
export function parseAiRequirements(v: unknown): AiRequirement[] {
  if (!Array.isArray(v)) return [];
  const text = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
  const seen = new Set<string>();
  const out: AiRequirement[] = [];
  for (const x of v) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const title = text(o.title, 300);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({
      title,
      category: text(o.category, 100),
      description: text(o.description, 1500),
      priority: REQ_PRIORITY.find((p) => p === String(o.priority).toLowerCase()) ?? 'should',
      acceptance_criteria: text(o.acceptance_criteria, 1500),
    });
    if (out.length >= MAX_AI_REQUIREMENTS) break;
  }
  return out;
}

/** AI messages per conversation before it wraps up */
export const MAX_AI_TURNS = 18;
/** criteria one AI message may ask about — one, so each answer can be followed up before moving on */
export const CRITERIA_PER_TURN = 1;
/** a criterion is not asked again after this many messages (the first question + follow-ups) — the requestor may simply not know */
export const MAX_ASKS_PER_CRITERION = 3;
export const MAX_CHAT_MESSAGE = 2000;

export const DEFAULT_CRITERIA: ClarifyCriterion[] = [
  { key: 'users', label: 'Users', hint: 'Each kind of user (role / department), roughly how many of each, and what each one does in the system', required: true },
  { key: 'current_process', label: 'Current process & problem', hint: 'How the work is done today step by step (paper, Excel, e-mail…), who does it, how long it takes, and exactly where it goes wrong — with a recent real example', required: true },
  { key: 'features', label: 'Main features & scope', hint: 'The functions the system must have, each as "who can do what" (e.g. "line leader submits a request"), and what is out of scope for now', required: true },
  { key: 'main_flow', label: 'Typical case, step by step', hint: 'Walk through one real case from start to finish: who does what, in what order, what each step needs and what it produces, and what happens when something is rejected or wrong', required: true },
  { key: 'key_user', label: 'Key user', hint: 'Who on the requestor side gives the details and tests / accepts the system (UAT)', required: true },
  { key: 'success', label: 'Success criteria', hint: 'How the requestor will know the project succeeded — a number or a before / after (e.g. "approval in 1 day instead of 3")', required: true },
  { key: 'data_io', label: 'Data in & reports out', hint: 'The fields to be entered (name, type, required or not, choices) and each report / document that must come out with its columns, filters and who reads it', required: false },
  { key: 'business_rules', label: 'Business rules', hint: 'Conditions, calculations, limits, statuses and validations (e.g. "over 50,000 THB needs manager approval", "stock cannot go below zero")', required: false },
  { key: 'integrations', label: 'Other systems', hint: 'Systems or files it must connect to (ERP, Excel, machines, e-mail…): which data, which direction, how often', required: false },
  { key: 'devices', label: 'Devices & place of use', hint: 'PC, mobile, tablet, shop floor — and whether it must work offline or with a scanner / printer', required: false },
  { key: 'approval_flow', label: 'Approval steps', hint: 'Who fills in, who approves, how many steps, what happens on reject, and who stands in when the approver is away', required: false },
  { key: 'permissions', label: 'Permissions', hint: 'Who may see, add, change or delete what — and anything that must be hidden from some people', required: false },
  { key: 'existing_data', label: 'Existing data & volume', hint: 'Old data to move in (where it is now, how clean), and how many records per day / month', required: false },
  { key: 'constraints', label: 'Rules & constraints', hint: 'Audit / standards (IATF, ISO), personal data (PDPA), and why the required date matters', required: false },
];

/** Required criteria covered / total — for the badge on the request */
export function coverageCount(c: AiCoverage | null | undefined) {
  const req = (c?.criteria ?? []).filter((x) => x.required);
  return { covered: req.filter((x) => x.status === 'covered').length, total: req.length, missing: req.filter((x) => x.status === 'missing') };
}

/**
 * AI initial analysis, written after submit for System Service: a first look at the project from the form, the
 * clarification summary and the conversation. pending = being written; failed = the AI could not do it this time.
 */
export interface AiAnalysis {
  status: 'pending' | 'done' | 'failed';
  analyzed_at: string;
  complexity?: 'low' | 'medium' | 'high';
  /** 0–100: how complete the requirements are for planning */
  readiness?: number;
  /** estimated effort in man-days */
  effort_min?: number;
  effort_max?: number;
  /** the effort split by phase — adds up to the most likely figure within effort_min–effort_max */
  phases?: { phase: string; md: number }[];
  /** why this complexity and effort, 1–2 sentences */
  rationale?: string;
  modules?: string[];
  risks?: string[];
  next_step?: string;
  /** from the active project types / templates, for the System Service review */
  project_type?: { id: number; name: string } | null;
  template?: { id: number; name: string } | null;
  /** earlier projects that look alike — for scope and effort comparison */
  similar?: { id: number; code: string; name: string; reason: string }[];
}

/** Readiness from the criteria check: required criteria count double, not-applicable ones not at all */
export function coverageReadiness(c: AiCoverage | null | undefined) {
  const rows = (c?.criteria ?? []).filter((x) => x.status !== 'not_applicable');
  const weight = (x: CriterionCoverage) => (x.required ? 2 : 1);
  const total = rows.reduce((s, x) => s + weight(x), 0);
  return total ? Math.round((rows.filter((x) => x.status === 'covered').reduce((s, x) => s + weight(x), 0) / total) * 100) : null;
}
