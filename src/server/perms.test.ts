import { describe, expect, it } from 'vitest';
import { fakeCtx, profile, type World } from '../../test/fake-ctx';
import {
  canApproveBaseline, canManageProject, canQa, canViewInternal, canViewProject, canViewRequest, hasRole, idFilter,
  internalProjectIds, isAdmin, isStaff, visibleProjectIds,
} from './perms';

// project 1: leader 10, developer 11, QA 12, requestor 20 (with a requestor rep 21); project 2: someone else's
const world: World = {
  projects: [{ id: 1, leader_id: 10, requestor_id: 20 }, { id: 2, leader_id: 99, requestor_id: 98 }],
  members: [
    { project_id: 1, user_id: 10, member_role: 'leader' },
    { project_id: 1, user_id: 11, member_role: 'developer' },
    { project_id: 1, user_id: 12, member_role: 'qa' },
    { project_id: 1, user_id: 21, member_role: 'requestor_rep' },
  ],
  requestsVisibleTo: { 20: [100] },
};

const leader = profile(10, ['project_leader']);
const dev = profile(11, ['developer']);
const requestor = profile(20, ['requestor']);
const rep = profile(21, ['requestor']);
const outsider = profile(30, ['requestor']);
const mgmt = profile(40, ['management_view']);
const admin = profile(50, ['admin']);

describe('roles', () => {
  it('a deactivated user has no roles at all', () => {
    const ctx = fakeCtx(profile(60, ['admin', 'developer'], { is_active: false }), world);
    expect(isAdmin(ctx)).toBe(false);
    expect(isStaff(ctx)).toBe(false);
    expect(hasRole(ctx, 'developer')).toBe(false);
  });

  it('admin holds every role; a system job (no user) has full access', () => {
    expect(hasRole(fakeCtx(admin), 'qa')).toBe(true);
    const sys = fakeCtx(null);
    expect(isAdmin(sys)).toBe(true);
    expect(isStaff(sys)).toBe(true);
  });

  it('requestor and management view are not System Service staff', () => {
    expect(isStaff(fakeCtx(requestor))).toBe(false);
    expect(isStaff(fakeCtx(mgmt))).toBe(false);
    expect(isStaff(fakeCtx(dev))).toBe(true);
  });
});

describe('project visibility', () => {
  it('the requestor sees their own project but not others', async () => {
    const ctx = fakeCtx(requestor, world);
    expect(await canViewProject(ctx, 1)).toBe(true);
    expect(await canViewProject(ctx, 2)).toBe(false);
    expect(await visibleProjectIds(ctx)).toEqual([1]);
  });

  it('an unrelated requestor sees no project', async () => {
    const ctx = fakeCtx(outsider, world);
    expect(await canViewProject(ctx, 1)).toBe(false);
    expect(await visibleProjectIds(ctx)).toEqual([]);
  });

  it('staff and management view see every project (null = unrestricted)', async () => {
    expect(await visibleProjectIds(fakeCtx(dev, world))).toBeNull();
    expect(await visibleProjectIds(fakeCtx(mgmt, world))).toBeNull();
    expect(await canViewProject(fakeCtx(mgmt, world), 2)).toBe(true);
  });
});

describe('internal detail (AC 008 / 024: User View hides internal work)', () => {
  it('requestor, requestor rep and management view never see internal detail', async () => {
    for (const who of [requestor, rep, mgmt, outsider]) {
      const ctx = fakeCtx(who, world);
      expect(await canViewInternal(ctx, 1), `user ${who.id}`).toBe(false);
      expect(await internalProjectIds(ctx), `user ${who.id}`).toEqual([]);
    }
  });

  it('the requestor rep is a member, so sees the project itself', async () => {
    expect(await canViewProject(fakeCtx(rep, world), 1)).toBe(true);
  });

  it('staff see internal detail of every project', async () => {
    expect(await canViewInternal(fakeCtx(dev, world), 2)).toBe(true);
    expect(await internalProjectIds(fakeCtx(dev, world))).toBeNull();
  });

  it('a non-staff user who is an internal member sees internal detail of that project only', async () => {
    const helper = profile(70, ['requestor']);
    const ctx = fakeCtx(helper, { ...world, members: [...world.members!, { project_id: 2, user_id: 70, member_role: 'support' }] });
    expect(await canViewInternal(ctx, 2)).toBe(true);
    expect(await canViewInternal(ctx, 1)).toBe(false);
    expect(await internalProjectIds(ctx)).toEqual([2]);
  });
});

describe('project management', () => {
  it('only the leader (or admin) manages the project', async () => {
    expect(await canManageProject(fakeCtx(leader, world), 1)).toBe(true);
    expect(await canManageProject(fakeCtx(leader, world), 2)).toBe(false);
    expect(await canManageProject(fakeCtx(dev, world), 1)).toBe(false);
    expect(await canManageProject(fakeCtx(requestor, world), 1)).toBe(false);
    expect(await canManageProject(fakeCtx(admin, world), 2)).toBe(true);
  });

  it('a member with the leader role manages it even when not projects.leader_id', async () => {
    const ctx = fakeCtx(profile(80, ['developer']), { ...world, members: [{ project_id: 2, user_id: 80, member_role: 'leader' }] });
    expect(await canManageProject(ctx, 2)).toBe(true);
  });

  it('QA work: QA role, the leader or a QA member', async () => {
    expect(await canQa(fakeCtx(profile(90, ['qa']), world), 2)).toBe(true);
    expect(await canQa(fakeCtx(leader, world), 1)).toBe(true);
    expect(await canQa(fakeCtx(profile(12, ['developer']), world), 1)).toBe(true);
    expect(await canQa(fakeCtx(dev, world), 1)).toBe(false);
  });

  it('baseline revisions are approved by a manager or supervisor, not the leader', async () => {
    expect(await canApproveBaseline(fakeCtx(leader, world), 1)).toBe(false);
    expect(await canApproveBaseline(fakeCtx(profile(91, ['supervisor']), world), 1)).toBe(true);
  });
});

describe('requests', () => {
  it('staff see every request; others only the ones they are part of', async () => {
    expect(await canViewRequest(fakeCtx(dev, world), 555)).toBe(true);
    expect(await canViewRequest(fakeCtx(requestor, world), 100)).toBe(true);
    expect(await canViewRequest(fakeCtx(requestor, world), 101)).toBe(false);
  });
});

describe('idFilter', () => {
  it('builds an IN list, and an empty list matches nothing', () => {
    expect(idFilter('project_id', null)).toEqual(['1=1', []]);
    expect(idFilter('project_id', [3, 4])).toEqual(['project_id IN (?,?)', [3, 4]]);
    expect(idFilter('project_id', [])).toEqual(['project_id IN (NULL)', []]);
  });
});
