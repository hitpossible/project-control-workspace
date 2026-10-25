import { describe, expect, it } from 'vitest';
import { type CandidateFacts, effectiveLevel, rankCandidates, recordedLevel, scoreCandidate, type SkillRequirement } from './skills';

const today = '2026-10-25';
const recent = '2026-09-01T00:00:00.000Z';
const old = '2025-01-01T00:00:00.000Z';
const opts = { today, hasProjectType: true };

const reqs: SkillRequirement[] = [
  { skill_id: 1, required_level: 4, weight: 5, is_mandatory: true },
  { skill_id: 2, required_level: 3, weight: 1, is_mandatory: false },
];

function person(id: number, levels: Record<number, number>, extra: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    user_id: id,
    skills: Object.entries(levels).map(([sid, lv]) => ({ skill_id: Number(sid), self_level: null, verified_level: lv, updated_at: recent, verified_at: recent })),
    workdays: 20, leaveDays: 0, activeProjects: 0, openItems: 0, doneTasks: 0, onTimeTasks: 0, sameTypeProjects: 0, ...extra,
  };
}

describe('levels', () => {
  it('a verified level wins over the self-assessment', () => {
    expect(recordedLevel({ skill_id: 1, self_level: 5, verified_level: 3, updated_at: recent, verified_at: recent }, today)).toEqual({ level: 3, verified: true, stale: false });
  });

  it('unverified and stale levels count for less', () => {
    const self = { skill_id: 1, self_level: 4, verified_level: null, updated_at: recent, verified_at: null };
    expect(effectiveLevel(self, today)).toBeCloseTo(3.6);
    expect(effectiveLevel({ ...self, updated_at: old }, today)).toBeCloseTo(3.06);
    expect(effectiveLevel(undefined, today)).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('full skill cover, free calendar, no history: skill 100, availability 100, track and domain neutral/zero', () => {
    const r = scoreCandidate(reqs, person(1, { 1: 5, 2: 3 }), opts);
    expect(r.parts).toEqual({ skill: 100, availability: 100, track: 50, domain: 0 });
    expect(r.score).toBe(Math.round(100 * (0.5 + 0.25 + 0.15 * 0.5)));
    expect(r.eligible).toBe(true);
    expect(r.fit.every((f) => f.met)).toBe(true);
  });

  it('skill cover is weighted by importance and capped at the required level', () => {
    // skill 1 at 2/4 (weight 5), skill 2 at 5/3 → capped to 1 (weight 1)
    const r = scoreCandidate(reqs, person(1, { 1: 2, 2: 5 }), opts);
    expect(r.parts.skill).toBe(Math.round(100 * (5 * 0.5 + 1) / 6));
    expect(r.eligible).toBe(false);
  });

  it('leave and current workload lower availability', () => {
    const r = scoreCandidate(reqs, person(1, { 1: 4 }, { leaveDays: 5, activeProjects: 2, openItems: 4 }), opts);
    // (1 - 5/20) × (1 - (0.5 + 0.2))
    expect(r.parts.availability).toBe(Math.round(100 * 0.75 * 0.3));
  });

  it('track record is smoothed toward 50% for people with little history', () => {
    expect(scoreCandidate(reqs, person(1, {}, { doneTasks: 1, onTimeTasks: 0 }), opts).parts.track).toBe(40);
    expect(scoreCandidate(reqs, person(1, {}, { doneTasks: 40, onTimeTasks: 40 }), opts).parts.track).toBe(95);
  });

  it('domain is skipped (weights renormalised) when the project has no type', () => {
    const r = scoreCandidate(reqs, person(1, { 1: 4, 2: 3 }), { today, hasProjectType: false });
    expect(r.parts.domain).toBeNull();
    expect(r.score).toBe(Math.round(100 * (0.5 + 0.25 + 0.075) / 0.9));
  });
});

describe('rankCandidates', () => {
  it('lists people who meet the mandatory skills first, then by score', () => {
    const ranked = rankCandidates(reqs, [
      person(1, { 1: 3, 2: 3 }, { sameTypeProjects: 3 }), // misses mandatory skill 1
      person(2, { 1: 4 }, { activeProjects: 3 }),          // meets it but busy
      person(3, { 1: 5, 2: 3 }),
    ], opts);
    expect(ranked.map((r) => r.user_id)).toEqual([3, 2, 1]);
    expect(ranked[2].eligible).toBe(false);
  });
});
