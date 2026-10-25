/** Key for maps that mix rows of several tables (ids are per table: activity 5 ≠ task 5) */
export const entityKey = (type: string, id: number | null | undefined) => `${type}:${id ?? ''}`;

/** Select / MultiSelect values are strings — ids go in with idValue() and come back with toId() */
export const idValue = (id: number | null | undefined) => (id == null ? '' : String(id));
export const toId = (v: string | null | undefined) => (v ? Number(v) : null);
