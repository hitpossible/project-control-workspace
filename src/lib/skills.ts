/**
 * Skill matrix scoring — who fits a project best. Pure functions (no I/O) so the same rules can be
 * unit-tested and shown in the UI; the facts are gathered by rpc recommend_members (src/server/rpc/skills.ts).
 *
 * score (0–100) = weighted mean of the parts that apply:
 *   skill         50%  how far each required skill is covered, weighted by its importance
 *   availability  25%  leave in the project window and the work already on the person's plate
 *   track record  15%  internal tasks finished on time in the last 12 months
 *   domain        10%  past projects of the same project type (skipped when the project has no type)
 */

export const SKILL_LEVELS = [1, 2, 3, 4, 5] as const;

export const SCORE_WEIGHTS = { skill: 0.5, availability: 0.25, track: 0.15, domain: 0.1 } as const;

/** a level nobody has re-confirmed for this long counts for less */
export const STALE_AFTER_DAYS = 365;
export const STALE_FACTOR = 0.85;
/** a self-assessed level that no Supervisor / Manager has verified counts for a little less */
export const SELF_FACTOR = 0.9;
/** each other active project takes this share of a person's capacity, each open task / bug due in the window this share */
export const PROJECT_LOAD = 0.25;
export const TASK_LOAD = 0.05;
/** track record starts from 50% as if this many tasks had been done, so one late task does not sink a newcomer */
export const TRACK_PRIOR = 4;
/** this many past projects of the same type = full domain score */
export const DOMAIN_FULL = 3;

export type SkillRequirement = { skill_id: number; required_level: number; weight: number; is_mandatory: boolean };

export type HeldSkill = {
  skill_id: number;
  self_level: number | null;
  verified_level: number | null;
  updated_at: string | null;
  verified_at: string | null;
};

export type CandidateFacts = {
  user_id: number;
  skills: HeldSkill[];
  /** working days in the project window */
  workdays: number;
  /** of those, days on leave (workforce plan) */
  leaveDays: number;
  /** other projects in progress where the person is a member */
  activeProjects: number;
  /** open internal tasks and bugs assigned to the person, due inside the window */
  openItems: number;
  /** internal tasks completed in the last 12 months, and how many of them by the due date */
  doneTasks: number;
  onTimeTasks: number;
  /** past projects (any status) of the same project type the person was a member of */
  sameTypeProjects: number;
};

export type SkillFit = {
  skill_id: number;
  required: number;
  /** level as recorded (verified, else self); 0 = not in the matrix */
  level: number;
  verified: boolean;
  stale: boolean;
  met: boolean;
};

export type Recommendation = {
  user_id: number;
  score: number;
  /** false = below the required level on a mandatory skill */
  eligible: boolean;
  /** 0–100 per part; null = not applicable */
  parts: { skill: number; availability: number; track: number; domain: number | null };
  fit: SkillFit[];
  /** availability inputs, for the explanation */
  load: { leaveDays: number; workdays: number; activeProjects: number; openItems: number; doneTasks: number; onTimeTasks: number; sameTypeProjects: number };
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => Math.round(clamp01(v) * 100);

/** recorded level (verified wins), whether it is verified, and whether it is stale on `today` */
export function recordedLevel(s: HeldSkill | undefined, today: string): { level: number; verified: boolean; stale: boolean } {
  if (!s) return { level: 0, verified: false, stale: false };
  const verified = s.verified_level != null;
  const level = (verified ? s.verified_level : s.self_level) ?? 0;
  const stamp = (verified ? s.verified_at : s.updated_at) ?? s.updated_at;
  const age = stamp ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(stamp)) / 86400000 : 0;
  return { level, verified, stale: age > STALE_AFTER_DAYS };
}

/** the level the score uses: recorded level less the self-assessment and staleness discounts */
export function effectiveLevel(s: HeldSkill | undefined, today: string): number {
  const r = recordedLevel(s, today);
  return r.level * (r.verified ? 1 : SELF_FACTOR) * (r.stale ? STALE_FACTOR : 1);
}

export function scoreCandidate(reqs: SkillRequirement[], f: CandidateFacts, opts: { today: string; hasProjectType: boolean }): Recommendation {
  const held = new Map(f.skills.map((s) => [s.skill_id, s]));
  const fit: SkillFit[] = reqs.map((r) => {
    const s = held.get(r.skill_id);
    const rec = recordedLevel(s, opts.today);
    return { skill_id: r.skill_id, required: r.required_level, level: rec.level, verified: rec.verified, stale: rec.stale, met: rec.level >= r.required_level };
  });

  const totalWeight = reqs.reduce((a, r) => a + r.weight, 0);
  const skill = totalWeight > 0
    ? reqs.reduce((a, r) => a + r.weight * Math.min(1, effectiveLevel(held.get(r.skill_id), opts.today) / r.required_level), 0) / totalWeight
    : 0;

  const leaveShare = f.workdays > 0 ? clamp01(f.leaveDays / f.workdays) : 0;
  const busy = clamp01(f.activeProjects * PROJECT_LOAD + f.openItems * TASK_LOAD);
  const availability = (1 - leaveShare) * (1 - busy);

  const track = (f.onTimeTasks + TRACK_PRIOR * 0.5) / (f.doneTasks + TRACK_PRIOR);
  const domain = opts.hasProjectType ? clamp01(f.sameTypeProjects / DOMAIN_FULL) : null;

  const parts: [number, number | null][] = [
    [SCORE_WEIGHTS.skill, skill], [SCORE_WEIGHTS.availability, availability], [SCORE_WEIGHTS.track, track], [SCORE_WEIGHTS.domain, domain],
  ];
  const used = parts.filter(([, v]) => v !== null) as [number, number][];
  const score = used.reduce((a, [w, v]) => a + w * v, 0) / used.reduce((a, [w]) => a + w, 0);

  return {
    user_id: f.user_id,
    score: pct(score),
    eligible: reqs.every((r, i) => !r.is_mandatory || fit[i].met),
    parts: { skill: pct(skill), availability: pct(availability), track: pct(track), domain: domain === null ? null : pct(domain) },
    fit,
    load: {
      leaveDays: f.leaveDays, workdays: f.workdays, activeProjects: f.activeProjects, openItems: f.openItems,
      doneTasks: f.doneTasks, onTimeTasks: f.onTimeTasks, sameTypeProjects: f.sameTypeProjects,
    },
  };
}

/** best first: everyone who meets the mandatory skills, then the rest; ties by skill part */
export function rankCandidates(reqs: SkillRequirement[], all: CandidateFacts[], opts: { today: string; hasProjectType: boolean }): Recommendation[] {
  return all
    .map((f) => scoreCandidate(reqs, f, opts))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || b.parts.skill - a.parts.skill || a.user_id - b.user_id);
}

/** result of rpc recommend_members */
export type MemberRecommendations = {
  /** the project period availability is measured over (from today at the earliest) */
  window: { from: string; to: string; workdays: number };
  hasProjectType: boolean;
  requirements: number;
  candidates: (Recommendation & { is_member: boolean })[];
};
