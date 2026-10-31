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
];

async function api(path) {
  if (!TOKEN) throw new Error('PCW_TOKEN is not set. Create a token on the Profile page of Project Control and export PCW_TOKEN before starting Claude Code.');
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
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
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'pcw-tasks', version: '0.1.0' },
        instructions: 'Project Control (PCW) work tracker. Call get_my_agenda to see what the user has to do; summarise overdue items first.',
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
