import { describe, expect, it } from 'vitest';
import type { Ctx } from './db';
import { assertCanComplete, taskBeforeWrite } from './logic/project';

/** A Ctx stub answering the few lookups these rules run, keyed by a fragment of the SQL */
function stub(answers: { match: string; rows: unknown[] }[], depth = 0): Ctx {
  const find = (sql: string) => {
    const hit = answers.find((a) => sql.replace(/\s+/g, ' ').includes(a.match));
    if (!hit) throw new Error(`unexpected query: ${sql}`);
    return hit.rows;
  };
  return {
    depth, today: '2026-11-01',
    q: async (sql: string) => find(sql),
    val: async (sql: string) => {
      const row = find(sql)[0] as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : null;
    },
  } as unknown as Ctx;
}

describe('assertCanComplete', () => {
  const closed = [
    { match: 'FROM activities', rows: [] },
    { match: 'FROM evidence_requirements', rows: [] },
    { match: "severity = 'critical'", rows: [{ n: 0 }] },
  ];
  it('passes when activities, evidence, critical bugs and change requests are all done', async () => {
    await expect(assertCanComplete(stub([...closed, { match: 'FROM change_requests', rows: [] }]), 1)).resolves.toBeUndefined();
  });
  it('refuses while a change request is still open, naming it', async () => {
    await expect(assertCanComplete(stub([...closed, { match: 'FROM change_requests', rows: [{ cr_no: 'CR-001' }, { cr_no: 'CR-003' }] }]), 1))
      .rejects.toThrow('Change request(s) still open: CR-001, CR-003');
  });
});

describe('taskBeforeWrite — actual effort', () => {
  const old = { id: 7, name: 'Build report', status: 'review', progress: 100 };
  const leaf = [{ match: 'WHERE parent_task_id = ?', rows: [] }, { match: 'FROM evidence_requirements', rows: [] }];
  const parent = [{ match: 'WHERE parent_task_id = ?', rows: [{ one: 1 }] }, { match: 'FROM evidence_requirements', rows: [] }];

  it('needs man-days to complete a task without sub-tasks', async () => {
    await expect(taskBeforeWrite(stub(leaf), { ...old, status: 'completed', actual_md: null }, old)).rejects.toThrow(/actual effort/);
    const n = { ...old, status: 'completed', actual_md: '1.25' };
    await taskBeforeWrite(stub(leaf), n, old);
    expect(n.actual_md).toBe(1.3);
  });
  it('completes a parent task without man-days (it sums its sub-tasks)', async () => {
    await expect(taskBeforeWrite(stub(parent), { ...old, status: 'completed', actual_md: null }, old)).resolves.toBeUndefined();
  });
  it('range-checks typed values but not a roll-up sum', async () => {
    await expect(taskBeforeWrite(stub(leaf), { ...old, actual_md: 1200 }, old)).rejects.toThrow(/999/);
    const rolled = { ...old, status: 'completed', actual_md: 1200 };
    await taskBeforeWrite(stub(parent, 1), rolled, old);
    expect(rolled.actual_md).toBe(1200);
  });
});
