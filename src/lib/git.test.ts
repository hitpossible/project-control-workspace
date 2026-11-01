import { describe, expect, it } from 'vitest';
import { branchName, gitLinkInfo, parseWorkRefs, workRef } from './git';

describe('refs and branch names', () => {
  it('builds refs and branch names', () => {
    expect(workRef('task', 123)).toBe('T123');
    expect(workRef('bug', 45)).toBe('B45');
    expect(branchName('task', 123, 'Shift summary API')).toBe('feat/T123-shift-summary-api');
    expect(branchName('bug', 45, 'Total wrong when downtime crosses midnight (night shift) — urgent!'))
      .toBe('fix/B45-total-wrong-when-downtime-crosses');
    expect(branchName('task', 7, 'ออกแบบหน้าจอ')).toBe('feat/T7');
  });
});

describe('parseWorkRefs', () => {
  it('finds refs in branches, commits and PR titles', () => {
    expect(parseWorkRefs('feat/T123-shift-summary-api')).toEqual([{ type: 'task', id: 123 }]);
    expect(parseWorkRefs('[B45] Fix shift total; also T9: tidy')).toEqual([{ type: 'bug', id: 45 }, { type: 'task', id: 9 }]);
    expect(parseWorkRefs('T123: one\nT123: again')).toEqual([{ type: 'task', id: 123 }]);
  });
  it('ignores look-alikes', () => {
    expect(parseWorkRefs('B2B portal, ST100 sensor, HTTP2, BT5')).toEqual([]);
  });
});

describe('gitLinkInfo', () => {
  it('reads GitHub URLs', () => {
    expect(gitLinkInfo('https://github.com/tbkk/tool-crib/pull/12')).toEqual({ provider: 'github', kind: 'pull_request' });
    expect(gitLinkInfo('https://github.com/tbkk/tool-crib/commit/9f3c2ab')).toEqual({ provider: 'github', kind: 'commit' });
    expect(gitLinkInfo('https://github.com/tbkk/tool-crib/tree/feat/T123-x')).toEqual({ provider: 'github', kind: 'branch' });
  });
  it('reads company GitLab URLs on any host', () => {
    expect(gitLinkInfo('https://git.tbkk.local/sys/tool-crib/-/merge_requests/8')).toEqual({ provider: 'gitlab', kind: 'pull_request' });
    expect(gitLinkInfo('https://gitlab.tbkk.co.th/sys/tool-crib/-/commit/9f3c2ab1')).toEqual({ provider: 'gitlab', kind: 'commit' });
    expect(gitLinkInfo('https://gitlab.tbkk.co.th/sys/tool-crib/-/tree/fix/B45')).toEqual({ provider: 'gitlab', kind: 'branch' });
  });
  it('accepts other web links and rejects non-URLs', () => {
    expect(gitLinkInfo('https://jenkins.tbkk.local/job/12')).toEqual({ provider: 'other', kind: 'other' });
    expect(gitLinkInfo('javascript:alert(1)')).toBeNull();
    expect(gitLinkInfo('not a url')).toBeNull();
  });
});
