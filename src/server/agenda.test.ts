import { describe, expect, it } from 'vitest';
import { byUrgency, whenDue } from './agenda';

describe('whenDue', () => {
  const d = '2026-10-31';
  it('buckets a due date relative to the day asked about', () => {
    expect(whenDue('2026-10-30', d)).toBe('overdue');
    expect(whenDue('2026-10-31', d)).toBe('today');
    expect(whenDue('2026-11-01', d)).toBe('this_week');
    expect(whenDue('2026-11-07', d)).toBe('this_week');
    expect(whenDue('2026-11-08', d)).toBe('later');
    expect(whenDue(null, d)).toBe('no_due_date');
  });
});

describe('byUrgency', () => {
  it('puts overdue first, then earlier due dates, then higher priority', () => {
    const rows = [
      { id: 1, when: 'today' as const, due_date: '2026-10-31', priority: 'low' },
      { id: 2, when: 'today' as const, due_date: '2026-10-31', priority: 'critical' },
      { id: 3, when: 'overdue' as const, due_date: '2026-10-20', priority: 'low' },
      { id: 4, when: 'no_due_date' as const, due_date: null, priority: 'high' },
      { id: 5, when: 'overdue' as const, due_date: '2026-10-01', priority: 'low' },
    ];
    expect(rows.sort(byUrgency).map((r) => r.id)).toEqual([5, 3, 2, 1, 4]);
  });
});
