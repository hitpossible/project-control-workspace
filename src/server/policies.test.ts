import { describe, expect, it } from 'vitest';
import { fakeCtx, profile, type World } from '../../test/fake-ctx';
import type { Row } from './db';
import { HOOKS } from './hooks';
import { canReadEvidence, POLICIES } from './policies';

const world: World = {
  projects: [{ id: 1, leader_id: 10, requestor_id: 20 }, { id: 2, leader_id: 99, requestor_id: 98 }],
  members: [{ project_id: 1, user_id: 10, member_role: 'leader' }, { project_id: 1, user_id: 11, member_role: 'developer' }],
  requests: [{ id: 100, requestor_id: 20 }],
  requestsVisibleTo: { 20: [100] },
};
const leader = profile(10, ['project_leader']);
const dev = profile(11, ['developer']);
const requestor = profile(20, ['requestor']);
const mgmt = profile(40, ['management_view']);
const admin = profile(50, ['admin']);

describe('every table policy', () => {
  it('has a read rule, and internal tables are filtered by internal membership', async () => {
    for (const [table, p] of Object.entries(POLICIES)) expect(typeof p.read, table).toBe('function');
    // the requestor has no internal membership → IN (NULL) matches nothing
    for (const table of ['internal_tasks', 'task_dependencies', 'test_rounds', 'bugs', 'bug_fixes', 'retests', 'comments', 'project_diagrams']) {
      expect(await POLICIES[table].read(fakeCtx(requestor, world)), table).toEqual(['project_id IN (NULL)', []]);
      expect(await POLICIES[table].read(fakeCtx(mgmt, world)), table).toEqual(['project_id IN (NULL)', []]);
    }
  });

  it('master data is read by all and written by admin only', async () => {
    for (const table of ['departments', 'positions', 'notification_rules', 'project_templates']) {
      const p = POLICIES[table];
      expect(await p.insert!(fakeCtx(leader), {}), table).toBe(false);
      expect(await p.update!(fakeCtx(admin), {}), table).toBe(true);
    }
  });
});

describe('profiles', () => {
  it('never returns or accepts the password hash, signature path or session version', () => {
    for (const col of ['password_hash', 'signature_path', 'session_version']) {
      expect(POLICIES.profiles.hidden).toContain(col);
      expect(POLICIES.profiles.readonly).toContain(col);
    }
  });

  it('users may edit only their own row (admin: any)', async () => {
    expect(await POLICIES.profiles.update!(fakeCtx(dev), { id: 11 })).toBe(true);
    expect(await POLICIES.profiles.update!(fakeCtx(dev), { id: 12 })).toBe(false);
    expect(await POLICIES.profiles.update!(fakeCtx(admin), { id: 12 })).toBe(true);
  });

  it('a user cannot give themselves roles, re-activate or move department (hook)', async () => {
    const before: Row = { id: 11, roles: ['developer'], is_active: true, department_id: 1, telephone: null };
    const hook = HOOKS.profiles.beforeUpdate!;
    await expect(async () => hook(fakeCtx(dev), { ...before, roles: ['developer', 'admin'] }, before)).rejects.toThrow(/Only administrators/);
    await expect(async () => hook(fakeCtx(dev), { ...before, department_id: 2 }, before)).rejects.toThrow(/Only administrators/);
    await expect(async () => hook(fakeCtx(dev), { ...before, telephone: '1234' }, before)).not.toThrow();
    await expect(async () => hook(fakeCtx(admin), { ...before, roles: ['admin'] }, before)).not.toThrow();
  });
});

describe('project_requests', () => {
  it('a new request is always the caller\'s own draft', async () => {
    const row: Row = {};
    expect(await POLICIES.project_requests.insert!(fakeCtx(requestor), row)).toBe(true);
    expect(row).toMatchObject({ requestor_id: 20, status: 'draft' });
    expect(await POLICIES.project_requests.insert!(fakeCtx(requestor), { requestor_id: 21 })).toBe(false);
    expect(await POLICIES.project_requests.insert!(fakeCtx(requestor), { status: 'approved' })).toBe(false);
  });

  it('only a draft or "need more information" request can be edited, by its requestor', async () => {
    const p = POLICIES.project_requests;
    expect(await p.update!(fakeCtx(requestor), { requestor_id: 20, status: 'draft' })).toBe(true);
    expect(await p.update!(fakeCtx(requestor), { requestor_id: 20, status: 'need_more_information' })).toBe(true);
    expect(await p.update!(fakeCtx(requestor), { requestor_id: 20, status: 'submitted' })).toBe(false);
    expect(await p.update!(fakeCtx(dev), { requestor_id: 20, status: 'draft' })).toBe(false);
    expect(await p.check!(fakeCtx(requestor), { requestor_id: 21 })).toBe(false);
  });

  it('only an unnumbered draft can be deleted', async () => {
    const p = POLICIES.project_requests;
    expect(await p.delete!(fakeCtx(requestor), { requestor_id: 20, status: 'draft', request_no: null })).toBe(true);
    expect(await p.delete!(fakeCtx(requestor), { requestor_id: 20, status: 'draft', request_no: 'REQ-SYS-2026-0001' })).toBe(false);
  });
});

describe('evidence', () => {
  it('staff read all; others get a filtered condition', async () => {
    expect(await POLICIES.evidence.read(fakeCtx(dev, world))).toEqual(['1=1', []]);
    const [sql] = (await POLICIES.evidence.read(fakeCtx(requestor, world))) as [string, unknown[]];
    expect(sql).toContain('is_internal = 0');
  });

  it('cannot be uploaded in someone else\'s name', async () => {
    expect(await POLICIES.evidence.insert!(fakeCtx(leader, world), { project_id: 1, uploaded_by: 11 })).toBe(false);
  });

  it('project evidence needs internal access; request evidence the requestor', async () => {
    expect(await POLICIES.evidence.insert!(fakeCtx(requestor, world), { project_id: 1 })).toBe(false);
    expect(await POLICIES.evidence.insert!(fakeCtx(dev, world), { project_id: 1 })).toBe(true);
    expect(await POLICIES.evidence.insert!(fakeCtx(requestor, world), { request_id: 100 })).toBe(true);
    expect(await POLICIES.evidence.insert!(fakeCtx(profile(30, ['requestor']), world), { request_id: 100 })).toBe(false);
  });

  it('internal evidence files are not downloadable by the requestor', async () => {
    expect(await canReadEvidence(fakeCtx(requestor, world), { project_id: 1, is_internal: true })).toBe(false);
    expect(await canReadEvidence(fakeCtx(requestor, world), { project_id: 1, is_internal: false })).toBe(true);
    expect(await canReadEvidence(fakeCtx(requestor, world), { project_id: 2, is_internal: false })).toBe(false);
    expect(await canReadEvidence(fakeCtx(requestor, world), { project_id: null, request_id: 100 })).toBe(true);
    expect(await canReadEvidence(fakeCtx(requestor, world), { project_id: null, request_id: 101 })).toBe(false);
  });
});

describe('own-only tables', () => {
  it('notifications belong to their user', async () => {
    expect(await POLICIES.notifications.read(fakeCtx(dev))).toEqual(['user_id = ?', [11]]);
    expect(await POLICIES.notifications.check!(fakeCtx(dev), { user_id: 12 })).toBe(false);
  });

  it('workforce plans: own, or a supervisor / manager', async () => {
    const p = POLICIES.workforce_plans;
    expect(await p.update!(fakeCtx(dev), { user_id: 11 })).toBe(true);
    expect(await p.update!(fakeCtx(dev), { user_id: 12 })).toBe(false);
    expect(await p.update!(fakeCtx(profile(91, ['supervisor'])), { user_id: 12 })).toBe(true);
    expect(await p.read(fakeCtx(requestor))).toEqual(['user_id = ?', [20]]);
  });

  it('comments are edited only by their author', async () => {
    expect(await POLICIES.comments.update!(fakeCtx(dev), { created_by: 11 })).toBe(true);
    expect(await POLICIES.comments.update!(fakeCtx(leader), { created_by: 11 })).toBe(false);
  });
});
