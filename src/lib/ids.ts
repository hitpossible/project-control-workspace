/** Key for maps that mix rows of several tables (ids are per table: activity 5 ≠ task 5) */
export const entityKey = (type: string, id: number | null | undefined) => `${type}:${id ?? ''}`;

/** Select / MultiSelect values are strings — ids go in with idValue() and come back with toId() */
export const idValue = (id: number | null | undefined) => (id == null ? '' : String(id));
export const toId = (v: string | null | undefined) => (v ? Number(v) : null);

/** crypto.randomUUID() only exists in secure contexts (https / localhost) — plain-http deployments need the fallback */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
