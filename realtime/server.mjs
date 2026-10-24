// Realtime relay for the Design tab: live cursors and shapes being dragged, between the people who have the same
// diagram open. Positions are relayed, never stored, and this service never touches the database — the Next app
// checks who may open a diagram and hands out a short-lived token for its room (/api/diagrams/[id]/live).
// Saves and "who has it open" stay on the app's SSE stream; this only carries the high-frequency, throw-away part.
//
//   REALTIME_PORT (default 3001), AUTH_SECRET (same as the app)
//   Production: route wss://<host>/realtime to this service in the reverse proxy (WebSocket upgrade on).
import http from 'node:http';
import { jwtVerify } from 'jose';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.REALTIME_PORT ?? 3001);
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('AUTH_SECRET must be set (at least 32 characters)');
const key = new TextEncoder().encode(SECRET);

const MAX_MESSAGE = 8 * 1024;
const MAX_PER_SECOND = 60;
const COLORS = ['#e2445c', '#0073ea', '#00a862', '#a25ddc', '#ff642e', '#037f4c', '#bb3354', '#579bfc', '#9d50dd', '#d9822b'];

/** diagram id → open sockets */
const rooms = new Map();

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

/** only the shapes we know, with sane values — anything else is dropped */
function clean(m) {
  if (m?.t === 'cursor') return { t: 'cursor', x: num(m.x), y: num(m.y) };
  if (m?.t === 'drag' && Array.isArray(m.nodes)) {
    const nodes = m.nodes.slice(0, 50).map((n) => ({ id: str(n?.id, 40), x: num(n?.x), y: num(n?.y), w: num(n?.w), h: num(n?.h) }))
      .filter((n) => n.id && n.x !== null && n.y !== null);
    return { t: 'drag', nodes };
  }
  if (m?.t === 'drag-end') return { t: 'drag-end' };
  return null;
}

function broadcast(room, from, payload) {
  const data = JSON.stringify(payload);
  for (const ws of rooms.get(room) ?? []) if (ws !== from && ws.readyState === ws.OPEN) ws.send(data);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') return res.writeHead(200).end('ok');
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ server, path: '/realtime', maxPayload: MAX_MESSAGE });

wss.on('connection', async (ws, req) => {
  let me;
  try {
    const token = new URL(req.url, 'http://x').searchParams.get('token') ?? '';
    const { payload } = await jwtVerify(token, key, { audience: 'pcw-realtime' });
    me = { room: Number(payload.d), tab: String(payload.tab), userId: Number(payload.sub), name: String(payload.name) };
    if (!me.room || !me.tab || !me.userId) throw new Error('bad token');
  } catch {
    return ws.close(4401, 'unauthorized');
  }
  me.color = COLORS[me.userId % COLORS.length];
  const room = rooms.get(me.room) ?? new Set();
  rooms.set(me.room, room);
  room.add(ws);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  // a simple per-socket rate limit: a runaway client cannot flood the room
  let windowStart = Date.now(), count = 0;
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > MAX_PER_SECOND) return;
    let msg;
    try { msg = clean(JSON.parse(String(raw))); } catch { return; }
    if (msg) broadcast(me.room, ws, { ...msg, tab: me.tab, userId: me.userId, name: me.name, color: me.color });
  });
  ws.on('close', () => {
    room.delete(ws);
    if (!room.size) rooms.delete(me.room);
    broadcast(me.room, ws, { t: 'gone', tab: me.tab });
  });
});

// drop connections that stopped answering (laptop closed, network gone)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000).unref();

server.listen(PORT, () => console.log(`[realtime] listening on :${PORT}/realtime`));
