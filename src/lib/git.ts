/**
 * Linking work to git (GitHub today, company GitLab later — nothing here is host-specific beyond URL shapes).
 *
 * Convention: every task / bug has a ref that is unique across projects — T{id} / B{id} (database ids; task_no / bug_no
 * repeat per project). Put it in branch names, commit messages and PR / MR titles:
 *   branch  feat/T123-shift-summary-api · fix/B45-downtime-midnight
 *   commit  T123: aggregate downtime across midnight
 *   PR / MR [B45] Fix shift total when downtime crosses midnight
 */
export type WorkType = 'task' | 'bug';
export type LinkKind = 'branch' | 'commit' | 'pull_request' | 'other';
export type GitProvider = 'github' | 'gitlab' | 'other';

export const workRef = (type: WorkType, id: number) => `${type === 'task' ? 'T' : 'B'}${id}`;

/** ASCII slug of a task name for a branch (Thai and other scripts drop out; the ref alone is enough then) */
export function slug(text: string, max = 40): string {
  const s = text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length <= max ? s : s.slice(0, max).replace(/-[^-]*$/, '') || s.slice(0, max);
}

export function branchName(type: WorkType, id: number, name: string): string {
  const s = slug(name);
  return `${type === 'task' ? 'feat' : 'fix'}/${workRef(type, id)}${s ? `-${s}` : ''}`;
}

/** Task / bug refs mentioned in a branch name, commit message or PR title — for syncing from git later */
export function parseWorkRefs(text: string): { type: WorkType; id: number }[] {
  const out = new Map<string, { type: WorkType; id: number }>();
  for (const m of text.matchAll(/(?:^|[\s/[(_:-])([TB])(\d{1,9})(?=$|[\s\]):,._-])/g)) {
    const type: WorkType = m[1] === 'T' ? 'task' : 'bug';
    out.set(`${m[1]}${m[2]}`, { type, id: Number(m[2]) });
  }
  return [...out.values()];
}

/** What a git URL points at. GitLab is recognised by its "/-/" paths, so a self-hosted host needs no setting. */
export function gitLinkInfo(raw: string): { provider: GitProvider; kind: LinkKind } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const p = u.pathname;
  if (/\/-\/(merge_requests|commit|tree|compare)\b/.test(p) || /(^|\.)gitlab\./.test(u.hostname)) {
    return {
      provider: 'gitlab',
      kind: /\/-\/merge_requests\/\d+/.test(p) ? 'pull_request' : /\/-\/commit\/[0-9a-f]{7,40}/i.test(p) ? 'commit' : /\/-\/tree\//.test(p) ? 'branch' : 'other',
    };
  }
  if (u.hostname === 'github.com' || u.hostname.endsWith('.github.com')) {
    return {
      provider: 'github',
      kind: /\/pull\/\d+/.test(p) ? 'pull_request' : /\/commit\/[0-9a-f]{7,40}/i.test(p) ? 'commit' : /\/tree\//.test(p) ? 'branch' : 'other',
    };
  }
  return { provider: 'other', kind: 'other' };
}
