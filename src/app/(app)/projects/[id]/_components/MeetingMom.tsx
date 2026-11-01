'use client';

import { ListChecks, Mail, Plus, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { DateField, SelectField, TextField, UserSelect } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDateTime } from '@/lib/format';
import type { ActionItem, DiscussionPoint, InfoItem, MomInput, ProjectMeeting } from '@/lib/meetings';
import { meetingAi } from './MeetingInvite';
import { rpc } from './ClosureSignoff';
import type { TabProps } from './types';

const input = 'h-8 rounded border border-grid bg-white px-2 text-sm';

/** A list of editable rows with add / remove */
function Rows<T>({ title, hint, items, onChange, blank, addLabel, render }: {
  title: string; hint?: string; items: T[]; onChange: (v: T[]) => void; blank: T; addLabel: string; render: (item: T, set: (v: T) => void) => React.ReactNode;
}) {
  const tm = useTranslations('project.meetings');
  return (
    <div>
      <div className="mb-1 text-sm font-semibold">{title}</div>
      {hint && <p className="mb-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex flex-1 flex-wrap items-center gap-2">{render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}</div>
            <Button variant="ghost" size="icon-sm" aria-label={tm('removeRow')} onClick={() => onChange(items.filter((_, j) => j !== i))}><X /></Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="mt-1.5" onClick={() => onChange([...items, blank])}><Plus /> {addLabel}</Button>
    </div>
  );
}

/** Step 3: the minutes. Rough notes can be turned into a structured MOM by the AI — shown as a suggestion first. */
export default function MeetingMom({ data, perm, reload, memberProfiles, meeting, onSendMom }: TabProps & { meeting: ProjectMeeting; onSendMom: () => void }) {
  const t = useTranslations('project.meetings.mom');
  const { notify } = useApp();
  const lang = useLocale() === 'en' ? 'en' : 'th';
  const [attendees, setAttendees] = useState(meeting.attendees);
  const [summary, setSummary] = useState(meeting.mom_summary ?? '');
  const [discussion, setDiscussion] = useState<DiscussionPoint[]>(meeting.mom_discussion.length ? meeting.mom_discussion : meeting.agenda.map((a) => ({ topic: a.title, notes: '' })));
  const [decisions, setDecisions] = useState<string[]>(meeting.mom_decisions);
  const [actions, setActions] = useState<ActionItem[]>(meeting.mom_actions);
  const [questions, setQuestions] = useState<string[]>(meeting.mom_questions);
  const [info, setInfo] = useState<InfoItem[]>(meeting.mom_info);
  const [notes, setNotes] = useState('');
  const [suggestion, setSuggestion] = useState<MomInput | null>(null);
  const [busy, setBusy] = useState<'ai' | 'save' | null>(null);
  const [converting, setConverting] = useState(false);
  const locked = meeting.status === 'cancelled';

  const structure = async () => {
    setBusy('ai');
    try {
      const r = await meetingAi(data.project.id, { kind: 'mom', meeting_id: meeting.id, notes, lang });
      if (r.error) throw new Error(r.error.message);
      const d = r.data as (MomInput & { off?: boolean }) | undefined;
      if (d?.off) return notify(t('aiOff'), 'error');
      setSuggestion(d as MomInput);
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const apply = () => {
    if (!suggestion) return;
    setSummary(suggestion.summary ?? summary);
    if (suggestion.discussion.length) setDiscussion(suggestion.discussion);
    setDecisions([...decisions, ...suggestion.decisions.filter((d) => !decisions.includes(d))]);
    setActions([...actions, ...suggestion.actions.filter((a) => !actions.some((x) => x.text === a.text))]);
    setQuestions([...questions, ...suggestion.questions.filter((q) => !questions.includes(q))]);
    setInfo([...info, ...suggestion.info.filter((i) => !info.some((x) => x.topic === i.topic && x.detail === i.detail))]);
    setSuggestion(null);
    notify(t('applied'));
  };

  const save = async () => {
    setBusy('save');
    try {
      await rpc('save_meeting_mom', {
        p_id: meeting.id, p_base_updated_at: meeting.updated_at, p_summary: summary, p_discussion: discussion, p_decisions: decisions, p_actions: actions, p_questions: questions, p_info: info, p_attendees: attendees,
      });
      notify(t('saved'));
      await reload();
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const open = meeting.mom_actions.map((a, i) => ({ a, i })).filter((x) => !x.a.task_id);
  return (
    <div className="space-y-5">
      {meeting.mom_recorded_at && <p className="text-xs text-muted-foreground">{t('recordedAt', { when: fmtDateTime(meeting.mom_recorded_at) })}</p>}

      <div className="space-y-2 rounded border border-dashed border-grid p-3">
        <TextField label={t('notes')} multiline rows={4} value={notes} onChange={setNotes} placeholder={t('notesPlaceholder')} />
        <Button variant="outline" size="sm" disabled={busy !== null || !notes.trim() || locked} onClick={structure}><Sparkles /> {busy === 'ai' ? t('structuring') : t('structure')}</Button>
        {suggestion && (
          <div className="rounded border border-primary/40 bg-primary/5 p-3 text-sm">
            <div className="mb-1 font-semibold">{t('suggestion')}</div>
            {suggestion.summary && <p className="mb-1">{suggestion.summary}</p>}
            {suggestion.decisions.length > 0 && <><div className="font-medium">{t('decisions')}</div><ul className="list-disc pl-5">{suggestion.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
            {suggestion.actions.length > 0 && <><div className="mt-1 font-medium">{t('actions')}</div><ul className="list-disc pl-5">{suggestion.actions.map((a, i) => <li key={i}>{a.text}{a.owner_name && ` — ${a.owner_name}`}{a.due_date && ` (${a.due_date})`}</li>)}</ul></>}
            {suggestion.info.length > 0 && <><div className="mt-1 font-medium">{t('info')}</div><ul className="list-disc pl-5">{suggestion.info.map((a, i) => <li key={i}>{a.topic}: {a.detail}</li>)}</ul></>}
            {suggestion.questions.length > 0 && <><div className="mt-1 font-medium">{t('questions')}</div><ul className="list-disc pl-5">{suggestion.questions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
            <div className="mt-2 flex gap-2"><Button size="sm" onClick={apply}>{t('apply')}</Button><Button size="sm" variant="outline" onClick={() => setSuggestion(null)}>{t('discard')}</Button></div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-sm font-semibold">{t('attended')}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {attendees.map((a, i) => (
            <label key={i} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={a.attended} onChange={(e) => setAttendees(attendees.map((x, j) => (j === i ? { ...x, attended: e.target.checked } : x)))} />{a.name}
            </label>
          ))}
        </div>
      </div>

      <TextField label={t('summary')} multiline rows={3} value={summary} onChange={setSummary} />

      <Rows title={t('discussion')} items={discussion} onChange={setDiscussion} blank={{ topic: '', notes: '' }} addLabel={t('addDiscussion')} render={(d, set) => (
        <>
          <input className={`${input} w-56`} placeholder={t('topic')} value={d.topic} onChange={(e) => set({ ...d, topic: e.target.value })} />
          <textarea className="min-h-8 flex-1 rounded border border-grid bg-white px-2 py-1 text-sm" rows={2} placeholder={t('notesCol')} value={d.notes} onChange={(e) => set({ ...d, notes: e.target.value })} />
        </>
      )} />

      <Rows title={t('decisions')} items={decisions} onChange={setDecisions} blank="" addLabel={t('addDecision')} render={(d, set) => (
        <input className={`${input} min-w-64 flex-1`} placeholder={t('decision')} value={d} onChange={(e) => set(e.target.value)} />
      )} />

      <Rows title={t('actions')} items={actions} onChange={setActions} blank={{ text: '', owner_id: null, owner_name: null, due_date: null, task_id: null }} addLabel={t('addAction')} render={(a, set) => (
        <>
          <input className={`${input} min-w-64 flex-1`} placeholder={t('action')} value={a.text} onChange={(e) => set({ ...a, text: e.target.value })} />
          <select className={`${input} w-44`} value={a.owner_id ?? ''} aria-label={t('owner')}
            onChange={(e) => { const p = memberProfiles.find((x) => x.id === Number(e.target.value)); set({ ...a, owner_id: p?.id ?? null, owner_name: p?.full_name ?? (e.target.value ? a.owner_name : null) }); }}>
            <option value="">{a.owner_name && !a.owner_id ? a.owner_name : t('noOwner')}</option>
            {memberProfiles.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <input type="date" className={`${input} w-36`} aria-label={t('due')} value={a.due_date ?? ''} onChange={(e) => set({ ...a, due_date: e.target.value || null })} />
          {meeting.mom_actions.some((x) => x.text === a.text && x.task_id) && <span className="text-xs text-green-700">{t('task')}</span>}
        </>
      )} />

      <Rows title={t('questions')} items={questions} onChange={setQuestions} blank="" addLabel={t('addQuestion')} render={(d, set) => (
        <input className={`${input} min-w-64 flex-1`} placeholder={t('question')} value={d} onChange={(e) => set(e.target.value)} />
      )} />

      <Rows title={t('info')} hint={t('infoHint')} items={info} onChange={setInfo} blank={{ topic: '', detail: '' }} addLabel={t('addInfo')} render={(d, set) => (
        <>
          <input className={`${input} w-56`} placeholder={t('infoTopic')} value={d.topic} onChange={(e) => set({ ...d, topic: e.target.value })} />
          <textarea className="min-h-8 flex-1 rounded border border-grid bg-white px-2 py-1 text-sm" rows={2} placeholder={t('infoDetail')} value={d.detail} onChange={(e) => set({ ...d, detail: e.target.value })} />
        </>
      )} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {meeting.status === 'held' && <Button variant="outline" onClick={onSendMom}><Mail /> {t('sendMom')}</Button>}
          {perm.manage && open.length > 0 && <Button variant="outline" onClick={() => setConverting(true)}><ListChecks /> {t('toTasks')} ({open.length})</Button>}
        </div>
        <Button disabled={busy !== null || locked} onClick={save}>{busy === 'save' ? '…' : t('save')}</Button>
      </div>
      {converting && <ConvertActions data={data} meeting={meeting} open={open} people={memberProfiles} reload={reload} onClose={() => setConverting(false)} />}
    </div>
  );
}

/** Preview of the tasks that will be created from the action items; nothing is written until "Create" */
function ConvertActions({ data, meeting, open, people, reload, onClose }: Pick<TabProps, 'data' | 'reload'> & {
  meeting: ProjectMeeting; open: { a: ActionItem; i: number }[]; people: TabProps['memberProfiles']; onClose: () => void;
}) {
  const t = useTranslations('project.meetings.mom');
  const tm = useTranslations('project.meetings');
  const { me, notify } = useApp();
  const [picked, setPicked] = useState<number[]>(open.map((x) => x.i));
  const [activity, setActivity] = useState(data.activities.length === 1 ? String(data.activities[0].id) : '');
  const [owner, setOwner] = useState<number | null>(me?.id ?? null);
  const [due, setDue] = useState(data.project.target_date ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('convertTitle')}</DialogTitle>
          <DialogDescription>{t('convertDescription')}</DialogDescription>
        </DialogHeader>
        {data.activities.length === 0 ? <p className="text-sm text-muted-foreground">{t('needActivity')}</p> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={t('activity')} required value={activity} onChange={setActivity} options={data.activities.map((a) => ({ value: String(a.id), label: a.name }))} className="col-span-2" />
              <UserSelect label={t('defaultOwner')} required value={owner} onChange={setOwner} users={people} />
              <DateField label={t('defaultDue')} required value={due} onChange={setDue} />
            </div>
            <ul className="max-h-60 space-y-1 overflow-y-auto rounded border border-grid p-2 text-sm">
              {open.map(({ a, i }) => (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={picked.includes(i)} onChange={() => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i])} />
                    <span>{a.text}<span className="block text-xs text-muted-foreground">{a.owner_name ?? t('noOwner')}{a.due_date && ` · ${a.due_date}`}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tm('cancel')}</Button>
          <Button disabled={busy || !picked.length || !activity || !owner || !due} onClick={async () => {
            setBusy(true);
            try {
              const { data: res, error } = await dbClient().rpc('convert_meeting_actions_to_tasks', {
                p_id: meeting.id, p_indexes: picked, p_activity_id: Number(activity), p_owner_id: owner, p_due_date: due,
              });
              if (error) throw new Error(errMsg(error));
              const r = res as { created: number; skipped: number };
              notify(r.skipped ? t('createdSkipped', r) : t('created', { n: r.created }));
              await reload();
              onClose();
            } catch (e) {
              notify(errMsg(e), 'error');
            } finally {
              setBusy(false);
            }
          }}>{t('create', { n: picked.length })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
