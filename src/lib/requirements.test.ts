import { describe, expect, it } from 'vitest';
import { emptySummary, isEmptySummary, normalizeSummary, parseSkillSuggestions, summaryText } from './requirements';

describe('normalizeSummary', () => {
  it('keeps known sections only, trims, splits pasted lists and strips bullets / numbering', () => {
    const s = normalizeSummary({
      objective: '  Cut scrap reporting time  ', features: ['- Record scrap', '2. Approve scrap', 'F3: Export to Excel', '  '],
      integrations: 'Read items from SAP\n\nSend e-mail', hacker: 'x', users: ['Line leaders', '30 people'],
    });
    expect(s.objective).toBe('Cut scrap reporting time');
    expect(s.features).toEqual(['Record scrap', 'Approve scrap', 'Export to Excel']);
    expect(s.integrations).toEqual(['Read items from SAP', 'Send e-mail']);
    expect(s.users).toBe('Line leaders\n30 people');
    expect('hacker' in s).toBe(false);
    expect(s.open_questions).toEqual([]);
  });

  it('anything that is not an object becomes an empty summary', () => {
    expect(normalizeSummary(null)).toEqual(emptySummary());
    expect(isEmptySummary(normalizeSummary('nope'))).toBe(true);
  });

  it('renders features as F1, F2… for the prompt', () => {
    const text = summaryText(normalizeSummary({ objective: 'Goal', features: ['A', 'B'] }), {
      objective: 'Objective', users: 'Users', features: 'Features', out_of_scope: 'Out', integrations: 'Int', data_reports: 'Data',
      environment: 'Env', constraints: 'Con', open_questions: 'Open',
    });
    expect(text).toBe('Objective:\n  Goal\nFeatures:\n  F1. A\n  F2. B');
  });
});

describe('parseSkillSuggestions', () => {
  const opts = { skillIds: new Set([1, 2, 3, 4]), required: new Set([4]), features: 3 };

  it('keeps known, not-yet-required skills once, clamps levels and drops refs to features that do not exist', () => {
    const out = parseSkillSuggestions({
      skills: [
        { skill_id: 2, required_level: 9, weight: 2, reason: 'API', refs: ['f2', 'F9', 'F2'] },
        { skill_id: 1, required_level: '4', weight: 5, is_mandatory: true, reason: 'UI', refs: ['F1'] },
        { skill_id: 1, required_level: 2 },          // duplicate
        { skill_id: 4, required_level: 3 },          // already required
        { skill_id: 99, required_level: 3 },         // not in the list
        { skill_id: 3, required_level: null, weight: 'x' },
      ],
      missing: [{ name: 'OPC UA', category: 'integration', reason: 'machine data' }, { name: '', category: 'x' }, { name: 'Odd', category: 'weird' }],
    }, opts);
    expect(out.suggestions.map((s) => s.skill_id)).toEqual([1, 3, 2]);
    expect(out.suggestions[0]).toMatchObject({ required_level: 4, weight: 5, is_mandatory: true, refs: ['F1'] });
    expect(out.suggestions[1]).toMatchObject({ required_level: 3, weight: 3, is_mandatory: false });
    expect(out.suggestions[2]).toMatchObject({ required_level: 5, refs: ['F2'] });
    expect(out.missing).toEqual([{ name: 'OPC UA', category: 'integration', reason: 'machine data' }, { name: 'Odd', category: 'other', reason: '' }]);
  });

  it('a reply without skills gives nothing to suggest', () => {
    expect(parseSkillSuggestions('garbage', opts)).toEqual({ suggestions: [], missing: [] });
  });
});
