import { describe, expect, it } from 'vitest';
import { assertFrom, parseImpact } from './rpc/change-requests';

describe('parseImpact', () => {
  const today = '2026-11-01';
  it('keeps effort (1 decimal), target and a trimmed summary', () => {
    expect(parseImpact({ p_impact_md: '3.25', p_impact_target: '2026-12-15', p_impact_summary: '  new report  ' }, today))
      .toEqual({ impact_md: 3.3, impact_target: '2026-12-15', impact_summary: 'new report' });
  });
  it('allows no effort and no new target (target unchanged), and negative effort (scope removed)', () => {
    expect(parseImpact({ p_impact_summary: 'x' }, today)).toEqual({ impact_md: null, impact_target: null, impact_summary: 'x' });
    expect(parseImpact({ p_impact_md: -2, p_impact_summary: 'x' }, today).impact_md).toBe(-2);
  });
  it('needs a summary and sane values', () => {
    expect(() => parseImpact({ p_impact_md: 1 }, today)).toThrow(/Impact summary is required/);
    expect(() => parseImpact({ p_impact_md: 'lots', p_impact_summary: 'x' }, today)).toThrow(/man-days/);
    expect(() => parseImpact({ p_impact_target: '15/12/2026', p_impact_summary: 'x' }, today)).toThrow(/YYYY-MM-DD/);
    expect(() => parseImpact({ p_impact_target: '2026-10-31', p_impact_summary: 'x' }, today)).toThrow(/past/);
  });
});

describe('assertFrom', () => {
  it('lets a step run only from its statuses', () => {
    expect(() => assertFrom({ status: 'assessed', cr_no: 'CR-001' }, ['assessed'], 'agreed to')).not.toThrow();
    expect(() => assertFrom({ status: 'approved', cr_no: 'CR-001' }, ['submitted', 'assessed', 'agreed'], 'withdrawn'))
      .toThrow('CR-001 is approved — it cannot be withdrawn now');
  });
});
