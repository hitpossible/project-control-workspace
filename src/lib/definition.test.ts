import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en/definition.json';
import { completeness, DEFINITION_SECTIONS, definitionText, emptyDefinition, isEmptyDefinition, normalizeDefinition, parseSkillSuggestions } from './definition';

describe('normalizeDefinition', () => {
  it('keeps known sections only, trims, splits pasted lists and strips bullets / numbering', () => {
    const d = normalizeDefinition({
      background: '  Stock is kept in Excel  ', objectives: '- Cut count time\n\n2. One source of truth',
      integrations: ['Read items from SAP'], hacker: 'x', migration: ['1,000 items', 'from Excel'],
    });
    expect(d.background).toBe('Stock is kept in Excel');
    expect(d.objectives).toEqual(['Cut count time', 'One source of truth']);
    expect(d.integrations).toEqual(['Read items from SAP']);
    expect(d.migration).toBe('1,000 items\nfrom Excel');
    expect('hacker' in d).toBe(false);
    expect(d.open_questions).toEqual([]);
  });

  it('features: objects with a title, priority defaulting to must; plain strings become features', () => {
    const d = normalizeDefinition({
      features: [
        { title: 'Record movement', detail: 'In / out with reason', priority: 'Should', acceptance: 'Balance updates at once' },
        { name: 'Monthly report', priority: 'urgent' },
        'F3: Import Excel',
        { detail: 'no title' },
      ],
    });
    expect(d.features).toEqual([
      { title: 'Record movement', detail: 'In / out with reason', priority: 'should', acceptance: 'Balance updates at once' },
      { title: 'Monthly report', detail: '', priority: 'must', acceptance: '' },
      { title: 'Import Excel', detail: '', priority: 'must', acceptance: '' },
    ]);
  });

  it('reads the earlier 9-section requirement summary into the new sections', () => {
    const d = normalizeDefinition({ objective: 'Centralise stock', users: 'About 5 stock staff', features: ['Record'], data_reports: ['Monthly report'] });
    expect(d.objectives).toEqual(['Centralise stock']);
    expect(d.roles).toEqual(['About 5 stock staff']);
    expect(d.reports).toEqual(['Monthly report']);
    expect(d.features[0].title).toBe('Record');
  });

  it('anything that is not an object becomes an empty definition; completeness counts filled sections', () => {
    expect(normalizeDefinition(null)).toEqual(emptyDefinition());
    expect(isEmptyDefinition(normalizeDefinition('nope'))).toBe(true);
    expect(completeness(normalizeDefinition({ background: 'x', features: ['a'] }))).toEqual({ filled: 2, total: DEFINITION_SECTIONS.length });
    expect(DEFINITION_SECTIONS.length).toBe(26);
  });

  it('every section has a label and a hint in the messages', () => {
    for (const s of DEFINITION_SECTIONS) {
      expect(en.section[s.key], s.key).toBeTruthy();
      expect(s.key in en.hint, s.key).toBe(true);
    }
  });

  it('renders groups and features (numbered, with priority and acceptance) for the prompt', () => {
    const text = definitionText(normalizeDefinition({ background: 'Excel today', features: [{ title: 'Record', priority: 'must', acceptance: 'Saved' }, 'Report'] }), en);
    expect(text).toBe([
      '## A. Overview', 'Background & problem:', '  Excel today',
      '## C. Functional', 'Features:', '  F1 [must] Record', '     Acceptance: Saved', '  F2 [must] Report',
    ].join('\n'));
  });
});

describe('parseSkillSuggestions', () => {
  const opts = { skillIds: new Set([1, 2, 3, 4]), required: new Set([4]), features: 3 };

  it('keeps known, not-yet-required skills once, clamps levels and drops refs to features that do not exist', () => {
    const out = parseSkillSuggestions({
      skills: [
        { skill_id: 2, required_level: 9, weight: 2, reason: 'API', refs: ['f2', 'F9', 'F2'] },
        { skill_id: 1, required_level: '4', weight: 5, is_mandatory: true, reason: 'UI', refs: ['F1'] },
        { skill_id: 1, required_level: 2 },
        { skill_id: 4, required_level: 3 },
        { skill_id: 99, required_level: 3 },
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
