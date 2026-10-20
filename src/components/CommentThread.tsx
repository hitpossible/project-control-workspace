'use client';

import dayjs from 'dayjs';
import { Pencil, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SYSTEM_STAFF_ROLES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDateTime } from '@/lib/format';
import type { Comment, Profile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { EmptyState, Person, Tip } from './common';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

const MENTION_AT_CARET = /(^|\s)@([^\s@]{0,30})$/;

/** Comment thread with @mention for an internal Task or Bug */
export default function CommentThread({ projectId, entityType, entityId, canModerate, onCount }: {
  projectId: number; entityType: 'task' | 'bug'; entityId: number;
  /** Project Leader / Admin may delete any comment */
  canModerate?: boolean;
  onCount?: (n: number) => void;
}) {
  const db = dbClient();
  const { me, profiles, profileName, notify } = useApp();
  const [items, setItems] = useState<Comment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // System Service staff can open internal tasks / bugs (the server re-checks every mention)
  const candidates = useMemo(() => profiles.filter((p) => p.is_active && p.id !== me?.id
    && p.roles.some((r) => SYSTEM_STAFF_ROLES.includes(r))), [profiles, me?.id]);

  const load = useCallback(async () => {
    const { data } = await db.from('comments').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at');
    const list = (data ?? []) as Comment[];
    setItems(list);
    setLoaded(true);
    onCount?.(list.length);
  }, [db, entityType, entityId, onCount]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const post = async (body: string, mentions: number[]) => {
    setSaving(true);
    const { error } = await db.from('comments').insert({ project_id: projectId, entity_type: entityType, entity_id: entityId, body, mentions });
    setSaving(false);
    if (error) {
      notify(errMsg(error), 'error');
      return false;
    }
    await load();
    return true;
  };

  const update = async (c: Comment, body: string, mentions: number[]) => {
    setSaving(true);
    const { error } = await db.from('comments').update({ body, mentions }).eq('id', c.id);
    setSaving(false);
    if (error) {
      notify(errMsg(error), 'error');
      return false;
    }
    setEditing(null);
    await load();
    return true;
  };

  const remove = async (c: Comment) => {
    if (!confirm('Delete this comment?')) return;
    const { error } = await db.from('comments').delete().eq('id', c.id);
    if (error) return notify(errMsg(error), 'error');
    await load();
  };

  return (
    <div className="space-y-3">
      {loaded && items.length === 0 && <EmptyState text="No comments yet — start the discussion. Type @ to mention someone." />}
      <ul className="space-y-3">
        {items.map((c) => {
          const mine = c.created_by === me?.id;
          return (
            <li key={c.id} className="flex gap-2.5">
              <Person name={profileName(c.created_by)} showName={false} size={30} />
              <div className="min-w-0 flex-1 rounded-lg bg-muted/60 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="text-sm font-semibold">{profileName(c.created_by)}</span>
                  <Tip title={fmtDateTime(c.created_at)}><span className="text-muted-foreground">{dayjs(c.created_at).format('DD MMM HH:mm')}</span></Tip>
                  {c.edited_at && <Tip title={`Edited ${fmtDateTime(c.edited_at)}`}><span className="text-muted-foreground">(edited)</span></Tip>}
                  {!editing && (mine || canModerate) && (
                    <span className="ml-auto flex gap-0.5">
                      {mine && <Button variant="ghost" size="icon-sm" aria-label="Edit comment" onClick={() => setEditing(c.id)}><Pencil /></Button>}
                      <Button variant="ghost" size="icon-sm" aria-label="Delete comment" onClick={() => remove(c)}><Trash2 /></Button>
                    </span>
                  )}
                </div>
                {editing === c.id ? (
                  <Composer key={c.id} candidates={candidates} initial={c} saving={saving} submitLabel="Save"
                    onCancel={() => setEditing(null)} onSubmit={(b, m) => update(c, b, m)} />
                ) : (
                  <MentionText body={c.body} names={c.mentions.map((id) => profileName(id))} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!editing && <Composer candidates={candidates} saving={saving} submitLabel="Comment" onSubmit={post} />}
    </div>
  );
}

/** body with "@Full Name" of mentioned people highlighted */
function MentionText({ body, names }: { body: string; names: string[] }) {
  const tokens = names.filter((n) => n && n !== '—').sort((a, b) => b.length - a.length).map((n) => `@${n}`);
  const parts: React.ReactNode[] = [];
  let rest = body;
  let key = 0;
  while (rest) {
    const hits = tokens.map((t) => ({ t, i: rest.indexOf(t) })).filter((h) => h.i >= 0).sort((a, b) => a.i - b.i);
    if (!hits.length) {
      parts.push(rest);
      break;
    }
    const { t, i } = hits[0];
    if (i > 0) parts.push(rest.slice(0, i));
    parts.push(<span key={key++} className="rounded bg-selected px-0.5 font-medium text-primary">{t}</span>);
    rest = rest.slice(i + t.length);
  }
  return <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{parts}</p>;
}

function Composer({ candidates, initial, saving, submitLabel, onSubmit, onCancel }: {
  candidates: Profile[]; initial?: Comment; saving: boolean; submitLabel: string;
  onSubmit: (body: string, mentions: number[]) => Promise<boolean>; onCancel?: () => void;
}) {
  const [text, setText] = useState(initial?.body ?? '');
  const [picked, setPicked] = useState<Profile[]>(() => candidates.filter((p) => initial?.mentions.includes(p.id)));
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = query === null ? [] : candidates
    .filter((p) => p.full_name.toLowerCase().includes(query.toLowerCase()) || (p.username ?? '').toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  const detect = (value: string, caret: number) => {
    const m = MENTION_AT_CARET.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  };

  const choose = (p: Profile) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.full_name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || saving) return;
    // keep only people whose @Name is still in the text
    const mentions = picked.filter((p) => body.includes(`@${p.full_name}`)).map((p) => p.id);
    if (await onSubmit(body, mentions)) {
      setText('');
      setPicked([]);
    }
  };

  return (
    <div className="relative mt-1">
      <Textarea
        ref={ref}
        value={text}
        rows={2}
        placeholder="Write a comment… type @ to mention (Ctrl + Enter to send)"
        className="bg-white"
        aria-label="Comment"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        onChange={(e) => {
          setText(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => detect(text, e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              choose(matches[active]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setQuery(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {matches.length > 0 && (
        <ul role="listbox" className="absolute top-full left-0 z-50 mt-1 w-72 overflow-hidden rounded-md border bg-popover py-1 shadow-lg">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setActive(i)}
                className={cn('flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm', i === active && 'bg-selected')}>
                <Person name={p.full_name} showName={false} size={22} />
                <span className="truncate">{p.full_name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{p.department}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex justify-end gap-2">
        {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button size="sm" disabled={!text.trim() || saving} onClick={submit}>
          {submitLabel === 'Save' ? null : <Send />} {saving ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
