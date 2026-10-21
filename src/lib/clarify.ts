/**
 * AI clarification before submit: each document type has a list of criteria — what the team needs to know about a
 * project at request time. The AI checks which ones the form and the earlier answers already cover and asks about
 * the rest, round after round, until the required ones are covered (or MAX_ROUNDS is reached / the requestor skips).
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
}

export interface AiCoverage {
  checked_at: string;
  criteria: CriterionCoverage[];
}

export const MAX_ROUNDS = 3;
export const QUESTIONS_PER_ROUND = 3;
/** a criterion is not asked again after this many questions — the requestor may simply not know */
export const MAX_ASKS_PER_CRITERION = 2;

export const DEFAULT_CRITERIA: ClarifyCriterion[] = [
  { key: 'users', label: 'Users', hint: 'Who will use the system, which departments, roughly how many people', required: true },
  { key: 'current_process', label: 'Current process & problem', hint: 'How the work is done today and what exactly goes wrong', required: true },
  { key: 'features', label: 'Main features & scope', hint: 'The main features / screens it must have, and what is out of scope', required: true },
  { key: 'key_user', label: 'Key user', hint: 'Who on the requestor side gives the details and tests / accepts the system (UAT)', required: true },
  { key: 'success', label: 'Success criteria', hint: 'How the requestor will know the project succeeded (measurable if possible)', required: true },
  { key: 'data_io', label: 'Data in & reports out', hint: 'What data is entered and which reports / documents must come out', required: false },
  { key: 'integrations', label: 'Other systems', hint: 'Systems or files it must connect to: ERP, Excel, machines, e-mail…', required: false },
  { key: 'devices', label: 'Devices & place of use', hint: 'PC, mobile, tablet, shop floor', required: false },
  { key: 'approval_flow', label: 'Approval steps', hint: 'Who fills in, who approves, how many steps', required: false },
  { key: 'permissions', label: 'Permissions', hint: 'Who may see or change what', required: false },
  { key: 'existing_data', label: 'Existing data & volume', hint: 'Old data to move in, and how much data per day / month', required: false },
  { key: 'constraints', label: 'Rules & constraints', hint: 'Audit / standards (IATF, ISO), personal data (PDPA), why the required date', required: false },
];

/** Required criteria covered / total — for the badge on the request */
export function coverageCount(c: AiCoverage | null | undefined) {
  const req = (c?.criteria ?? []).filter((x) => x.required);
  return { covered: req.filter((x) => x.status === 'covered').length, total: req.length, missing: req.filter((x) => x.status === 'missing') };
}
