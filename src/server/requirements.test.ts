import { describe, expect, it } from 'vitest';
import { parseRequirement, taskFromRequirement } from './rpc/requirements';

describe('parseRequirement', () => {
  it('trims, defaults to a draft "should have" and rounds the estimate', () => {
    expect(parseRequirement({ p_title: '  Login  ', p_estimated_md: '2.26' })).toMatchObject({
      title: 'Login', priority: 'should', status: 'draft', estimated_md: 2.3, description: null,
    });
  });
  it('needs a title and valid choices', () => {
    expect(() => parseRequirement({ p_title: '  ' })).toThrow(/Title is required/);
    expect(() => parseRequirement({ p_title: 'x', p_priority: 'urgent' })).toThrow(/Priority/);
    expect(() => parseRequirement({ p_title: 'x', p_status: 'done' })).toThrow(/Status/);
    expect(() => parseRequirement({ p_title: 'x', p_estimated_md: -1 })).toThrow(/man-days/);
  });
});

describe('taskFromRequirement', () => {
  const req = { id: 7, project_id: 3, req_no: 'FR-007', title: 'Export report', description: 'As PDF', acceptance_criteria: 'Opens in Acrobat', priority: 'must' as const };
  const to = { activity_id: 5, owner_id: 9, due_date: '2026-12-01' };
  it('names the task after the requirement and keeps the trace', () => {
    expect(taskFromRequirement(req, to)).toMatchObject({ requirement_id: 7, project_id: 3, name: 'FR-007 Export report', priority: 'high', task_type: 'dev', activity_id: 5, owner_id: 9 });
  });
  it('puts description and acceptance criteria into the task description', () => {
    expect(taskFromRequirement(req, to).description).toBe('As PDF\n\nAcceptance criteria:\nOpens in Acrobat');
    expect(taskFromRequirement({ ...req, description: null, acceptance_criteria: null }, to).description).toBeNull();
  });
  it('maps MoSCoW to task priority and never plans "won\'t have"', () => {
    expect(taskFromRequirement({ ...req, priority: 'could' }, to).priority).toBe('low');
    expect(() => taskFromRequirement({ ...req, priority: 'wont' }, to)).toThrow(/not planned/);
  });
});
