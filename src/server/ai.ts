import 'server-only';
import { MAX_ASKS_PER_CRITERION, QUESTIONS_PER_ROUND, type ClarifyCriterion, type CoverageStatus, type CriterionCoverage } from '@/lib/clarify';
import { REDUCTION_ROWS } from '@/lib/constants';
import type { ProjectRequest } from '@/lib/types';

/**
 * Company LLM through an OpenAI-compatible Chat Completions API (OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL).
 * OPENAI_BASE_URL unset = AI is off and requests are submitted without follow-up questions.
 */

const SYSTEM = `You are a business analyst in the IT System Service team. A staff member is about to submit a project request.
You get the request, the earlier questions and answers, and a list of criteria: what the team must know at request time to understand, estimate and plan the project.

Step 1 — check every criterion:
- "covered": the request or the answers give this information, even briefly. Also covered when the requestor answered that they do not know / have not decided yet — do not push.
- "not_applicable": only for an optional criterion that clearly does not apply to this kind of system (e.g. approval steps for a read-only dashboard). Never for a required criterion.
- "missing": otherwise.
Give each a short note (one sentence) on why, in the language of the request.

Step 2 — ask about missing criteria, required ones first, at most ${QUESTIONS_PER_ROUND} questions:
- One short, concrete question per criterion, easy for a non-IT person to answer; give an example answer in brackets when it helps.
- Never ask about something already covered. Do not ask about priority or the required date.
- Write the questions in the same language as the request (Thai request → Thai questions).

Reply with JSON only, exactly in this shape:
{"assessment": [{"key": "<criterion key>", "status": "covered|missing|not_applicable", "note": "..."}], "questions": [{"key": "<criterion key>", "question": "..."}]}`;

function describe(r: ProjectRequest, criteria: ClarifyCriterion[], extra: string | null) {
  const lines = [
    'REQUEST',
    `Project name: ${r.project_name}`,
    `Department: ${r.req_department ?? '-'}`,
    `Brief description: ${r.description || '-'}`,
    `Reason for request: ${r.reason || '-'}`,
    `Expected result: ${r.expectation || '-'}`,
    `Priority: ${r.priority}`,
    `Date required: ${r.date_required ?? '-'}`,
  ];
  for (const row of REDUCTION_ROWS) {
    const from = r[row.from], to = r[row.to];
    if (from != null || to != null) lines.push(`Reduction ${row.label}: ${from ?? '-'} → ${to ?? '-'}`);
  }
  if (extra) lines.push(`The approver asked the requestor for more information: ${extra}`);
  const qa = r.ai_clarifications ?? [];
  if (qa.length) {
    lines.push('', 'EARLIER QUESTIONS AND ANSWERS');
    for (const c of qa) lines.push(`Q${c.criterion ? ` [${c.criterion}]` : ''}: ${c.question}`, `A: ${c.answer ?? '(skipped by the requestor)'}`);
  }
  lines.push('', 'CRITERIA');
  for (const c of criteria) lines.push(`- ${c.key} (${c.required ? 'required' : 'optional'}) ${c.label}: ${c.hint}`);
  return lines.join('\n');
}

async function chat(system: string, user: string): Promise<string> {
  const base = process.env.OPENAI_BASE_URL!;
  const ask = (jsonMode: boolean) => fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.OPENAI_API_KEY ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}),
    },
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 60000)),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  let res = await ask(true);
  // not every OpenAI-compatible server knows response_format — the prompt asks for JSON anyway
  if (res.status === 400) res = await ask(false);
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return (await res.json()).choices?.[0]?.message?.content ?? '';
}

export type Assessment = { coverage: CriterionCoverage[]; questions: { key: string; question: string }[] };

const STATUSES: CoverageStatus[] = ['covered', 'missing', 'not_applicable'];

/** Check the request against the criteria and pick the next questions; null when the AI is off or failed */
export async function assessRequest(r: ProjectRequest, criteria: ClarifyCriterion[], extra: string | null): Promise<Assessment | null> {
  if (!process.env.OPENAI_BASE_URL || !criteria.length) return null;
  try {
    const text = await chat(SYSTEM, describe(r, criteria, extra));
    // some models wrap the JSON in a ``` fence or add a line before it
    const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}') as {
      assessment?: { key?: unknown; status?: unknown; note?: unknown }[]; questions?: { key?: unknown; question?: unknown }[];
    };
    if (!Array.isArray(out.assessment)) throw new Error('no assessment in the reply');
    const got = new Map(out.assessment.map((a) => [String(a.key), a]));
    const coverage: CriterionCoverage[] = criteria.map((c) => {
      const a = got.get(c.key);
      let status: CoverageStatus = STATUSES.includes(a?.status as CoverageStatus) ? (a!.status as CoverageStatus) : 'missing';
      if (c.required && status === 'not_applicable') status = 'missing';
      return { key: c.key, label: c.label, required: c.required, status, note: typeof a?.note === 'string' && a.note.trim() ? a.note.trim() : null };
    });

    // only missing criteria, required first; a criterion asked MAX_ASKS_PER_CRITERION times is not asked again
    const asked = new Map<string, number>();
    for (const q of r.ai_clarifications ?? []) if (q.criterion) asked.set(q.criterion, (asked.get(q.criterion) ?? 0) + 1);
    const askable = new Set(coverage.filter((c) => c.status === 'missing' && (asked.get(c.key) ?? 0) < MAX_ASKS_PER_CRITERION).map((c) => c.key));
    const optional = (key: string) => (criteria.find((c) => c.key === key)?.required ? 0 : 1);
    const seen = new Set<string>();
    const questions = (Array.isArray(out.questions) ? out.questions : [])
      .map((q) => ({ key: String(q.key), question: typeof q.question === 'string' ? q.question.trim().replace(/^\d+[.)]\s*/, '') : '' }))
      .filter((q) => q.question && askable.has(q.key) && !seen.has(q.key) && !!seen.add(q.key))
      .sort((a, b) => optional(a.key) - optional(b.key))
      .slice(0, QUESTIONS_PER_ROUND);
    return { coverage, questions };
  } catch (e) {
    console.warn('[ai] request assessment skipped:', e instanceof Error ? e.message : e);
    return null;
  }
}
