'use client';

import { Check, Copy, GitBranch, GitCommitHorizontal, GitPullRequest, Link2, Plus, Trash2, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { TextField } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDateTime } from '@/lib/format';
import { branchName, workRef, type LinkKind, type WorkType } from '@/lib/git';

type Link = { id: number; kind: LinkKind; provider: 'github' | 'gitlab' | 'other'; url: string; title: string | null; created_by: number; created_at: string };

const KIND_ICON: Record<LinkKind, LucideIcon> = { branch: GitBranch, commit: GitCommitHorizontal, pull_request: GitPullRequest, other: Link2 };

function CopyCode({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-1">
        <code className="min-w-0 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{text}</code>
        <Button size="icon-sm" variant="ghost" aria-label={label} onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          {done ? <Check className="text-[#00c875]" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

/** Git tab of a task / bug: its ref and branch name to use, and the branch / commit / PR links (GitHub or GitLab) */
export default function WorkLinks({ type, id, name, canAdd, canManage }: { type: WorkType; id: number; name: string; canAdd: boolean; canManage: boolean }) {
  const t = useTranslations('plan.git');
  const db = dbClient();
  const { me, notify, profileName } = useApp();
  const [links, setLinks] = useState<Link[]>([]);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = workRef(type, id);

  const load = useCallback(async () => {
    const { data } = await db.from('work_links').select('*').eq('entity_type', type).eq('entity_id', id).order('created_at');
    setLinks((data ?? []) as Link[]);
  }, [db, type, id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      const { error } = await db.from('work_links').insert({ entity_type: type, entity_id: id, url: url.trim(), title: title.trim() || null });
      if (error) return notify(errMsg(error), 'error');
      setUrl('');
      setTitle('');
      notify(t('added'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (l: Link) => {
    if (!(await confirmDialog({ title: t('removeTitle'), description: l.title ?? l.url, confirmText: t('remove'), destructive: true }))) return;
    const { error } = await db.from('work_links').delete().eq('id', l.id);
    if (error) return notify(errMsg(error), 'error');
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-3">
        <CopyCode label={t('ref')} text={ref} />
        <CopyCode label={t('branch')} text={branchName(type, id, name)} />
        <CopyCode label={t('commit')} text={`${ref}: `} />
        <p className="text-xs text-muted-foreground sm:col-span-3">{t('convention', { ref })}</p>
      </div>

      {links.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : (
        <ul className="divide-y rounded-md border">
          {links.map((l) => {
            const Icon = KIND_ICON[l.kind] ?? Link2;
            return (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium text-primary hover:underline">{l.title || l.url}</a>
                  <div className="truncate text-xs text-muted-foreground">
                    {t(`kind.${l.kind}`)}{l.provider !== 'other' && ` · ${l.provider === 'github' ? 'GitHub' : 'GitLab'}`} · {profileName(l.created_by)} · {fmtDateTime(l.created_at)}
                  </div>
                </div>
                {(l.created_by === me?.id || canManage) && (
                  <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={t('remove')} onClick={() => remove(l)}><Trash2 /></Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAdd && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextField className="flex-1" label={t('url')} value={url} onChange={setUrl} placeholder="https://github.com/… / https://gitlab…/-/merge_requests/…" />
          <TextField className="sm:w-56" label={t('title')} value={title} onChange={setTitle} />
          <Button disabled={busy || !/^https?:\/\//.test(url.trim())} onClick={add}><Plus /> {t('add')}</Button>
        </div>
      )}
    </div>
  );
}
