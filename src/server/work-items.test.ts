import { describe, expect, it } from 'vitest';
import { parseBugUpdate, parseTaskUpdate, workType } from './work-items';

describe('workType', () => {
  it('accepts task and bug only', () => {
    expect(workType('task')).toBe('task');
    expect(workType('bug')).toBe('bug');
    expect(() => workType('retest')).toThrow();
  });
});

describe('parseTaskUpdate', () => {
  it('keeps status, progress and a trimmed comment', () => {
    expect(parseTaskUpdate({ status: 'review', progress: '80.555', comment: '  done  ' })).toEqual({ status: 'review', progress: 80.56, comment: 'done' });
  });
  it('never lets a tool complete or cancel a task', () => {
    expect(() => parseTaskUpdate({ status: 'completed' })).toThrow(/left to people/);
    expect(() => parseTaskUpdate({ status: 'cancelled' })).toThrow();
  });
  it('rejects bad progress and empty updates', () => {
    expect(() => parseTaskUpdate({ progress: 101 })).toThrow();
    expect(() => parseTaskUpdate({ progress: 'abc' })).toThrow();
    expect(() => parseTaskUpdate({ comment: '   ' })).toThrow(/Nothing to update/);
  });
});

describe('parseBugUpdate', () => {
  it('needs a description to mark a fix ready', () => {
    expect(() => parseBugUpdate({ action: 'fix_ready' })).toThrow(/fix_description/);
    expect(parseBugUpdate({ action: 'fix_ready', fix_description: 'Use shift end crossing midnight' }).action).toBe('fix_ready');
  });
  it('only knows the developer actions', () => {
    expect(() => parseBugUpdate({ action: 'close' })).toThrow();
    expect(parseBugUpdate({ comment: 'Looking into it' })).toMatchObject({ action: undefined, comment: 'Looking into it' });
    expect(() => parseBugUpdate({})).toThrow(/Nothing to update/);
  });
});
