import 'server-only';
import { CRITERIA_PER_TURN, MAX_AI_TURNS, type IntakeForm, MAX_ASKS_PER_CRITERION, MAX_CHAT_MESSAGE, coverageReadiness, type AiAnalysis, type ChatMessage, type AiCoverage, type ClarifyCriterion, type CoverageStatus, type CriterionCoverage } from '@/lib/clarify';
import enEnums from '@/i18n/messages/en/enums.json';
import { REDUCTION_ROWS } from '@/lib/constants';
import type { ProjectRequest } from '@/lib/types';

/**
 * Company LLM through an OpenAI-compatible Chat Completions API (OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL).
 * OPENAI_BASE_URL unset = AI is off and requests are submitted without follow-up questions.
 */
export const aiEnabled = () => !!process.env.OPENAI_BASE_URL;

const SYSTEM = `You are a friendly business analyst in the IT System Service team, chatting with a staff member who is about to submit a project request.
Through a focused conversation, find out what the team must know at request time to understand, estimate and plan the project — the CRITERIA below.
Aim for a shared understanding concrete enough that a developer could estimate the work without calling the requestor back.
You get the request form, the conversation so far and the criteria. On every turn:

1. Check every criterion against the form and the conversation:
   - "covered": the information is concrete enough to plan with — specifics such as who (roles, departments), how many / how often / how much, which screens, reports or systems, and real examples where they matter.
     A general answer is NOT enough: "the whole department", "faster", "easier to use", "reduce mistakes", "the usual reports" leave it "missing" until made specific (e.g. "about 30 operators in 3 shifts", "approval in 1 day instead of 3").
     Also covered when the requestor said they do not know / have not decided / want to skip it — do not push; say so in the summary.
   - "not_applicable": only for an optional criterion that the form or the answers clearly show does not apply to this system (e.g. approval steps for a read-only dashboard). Never for a required one. When unsure, it is "missing" — never mark one not applicable just because it has not come up yet.
   - "missing": otherwise.
   A short reply such as "Not sure yet" or "Skip this question" answers everything your previous message asked about: mark those criteria covered (not known yet / skipped) and move on.
   Give each a short "note" (why — for a missing one with a partial answer, what detail is still lacking) and a "summary": 1–2 lines of what is actually known, written for the development team — null when nothing is known (never write "not specified").

2. Write your next chat "message" — ask ONE question per turn (at most ${CRITERIA_PER_TURN} criterion key in "asking"):
   - Start with a very short, natural acknowledgement of the last answer (no flattery).
   - Follow the thread: when the last answer is vague or partial, dig into that same criterion first (who exactly, how many, how often, an example) before moving on.
     When an answer opens a new branch (e.g. "it needs approval"), follow it up right away (who approves, what happens when it is rejected) — let each answer decide the next question rather than going down the list.
   - Otherwise move to the next missing criterion, required ones first.
   - Where you can guess a likely answer from the form or earlier answers, offer it for them to confirm or correct (e.g. "So the line leaders fill it in and the section manager approves — is that right?"); otherwise give an example answer in brackets.
   - Short and easy for a non-IT person: at most 3 sentences, plain text, no lists or markdown.
   - Never ask about something already covered, nor about priority or the required date.
   - On the first turn (no conversation yet), greet briefly, say in one sentence what you will ask about, then ask the first question.
   List the criterion keys the message asks about in "asking".

3. When nothing important is left (every required criterion covered, every optional one covered or not applicable), set "done": true,
   "asking": [] and make the message a one-line thank-you asking them to review the summary before submitting.

Write the note, summary and message in the same language as the request (Thai request → Thai).
Reply with JSON only, exactly in this shape:
{"assessment": [{"key": "<criterion key>", "status": "covered|missing|not_applicable", "note": "...", "summary": "..." }], "asking": ["<criterion key>"], "message": "...", "done": false}`;

/**
 * Intake: the requestor starts a new request by talking to the AI instead of filling in the form; each turn also
 * returns the form fields the conversation has made clear. Priority and the required date stay with the requestor.
 */
const INTAKE = `INTAKE MODE — the requestor has not filled in the request form; you fill it in for them from the conversation.
- Before the criteria, find out what they want (a short project name and a brief description), why (reason for the request) and the expected result. Ask about these first while they are still unknown — they are not in the criteria list.
- Add a "form" object to your JSON reply:
  {"project_name": "...", "description": "...", "reason": "...", "expectation": "...", "reduction": {"time_from": null, "time_to": null, "man_from": null, "man_to": null, "cost_from": null, "cost_to": null}}
  - project_name: a short name for the system or project, at most about 8 words.
  - description, reason, expectation: 1–3 plain sentences each, from what the requestor actually said — never invent facts. Keep what the form already has unless the conversation changes it.
  - reduction: time in minutes per month, man as people per month, cost in THB — current value (from) and the expected value after the project (to). Fill a number ONLY when the requestor stated that exact measure (e.g. "we spend 600 minutes a month"); otherwise null.
    Never derive or guess one: a goal about something else ("no more double bookings", "faster") is NOT a reduction value, and a current value without a stated target leaves "to" null.
  - null for anything not known yet.
- Never set or ask about the priority or the required date — the requestor picks those in the form.
- Set "done" only when project_name, description and reason are known as well as the criteria; the closing message asks them to check the filled-in form, pick the priority and required date, then submit.`;


export type ChatLang = 'th' | 'en';

function formLines(r: ProjectRequest, extra: string | null) {
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
    if (from != null || to != null) lines.push(`Reduction ${enEnums.reduction[row.key]}: ${from ?? '-'} → ${to ?? '-'}`);
  }
  if (extra) lines.push(`The approver asked the requestor for more information: ${extra}`);
  return lines;
}

function describe(r: ProjectRequest, criteria: ClarifyCriterion[], extra: string | null, messages: ChatMessage[], usedUp: string[], lang?: ChatLang) {
  const lines = formLines(r, extra);
  if (lang) lines.push('', `OUTPUT LANGUAGE: ${lang === 'th' ? 'Thai' : 'English'} (the requestor's screen language) — switch only if the requestor writes in another language.`);
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

const VOICE = `You are a friendly business analyst in the IT System Service team, TALKING (voice call) with a staff member who is about to submit a project request.
Through a focused spoken conversation, find out what the team must know to understand, estimate and plan the project — the CRITERIA below — concretely enough that a developer could estimate the work without calling them back.
- Speak in the same language as the request form (Thai request → Thai, polite and natural). Short spoken sentences: at most 2–3 per turn, no lists.
- Each turn: a very short acknowledgement of the last answer (no flattery), then ONE question, required criteria first.
- Follow the thread: a general answer ("the whole department", "faster", "fewer mistakes") is not enough — dig into it first (who exactly, how many, how often, an example). When an answer opens a new branch (e.g. "it needs approval"), follow it up right away (who approves, what if it is rejected).
- Where you can guess a likely answer from the form or earlier answers, offer it for them to confirm or correct; otherwise a short example answer helps.
- If they do not know or want to skip, accept it and move on — never push.
- Never ask about priority or the required date, nor about something already answered in the form or the conversation.
- You will receive text notes in square brackets ([START], [CHECKLIST], [DONE]) from the system. They are not from the user and must never be read out. [START] = begin talking now. [CHECKLIST] comes from the system that checks the answers: follow it — ask only about criteria it lists as missing.
  A note starting with [DONE] means everything needed is covered: thank them in one sentence and ask them to press "Review & Submit" to check the summary.
- If the conversation so far is empty, greet briefly, say in one sentence what you will ask about, then ask the first question. Otherwise continue where it left off.`;

const VOICE_INTAKE = `- The request form may still be empty: the system fills it in from this conversation. Before the criteria, find out what they want, why, and the expected result. Never ask about priority or the required date.
  Instead of "Review & Submit", the closing sentence asks them to check the filled-in form, pick the priority and required date, then submit.`;

/** System instruction for a Gemini Live voice session: the form, the criteria and the conversation so far */
export function voiceInstruction(r: ProjectRequest, criteria: ClarifyCriterion[], extra: string | null, messages: ChatMessage[], opts: { intake?: boolean; lang?: ChatLang } = {}) {
  return `${VOICE}${opts.intake ? `\n${VOICE_INTAKE}` : ''}\n\n${describe(r, criteria, extra, messages, [], opts.lang)}`;
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

export type ChatTurn = { coverage: CriterionCoverage[]; message: ChatMessage; done: boolean; form?: IntakeForm };

const STATUSES: CoverageStatus[] = ['covered', 'missing', 'not_applicable'];
/** closing line when the conversation ends on our side (turn limit, nothing left to ask) rather than the AI's */
const WRAP_UP: Record<'clarify' | 'intake', Record<ChatLang, string>> = {
  clarify: {
    en: "Thanks — that's everything I need. Please check the summary before you submit.",
    th: 'ขอบคุณครับ ได้ข้อมูลครบแล้ว กรุณาตรวจสอบสรุปก่อนส่งคำขอ',
  },
  intake: {
    en: "Thanks — I've filled in the form from our chat. Please check it, pick the priority and required date, then submit.",
    th: 'ขอบคุณครับ กรอกฟอร์มจากที่คุยกันให้แล้ว กรุณาตรวจสอบ เลือกความสำคัญและวันที่ต้องการ แล้วส่งคำขอ',
  },
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

/** Form fields from the AI's "form" object — only what it filled, trimmed and bounded */
function intakeForm(v: unknown): IntakeForm {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const red = (o.reduction && typeof o.reduction === 'object' ? o.reduction : {}) as Record<string, unknown>;
  const out: IntakeForm = {};
  const text = (k: 'project_name' | 'description' | 'reason' | 'expectation', max: number) => {
    const s = str(o[k]);
    if (s) out[k] = s.slice(0, max);
  };
  text('project_name', 200); text('description', 2000); text('reason', 2000); text('expectation', 2000);
  for (const [k, col] of [['time_from', 'reduction_time_from'], ['time_to', 'reduction_time_to'], ['man_from', 'reduction_man_from'], ['man_to', 'reduction_man_to'], ['cost_from', 'reduction_cost_from'], ['cost_to', 'reduction_cost_to']] as const) {
    const n = num(red[k]);
    if (n != null && n >= 0) out[col] = n;
  }
  return out;
}

/**
 * Next AI message in the clarification chat, with its check of every criterion; null when the AI failed.
 * `turns` = AI messages so far in this conversation — at MAX_AI_TURNS the conversation wraps up.
 * `intake`: the form is filled in from the conversation (see INTAKE); the turn also returns the form fields.
 */
export async function chatTurn(r: ProjectRequest, criteria: ClarifyCriterion[], extra: string | null, messages: ChatMessage[], turns: number,
  opts: { intake?: boolean; lang?: ChatLang } = {}): Promise<ChatTurn | null> {
  const mode = opts.intake ? 'intake' : 'clarify';
  // a criterion asked MAX_ASKS_PER_CRITERION times is not asked again — the requestor may simply not know
  const asked = new Map<string, number>();
  for (const m of messages) for (const k of m.criteria ?? []) asked.set(k, (asked.get(k) ?? 0) + 1);
  const usedUp = criteria.filter((c) => (asked.get(c.key) ?? 0) >= MAX_ASKS_PER_CRITERION).map((c) => c.key);
  try {
    const text = await chat(opts.intake ? `${SYSTEM}\n\n${INTAKE}` : SYSTEM, describe(r, criteria, extra, messages, usedUp, opts.lang));
    // some models wrap the JSON in a ``` fence or add a line before it
    const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}') as {
      assessment?: { key?: unknown; status?: unknown; note?: unknown; summary?: unknown }[]; asking?: unknown; message?: unknown; done?: unknown; form?: unknown;
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
    const form = opts.intake ? intakeForm(out.form) : undefined;
    // intake: the basics of the form must be known too, whatever the criteria say
    const formOpen = !!opts.intake && !['project_name', 'description', 'reason'].every((k) => form?.[k as keyof IntakeForm] ?? r[k as keyof ProjectRequest]);
    const limit = turns + 1 > MAX_AI_TURNS;
    const done = limit || (!formOpen && (out.done === true || !askable.size || repeating));
    const content = str(out.message)?.slice(0, MAX_CHAT_MESSAGE);
    if (!content && !done) throw new Error('no message in the reply');
    return {
      coverage,
      done,
      form,
      message: {
        role: 'assistant',
        content: done && (out.done !== true || !content) ? WRAP_UP[mode][opts.lang ?? 'en'] : content!,
        at: new Date().toISOString(),
        ...(done ? {} : { criteria: asking }),
      },
    };
  } catch (e) {
    console.warn('[ai] clarification chat turn failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

const ANALYSIS = `You are a senior business analyst and project estimator in the IT System Service team.
A staff member has just submitted a project request. You get the request form, the summary per criterion that the requestor
confirmed after an interview with the AI, the interview itself, the team's project types and templates, and earlier projects.
Write a short initial analysis to help System Service review and plan the request:
- "complexity": "low" | "medium" | "high" — size and technical difficulty (number of users and roles, screens, integrations, approval flows, data migration).
- "readiness": 0–100 — how complete and concrete the requirements are for planning (100 = a developer could estimate without asking anything).
- "effort_min", "effort_max": estimated effort in man-days (MD) for the whole project — analysis, development, testing, deployment — as a realistic range.
  Use the template activity durations and comparable earlier projects as reference points where they fit.
- "phases": the most likely effort split into exactly these phases, in MD: "Analysis & Design", "Development", "Testing (SIT/UAT)", "Deployment & Training".
  Their sum must lie within effort_min–effort_max.
- "rationale": 1–2 short sentences — the main drivers behind the complexity and effort (e.g. "3 roles, 2-step approval and an ERP interface; similar to PRJ-2026-003").
- "modules": 2–6 suggested system modules, each a short name (e.g. "Request Management", "Approval Workflow", "Dashboard", "Notification").
- "risks": 1–4 short concrete risks or open points that could change scope or effort (e.g. "Approval matrix not finalized"). Base them on what is missing, vague or undecided.
- "next_step": one short sentence — the most useful next action before planning.
- "project_type_id": the id of the best fitting PROJECT TYPE, or null when none fits.
- "template_id": the id of the best fitting PROJECT TEMPLATE (prefer one of the chosen type), or null when none fits.
- "similar": up to 3 EARLIER PROJECTS that are genuinely similar in purpose or features (not just the same department), each {"code": "<project code>", "reason": "<what is alike, at most 10 words>"}; [] when none is.
Each item at most about 8 words unless stated otherwise. Write modules and phases in English; write rationale, risks, next_step and reasons in the same language as the request (Thai request → Thai).
Reply with JSON only, exactly in this shape:
{"complexity": "medium", "readiness": 80, "effort_min": 10, "effort_max": 15, "phases": [{"phase": "Analysis & Design", "md": 2}], "rationale": "...", "modules": ["..."], "risks": ["..."], "next_step": "...", "project_type_id": 1, "template_id": 1, "similar": [{"code": "...", "reason": "..."}]}`;

/** What the analysis may pick from or compare with — active project types / templates and earlier projects */
export interface AnalysisCatalog {
  types: { id: number; name: string }[];
  templates: { id: number; name: string; project_type_id: number | null; description: string | null; activities: { name: string; duration_days?: number }[] }[];
  projects: { id: number; code: string; name: string; type: string | null; status: string; start: string | null; target: string | null; finished: string | null; description: string | null }[];
}

const COMPLEXITY = ['low', 'medium', 'high'] as const;
const PHASES = ['Analysis & Design', 'Development', 'Testing (SIT/UAT)', 'Deployment & Training'];
const strs = (v: unknown, max: number, len = 120) => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x).map((x) => x.slice(0, len)).slice(0, max) : []);
const halfDays = (n: number) => Math.round(n * 2) / 2;

/** Initial analysis of a submitted request; null when the AI failed */
export async function analyzeRequest(r: ProjectRequest, coverage: AiCoverage | null, messages: ChatMessage[], catalog: AnalysisCatalog): Promise<AiAnalysis | null> {
  const lines = formLines(r, null);
  const known = (coverage?.criteria ?? []).filter((c) => c.status !== 'not_applicable');
  if (known.length) {
    lines.push('', 'CLARIFICATION SUMMARY (confirmed by the requestor)');
    for (const c of known) lines.push(`- ${c.label}${c.required ? ' (required)' : ''}: ${c.status === 'covered' ? c.summary || c.note || 'covered' : `MISSING${c.note ? ` — ${c.note}` : ''}`}`);
  }
  if (messages.length) {
    lines.push('', 'INTERVIEW');
    for (const m of messages) lines.push(`${m.role === 'assistant' ? 'AI' : 'Requestor'}: ${m.content}`);
  }
  // the catalog below is mostly English, which pulls the model away from the request's own language — so name it
  const thai = /[\u0E00-\u0E7F]/.test([r.project_name, r.description, r.reason, r.expectation, ...messages.filter((m) => m.role === 'user').map((m) => m.content)].join(' '));
  lines.push('', `OUTPUT LANGUAGE: write rationale, risks, next_step and similar reasons in ${thai ? 'Thai' : 'English'}.`);
  lines.push('', 'PROJECT TYPES');
  for (const t of catalog.types) lines.push(`- id ${t.id}: ${t.name}`);
  lines.push('', 'PROJECT TEMPLATES (default activities with working days)');
  for (const t of catalog.templates) {
    const acts = t.activities.map((a) => `${a.name}${a.duration_days ? ` ${a.duration_days}d` : ''}`).join(', ');
    lines.push(`- id ${t.id}: ${t.name} (type id ${t.project_type_id ?? '-'})${t.description ? ` — ${t.description.slice(0, 150)}` : ''}${acts ? ` | ${acts}` : ''}`);
  }
  lines.push('', 'EARLIER PROJECTS');
  if (!catalog.projects.length) lines.push('(none yet)');
  for (const p of catalog.projects) {
    lines.push(`- ${p.code}: ${p.name} | ${p.type ?? '-'} | ${p.status} | ${p.start ?? '?'} → ${p.finished ? `finished ${p.finished}` : `target ${p.target ?? '?'}`}${p.description ? ` | ${p.description.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
  }
  try {
    const text = await chat(ANALYSIS, lines.join('\n'));
    const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}') as Record<string, unknown>;
    const complexity = COMPLEXITY.find((c) => c === String(out.complexity).toLowerCase());
    let lo = num(out.effort_min), hi = num(out.effort_max);
    if (!complexity || lo == null || hi == null) throw new Error('incomplete analysis in the reply');
    lo = Math.max(1, Math.round(lo)); hi = Math.max(lo, Math.round(hi));

    const phaseRows = Array.isArray(out.phases) ? (out.phases as { phase?: unknown; md?: unknown }[]) : [];
    const phases = PHASES.flatMap((phase) => {
      const md = num(phaseRows.find((x) => String(x?.phase).toLowerCase() === phase.toLowerCase())?.md);
      return md != null && md > 0 ? [{ phase, md: halfDays(md) }] : [];
    });
    // keep the range honest: the most likely figure always lies inside it
    const likely = phases.reduce((t, x) => t + x.md, 0);
    if (likely) { lo = Math.min(lo, Math.floor(likely)); hi = Math.max(hi, Math.ceil(likely)); }

    const type = catalog.types.find((t) => t.id === num(out.project_type_id)) ?? null;
    const tpl = catalog.templates.find((t) => t.id === num(out.template_id)) ?? null;
    const similarRows = Array.isArray(out.similar) ? (out.similar as { code?: unknown; reason?: unknown }[]) : [];
    const similar = similarRows.flatMap((x) => {
      const p = catalog.projects.find((q) => q.code === str(x?.code));
      return p ? [{ id: p.id, code: p.code, name: p.name, reason: str(x.reason)?.slice(0, 160) ?? '' }] : [];
    }).filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i).slice(0, 3);

    // the criteria check is the measured readiness; the AI's own guess only when there was no check
    const readiness = coverageReadiness(coverage) ?? Math.min(100, Math.max(0, Math.round(num(out.readiness) ?? 0)));
    return {
      status: 'done', analyzed_at: new Date().toISOString(), complexity, readiness, effort_min: lo, effort_max: hi,
      phases, rationale: str(out.rationale)?.slice(0, 400),
      modules: strs(out.modules, 6), risks: strs(out.risks, 4), next_step: str(out.next_step)?.slice(0, 300),
      project_type: type && { id: type.id, name: type.name },
      template: tpl && { id: tpl.id, name: tpl.name },
      similar,
    };
  } catch (e) {
    console.warn('[ai] request analysis failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
