import 'server-only';
import { CRITERIA_PER_TURN, MAX_AI_TURNS, MAX_ASKS_PER_CRITERION, MAX_CHAT_MESSAGE, type ChatMessage, type ClarifyCriterion, type CoverageStatus, type CriterionCoverage } from '@/lib/clarify';
import { REDUCTION_ROWS } from '@/lib/constants';
import type { ProjectRequest } from '@/lib/types';

/**
 * Company LLM through an OpenAI-compatible Chat Completions API (OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL).
 * OPENAI_BASE_URL unset = AI is off and requests are submitted without follow-up questions.
 */
export const aiEnabled = () => !!process.env.OPENAI_BASE_URL;

const SYSTEM = `You are a friendly business analyst in the IT System Service team, chatting with a staff member who is about to submit a project request.
Through a short conversation, find out what the team must know at request time to understand, estimate and plan the project — the CRITERIA below.
You get the request form, the conversation so far and the criteria. On every turn:

1. Check every criterion against the form and the conversation:
   - "covered": the information is there, even briefly. Also covered when the requestor said they do not know / have not decided / want to skip it — do not push; say so in the summary.
   - "not_applicable": only for an optional criterion that the form or the answers clearly show does not apply to this system (e.g. approval steps for a read-only dashboard). Never for a required one. When unsure, it is "missing" — never mark one not applicable just because it has not come up yet.
   - "missing": otherwise.
   A short reply such as "Not sure yet" or "Skip this question" answers everything your previous message asked about: mark those criteria covered (not known yet / skipped) and move on.
   Give each a short "note" (why) and a "summary": 1–2 lines of what is actually known, written for the development team — null when nothing is known (never write "not specified").

2. Write your next chat "message":
   - Start with a very short, natural acknowledgement of the last answer (no flattery), then ask about at most ${CRITERIA_PER_TURN} closely related missing criteria, required ones first.
   - When the last answer is too vague to plan with (e.g. "the whole department"), you may ask one follow-up about it instead.
   - Short and easy for a non-IT person: at most 3 sentences, plain text, no lists or markdown; an example answer in brackets helps.
   - Never ask about something already covered, nor about priority or the required date.
   - On the first turn (no conversation yet), greet briefly, say in one sentence what you will ask about, then ask the first question.
   List the criterion keys the message asks about in "asking".

3. When nothing important is left (every required criterion covered, every optional one covered or not applicable), set "done": true,
   "asking": [] and make the message a one-line thank-you asking them to review the summary before submitting.

Write the note, summary and message in the same language as the request (Thai request → Thai).
Reply with JSON only, exactly in this shape:
{"assessment": [{"key": "<criterion key>", "status": "covered|missing|not_applicable", "note": "...", "summary": "..." }], "asking": ["<criterion key>"], "message": "...", "done": false}`;

function describe(r: ProjectRequest, criteria: ClarifyCriterion[], extra: string | null, messages: ChatMessage[], usedUp: string[]) {
  const lines = [
    'REQUEST FORM',
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
  const legacy = r.ai_clarifications ?? [];
  if (legacy.length) {
    lines.push('', 'EARLIER QUESTIONS AND ANSWERS');
    for (const c of legacy) lines.push(`Q: ${c.question}`, `A: ${c.answer ?? '(skipped by the requestor)'}`);
  }
  lines.push('', 'CRITERIA');
  for (const c of criteria) lines.push(`- ${c.key} (${c.required ? 'required' : 'optional'}) ${c.label}: ${c.hint}`);
  if (usedUp.length) lines.push('', `ALREADY ASKED ${MAX_ASKS_PER_CRITERION} TIMES — never ask about these again, whatever their status: ${usedUp.join(', ')}`);
  lines.push('', 'CONVERSATION SO FAR');
  if (!messages.length) lines.push('(none yet — this is the first turn)');
  for (const m of messages) lines.push(`${m.role === 'assistant' ? 'You' : 'Requestor'}: ${m.content}`);
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

export type ChatTurn = { coverage: CriterionCoverage[]; message: ChatMessage; done: boolean };

const STATUSES: CoverageStatus[] = ['covered', 'missing', 'not_applicable'];
/** closing line when the conversation ends on our side (turn limit, nothing left to ask) rather than the AI's */
const WRAP_UP = "Thanks — that's everything I need. Please check the summary before you submit.";
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Next AI message in the clarification chat, with its check of every criterion; null when the AI failed.
 * `turns` = AI messages so far in this conversation — at MAX_AI_TURNS the conversation wraps up.
 */
export async function chatTurn(r: ProjectRequest, criteria: ClarifyCriterion[], extra: string | null, messages: ChatMessage[], turns: number): Promise<ChatTurn | null> {
  // a criterion asked MAX_ASKS_PER_CRITERION times is not asked again — the requestor may simply not know
  const asked = new Map<string, number>();
  for (const m of messages) for (const k of m.criteria ?? []) asked.set(k, (asked.get(k) ?? 0) + 1);
  const usedUp = criteria.filter((c) => (asked.get(c.key) ?? 0) >= MAX_ASKS_PER_CRITERION).map((c) => c.key);
  try {
    const text = await chat(SYSTEM, describe(r, criteria, extra, messages, usedUp));
    // some models wrap the JSON in a ``` fence or add a line before it
    const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}') as {
      assessment?: { key?: unknown; status?: unknown; note?: unknown; summary?: unknown }[]; asking?: unknown; message?: unknown; done?: unknown;
    };
    if (!Array.isArray(out.assessment)) throw new Error('no assessment in the reply');
    const got = new Map(out.assessment.map((a) => [String(a.key), a]));
    const coverage: CriterionCoverage[] = criteria.map((c) => {
      const a = got.get(c.key);
      let status: CoverageStatus = STATUSES.includes(a?.status as CoverageStatus) ? (a!.status as CoverageStatus) : 'missing';
      if (c.required && status === 'not_applicable') status = 'missing';
      return { key: c.key, label: c.label, required: c.required, status, note: str(a?.note), summary: str(a?.summary) };
    });

    const askable = new Set(coverage.filter((c) => c.status === 'missing' && !usedUp.includes(c.key)).map((c) => c.key));
    const raw = Array.isArray(out.asking) ? out.asking.map(String) : [];
    const asking = raw.filter((k) => askable.has(k)).slice(0, CRITERIA_PER_TURN);
    // the AI went back to used-up criteria only: nothing new to ask, so wrap up instead of repeating itself
    const repeating = raw.length > 0 && raw.every((k) => usedUp.includes(k));
    const done = out.done === true || !askable.size || repeating || turns + 1 > MAX_AI_TURNS;
    const content = str(out.message)?.slice(0, MAX_CHAT_MESSAGE);
    if (!content && !done) throw new Error('no message in the reply');
    return {
      coverage,
      done,
      message: {
        role: 'assistant',
        content: done && (out.done !== true || !content) ? WRAP_UP : content!,
        at: new Date().toISOString(),
        ...(done ? {} : { criteria: asking }),
      },
    };
  } catch (e) {
    console.warn('[ai] clarification chat turn failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
