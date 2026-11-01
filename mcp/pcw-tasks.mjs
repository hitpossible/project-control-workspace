#!/usr/bin/env node
// MCP server (stdio) that lets an AI assistant read your work from Project Control.
// It calls the app's API with your personal access token — create one on the Profile page.
//
//   PCW_URL    app address, e.g. http://localhost:3000 (default)
//   PCW_TOKEN  personal access token (pcw_…)
//
// Registered for Claude Code in .mcp.json. Plain JSON-RPC over stdin/stdout, one message per line — no dependencies.
import { createInterface } from 'node:readline';

const BASE = (process.env.PCW_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.PCW_TOKEN || '';
const PROTOCOL = '2025-06-18';

const TOOLS = [
  {
    name: 'get_my_agenda',
    title: 'My work for a day',
    description:
      'List the signed-in user\'s open work in Project Control relative to a date: internal tasks they own (and tasks waiting for their review), ' +
      'bugs assigned to them, and pending retests. Every item has `when` (overdue / today / this_week / later / no_due_date), status, priority, ' +
      'project and a `url`. Items are sorted most urgent first. Use this to answer "what do I have to do today?".',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Day to plan for, YYYY-MM-DD. Defaults to today (server time zone).' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_work_item_detail',
    title: 'Task / bug details',
    description:
      'Everything about one task or bug: description, technical note, steps to reproduce, expected / actual result, fix cycles, retests, ' +
      'sub-tasks, linked bugs, missing evidence and the comment thread. Read this before working on an item. ' +
      'Use `type` and `id` from get_my_agenda (tasks → "task", bugs → "bug", retests → "bug" with `bug_id`).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['task', 'bug'] },
        id: { type: 'integer', description: 'Task id or bug id (not task_no / bug_no).' },
      },
      required: ['type', 'id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'update_task_progress',
    title: 'Update a task / bug',
    description:
      'Record progress on one of the user\'s tasks or bugs in Project Control, as the user. Only call this after the user has confirmed the change. ' +
      'Task: set `status` (todo, in_progress, waiting, review, on_hold — never completed/cancelled; send "review" when the work is done so the reviewer can check it) ' +
      'and/or `progress` (0–100; 100 moves the task to review) and/or add a `comment`. ' +
      'Bug: `action` "start_fix" (bug assigned/reopened → in progress) or "fix_ready" (needs `fix_description`; optional `unit_test_result`, `technical_note`, `commit_link`; ' +
      'creates a retest for QA), and/or a `comment`. Comments are marked as posted via the AI assistant. ' +
      'Needs a token with "Read & update" access. Returns the item after the change.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['task', 'bug'] },
        id: { type: 'integer' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'waiting', 'review', 'on_hold'], description: 'Task only.' },
        progress: { type: 'number', minimum: 0, maximum: 100, description: 'Task only.' },
        actual_md: { type: 'number', exclusiveMinimum: 0, maximum: 999, description: 'Task only: man-days the work really took so far (needed before the reviewer can complete it). Ask the user.' },
        action: { type: 'string', enum: ['start_fix', 'fix_ready'], description: 'Bug only.' },
        fix_description: { type: 'string', description: 'Bug fix_ready: what was changed and why.' },
        unit_test_result: { type: 'string', description: 'Bug fix_ready: tests run and their result.' },
        technical_note: { type: 'string', description: 'Bug fix_ready: notes for the tester / reviewer.' },
        commit_link: { type: 'string', description: 'Bug fix_ready: commit, branch or PR URL.' },
        comment: { type: 'string', description: 'Comment to add to the item (both types).' },
      },
      required: ['type', 'id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

async function api(path, init = {}) {
  if (!TOKEN) throw new Error('PCW_TOKEN is not set. Create a token on the Profile page of Project Control and export PCW_TOKEN before starting Claude Code.');
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new Error(`Cannot reach Project Control at ${BASE} (${e instanceof Error ? e.message : e}). Is the app running? Check PCW_URL.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Project Control answered ${res.status}: ${body.error?.message ?? res.statusText}`);
  return body.data;
}

async function callTool(name, args = {}) {
  if (name === 'get_my_agenda') {
    if (args.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.date))) throw new Error('date must be YYYY-MM-DD');
    const q = args.date ? `?date=${encodeURIComponent(args.date)}` : '';
    return api(`/api/me/agenda${q}`);
  }
  if (name === 'get_work_item_detail' || name === 'update_task_progress') {
    const { type, id, ...rest } = args;
    if (type !== 'task' && type !== 'bug') throw new Error('type must be "task" or "bug"');
    if (!Number.isInteger(id) || id <= 0) throw new Error('id must be a positive integer (the item id, not task_no / bug_no)');
    const path = `/api/me/work/${type}/${id}`;
    return name === 'get_work_item_detail' ? api(path) : api(path, { method: 'POST', body: JSON.stringify(rest) });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'pcw-tasks', version: '0.2.0' },
        instructions:
          'Project Control (PCW) work tracker. Call get_my_agenda to see what the user has to do (summarise overdue items first), ' +
          'get_work_item_detail before working on an item, and update_task_progress to record progress — only after the user agrees to the change. ' +
          'Work on one item at a time; never mark work done that has not been verified.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      try {
        const data = await callTool(msg.params?.name, msg.params?.arguments);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
      } catch (e) {
        return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  if (msg.id === undefined || msg.id === null) return; // notifications (e.g. notifications/initialized) need no answer
  try {
    send({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) });
  } catch (e) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } });
  }
});
