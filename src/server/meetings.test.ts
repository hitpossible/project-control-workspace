import { describe, expect, it } from 'vitest';
import { fakeCtx, profile } from '../../test/fake-ctx';
import { assertDeletable, assertFresh, canWriteMeetings } from './rpc/meetings';

const world = {
  projects: [{ id: 1, leader_id: 2 }, { id: 2, leader_id: 9, requestor_id: 5 }],
  members: [
    { project_id: 1, user_id: 3, member_role: 'developer' }, { project_id: 1, user_id: 4, member_role: 'requestor_rep' },
    { project_id: 1, user_id: 6, member_role: 'leader' },
  ],
};
const can = (uid: number, roles: Parameters<typeof profile>[1], project = 1) => canWriteMeetings(fakeCtx(profile(uid, roles), world), project);

describe('who can write meetings', () => {
  it('lets the leader, a leader member, the team and an admin', async () => {
    expect(await can(2, ['project_leader'])).toBe(true); // projects.leader_id
    expect(await can(6, ['project_leader'])).toBe(true); // member role "leader"
    expect(await can(3, ['developer'])).toBe(true);
    expect(await can(7, ['admin'])).toBe(true);
  });
  it('keeps the requestor side, other projects\' teams and strangers out', async () => {
    expect(await can(4, ['requestor'])).toBe(false); // requestor representative
    expect(await can(5, ['requestor'], 2)).toBe(false); // requestor of project 2
    expect(await can(3, ['developer'], 2)).toBe(false); // team of project 1 only
    expect(await can(8, ['requestor'])).toBe(false);
  });
});

describe('assertFresh', () => {
  it('accepts the version the editor opened, or no version', () => {
    expect(() => assertFresh({ updated_at: '2026-11-01T10:00:00.000Z' }, '2026-11-01T10:00:00.000Z')).not.toThrow();
    expect(() => assertFresh({ updated_at: '2026-11-01T10:00:00.000Z' }, undefined)).not.toThrow();
  });
  it('refuses a stale one', () => {
    expect(() => assertFresh({ updated_at: '2026-11-01T10:05:00.000Z' }, '2026-11-01T10:00:00.000Z')).toThrow(/Someone else/);
  });
});

describe('assertDeletable', () => {
  const planned = { status: 'planned' as const, mom_recorded_at: null, mom_actions: [] };
  it('allows a meeting without minutes', () => {
    expect(() => assertDeletable(planned)).not.toThrow();
    expect(() => assertDeletable({ ...planned, status: 'cancelled' })).not.toThrow();
  });
  it('keeps a meeting with minutes, or with tasks made from it', () => {
    expect(() => assertDeletable({ ...planned, status: 'held', mom_recorded_at: '2026-11-01T10:00:00.000Z' })).toThrow(/minutes/);
    expect(() => assertDeletable({ ...planned, mom_actions: [{ text: 'x', owner_id: null, owner_name: null, due_date: null, task_id: 5 }] })).toThrow(/Tasks were created/);
  });
});
