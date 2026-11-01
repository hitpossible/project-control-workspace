import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, MAX_AI_REQUIREMENTS, parseAiRequirements } from './clarify';

describe('parseAiRequirements', () => {
  it('keeps well-formed items, trimmed, with a default priority', () => {
    expect(parseAiRequirements([{ title: '  Line leader submits a report  ', category: 'Request', priority: 'MUST', acceptance_criteria: ' Saved in 2 s ' }, { title: 'Export to Excel', priority: 'urgent' }])).toEqual([
      { title: 'Line leader submits a report', category: 'Request', description: null, priority: 'must', acceptance_criteria: 'Saved in 2 s' },
      { title: 'Export to Excel', category: null, description: null, priority: 'should', acceptance_criteria: null },
    ]);
  });
  it('drops items without a title and duplicates', () => {
    expect(parseAiRequirements([{ title: '' }, null, 'x', { title: 'A' }, { title: 'a' }])).toHaveLength(1);
  });
  it('is empty for anything that is not a list, and bounded', () => {
    expect(parseAiRequirements(undefined)).toEqual([]);
    expect(parseAiRequirements({ title: 'A' })).toEqual([]);
    expect(parseAiRequirements(Array.from({ length: 100 }, (_, i) => ({ title: `R${i}` })))).toHaveLength(MAX_AI_REQUIREMENTS);
  });
});

describe('DEFAULT_CRITERIA', () => {
  it('has unique keys and asks for a step-by-step typical case', () => {
    const keys = DEFAULT_CRITERIA.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_CRITERIA.find((c) => c.key === 'main_flow')?.required).toBe(true);
  });
});
