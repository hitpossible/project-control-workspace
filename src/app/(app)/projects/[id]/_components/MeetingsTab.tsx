'use client';

import { Calendar, Mail, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { SelectField, TextField } from '@/components/shared/form';
import { BoardGroup, StatusChip } from '@/components/shared/labels';
import { EmptyState } from '@/components/shared/layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { MEETING_STATUS_OPTS, MEETING_TYPE_OPTS } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDateTime } from '@/lib/format';
import { isEmail, type AgendaItem, type Attendee, type ProjectMeeting } from '@/lib/meetings';
import { rpc } from './ClosureSignoff';
import MeetingInvite from './MeetingInvite';
import MeetingMom from './MeetingMom';
import type { TabProps } from './types';

/** ISO instant ↔ the value of <input type="datetime-local"> (browser time zone) */
const pad = (n: number) => String(n).padStart(2, '0');
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');

/** Project meetings: schedule, invite by e-mail (AI drafts the text), record the MOM. Server: rpc/meetings.ts */
export default function MeetingsTab(props: TabProps) {
  const { data, perm } = props;
  const t = useTranslations('project.meetings');
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const canEdit = perm.internal;

  const { upcoming, past } = useMemo(() => {
    const up = data.meetings.filter((m) => m.status === 'planned').sort((a, b) => a.start_at.localeCompare(b.start_at));
    return { upcoming: up, past: data.meetings.filter((m) => m.status !== 'planned') };
  }, [data.meetings]);

  const sentCount = (id: number) => data.invitations.filter((i) => i.meeting_id === id && i.kind !== 'mom').length;
  const table = (rows: ProjectMeeting[]) => (
    <Table className="board-table">
      <TableHeader>
        <TableRow>
          <TableHead>{t('col.no')}</TableHead><TableHead className="text-left">{t('col.title')}</TableHead><TableHead>{t('col.when')}</TableHead>
          <TableHead>{t('col.status')}</TableHead><TableHead>{t('col.people')}</TableHead><TableHead>{t('col.mom')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.id} className="cursor-pointer" onClick={() => setOpen(m.id)}>
            <TableCell className="text-center text-xs text-muted-foreground">#{m.meeting_no}</TableCell>
            <TableCell className="min-w-64 whitespace-normal">
              {m.title}
              <div className="text-xs text-muted-foreground"><StatusLabel type={m.meeting_type} />{perm.internal && m.status === 'planned' && ` · ${sentCount(m.id) ? t('invited', { n: sentCount(m.id) }) : t('notInvited')}`}</div>
            </TableCell>
            <TableCell className="whitespace-nowrap text-center text-xs">{fmtDateTime(m.start_at)}</TableCell>
            <TableCell className="p-1"><StatusChip list={MEETING_STATUS_OPTS} value={m.status} fullWidth /></TableCell>
            <TableCell className="text-center text-xs">{m.attendees.length}</TableCell>
            <TableCell className="text-center text-xs">{m.mom_recorded_at ? t('momDone') : <span className="text-muted-foreground">{t('momNone')}</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        {canEdit && <Button onClick={() => setOpen('new')}><Plus /> {t('new')}</Button>}
      </div>
      {data.meetings.length === 0 ? <EmptyState text={t('empty')} /> : (
        <>
          <BoardGroup title={t('upcoming')} color="#fdab3d" count={upcoming.length}>{upcoming.length ? table(upcoming) : <p className="p-3 text-sm text-muted-foreground">{t('none')}</p>}</BoardGroup>
          <BoardGroup title={t('past')} color="#757575" count={past.length}>{past.length ? table(past) : <p className="p-3 text-sm text-muted-foreground">{t('none')}</p>}</BoardGroup>
        </>
      )}
      {open !== null && <MeetingDialog key={open} {...props} meetingId={open} onSelect={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StatusLabel({ type }: { type: string }) {
  const { text } = useOptions();
  return <>{text('meetingType', type)}</>;
}

type Step = 'plan' | 'invite' | 'mom';

function MeetingDialog(props: TabProps & { meetingId: number | 'new'; onSelect: (id: number) => void; onClose: () => void }) {
  const { data, meetingId, onClose, onSelect } = props;
  const t = useTranslations('project.meetings');
  const meeting = meetingId === 'new' ? null : data.meetings.find((m) => m.id === meetingId) ?? null;
  const [step, setStep] = useState<Step>('plan');
  const [momMail, setMomMail] = useState(false);
  const steps: Step[] = ['plan', 'invite', 'mom'];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Calendar className="size-4" />{meeting ? t('dialogEdit', { no: meeting.meeting_no }) : t('dialogNew')}</DialogTitle>
          <DialogDescription className="sr-only">{t('intro')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 border-b border-grid">
          {steps.map((s, i) => (
            <button key={s} type="button" disabled={!meeting} onClick={() => { setStep(s); setMomMail(false); }}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm disabled:opacity-40 ${step === s ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`}>
              {i + 1}. {t(`step.${s}`)}
            </button>
          ))}
        </div>
        {step === 'plan' && <PlanForm {...props} meeting={meeting} onSaved={(m) => { if (!meeting) onSelect(m.id); setStep('invite'); }} />}
        {step === 'invite' && meeting && <MeetingInvite {...props} meeting={meeting} startKind={momMail ? 'mom' : undefined} />}
        {step === 'mom' && meeting && <MeetingMom {...props} meeting={meeting} onSendMom={() => { setMomMail(true); setStep('invite'); }} />}
      </DialogContent>
    </Dialog>
  );
}

function PlanForm({ data, reload, memberProfiles, meeting, onSaved, onClose }: TabProps & { meeting: ProjectMeeting | null; onSaved: (m: ProjectMeeting) => void; onClose: () => void }) {
  const t = useTranslations('project.meetings');
  const { options } = useOptions();
  const { notify, me } = useApp();
  const defaultStart = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.toISOString(); };
  const [f, setF] = useState({
    title: meeting?.title ?? '', type: meeting?.meeting_type ?? 'requirement', start: toLocalInput(meeting?.start_at ?? defaultStart()),
    end: toLocalInput(meeting?.end_at ?? new Date(new Date(defaultStart()).getTime() + 3600_000).toISOString()),
    location: meeting?.location ?? '', link: meeting?.online_link ?? '', purpose: meeting?.purpose ?? '',
  });
  const [agenda, setAgenda] = useState<AgendaItem[]>(meeting?.agenda ?? []);
  const [people, setPeople] = useState<Attendee[]>(meeting?.attendees ?? (me ? [{ user_id: me.id, name: me.full_name, email: me.email ?? null, attended: false }] : []));
  const [ext, setExt] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const sent = meeting ? data.invitations.some((i) => i.meeting_id === meeting.id && i.kind !== 'mom') : false;
  const timeChanged = !!meeting && sent && (new Date(f.start).toISOString() !== meeting.start_at || new Date(f.end).toISOString() !== meeting.end_at || (f.location || null) !== meeting.location);

  const team = memberProfiles.filter((p) => p.is_active);
  const has = (id: number) => people.some((x) => x.user_id === id);
  const toggleUser = (id: number) => {
    const p = team.find((x) => x.id === id)!;
    setPeople(has(id) ? people.filter((x) => x.user_id !== id) : [...people, { user_id: id, name: p.full_name, email: p.email ?? null, attended: false }]);
  };
  const addExternal = () => {
    const email = ext.email.trim().toLowerCase();
    if (!isEmail(email)) return notify(t('extEmail'), 'error');
    if (people.some((x) => x.email === email)) return;
    setPeople([...people, { user_id: null, name: ext.name.trim() || email, email, attended: false }]);
    setExt({ name: '', email: '' });
  };

  const save = async (status?: string) => {
    setBusy(true);
    try {
      const { data: row, error } = await dbClient().rpc('save_meeting', {
        p_project_id: data.project.id, p_id: meeting?.id, p_base_updated_at: meeting?.updated_at, p_title: f.title, p_meeting_type: f.type, p_status: status ?? meeting?.status ?? 'planned',
        p_start_at: fromLocalInput(f.start), p_end_at: fromLocalInput(f.end), p_location: f.location, p_online_link: f.link, p_purpose: f.purpose,
        p_agenda: agenda, p_attendees: people,
      });
      if (error) throw new Error(errMsg(error));
      notify(status === 'cancelled' ? t('cancelled') : status === 'planned' ? t('reopened') : t('saved'));
      await reload();
      onSaved(row as ProjectMeeting);
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!meeting || !window.confirm(t('confirmDelete', { no: meeting.meeting_no }))) return;
    setBusy(true);
    try {
      await rpc('delete_meeting', { p_id: meeting.id });
      notify(t('deleted'));
      await reload();
      onClose();
    } catch (e) {
      notify(errMsg(e), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <TextField label={t('field.title')} required value={f.title} onChange={set('title')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField label={t('field.type')} value={f.type} onChange={set('type')} options={options(MEETING_TYPE_OPTS)} />
        <TextField label={t('field.start')} required type="datetime-local" value={f.start} onChange={set('start')} />
        <TextField label={t('field.end')} required type="datetime-local" value={f.end} onChange={set('end')} />
        <TextField label={t('field.location')} value={f.location} onChange={set('location')} placeholder={t('locationPlaceholder')} />
        <TextField label={t('field.link')} value={f.link} onChange={set('link')} placeholder="https://" className="sm:col-span-2" />
      </div>
      <TextField label={t('field.purpose')} multiline rows={2} value={f.purpose} onChange={set('purpose')} placeholder={t('purposePlaceholder')} />

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">{t('field.agenda')}</div>
        <div className="space-y-1.5">
          {agenda.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.</span>
              <input className="h-8 flex-1 rounded border border-grid bg-white px-2 text-sm" value={a.title} placeholder={t('agendaItem')}
                onChange={(e) => setAgenda(agenda.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input type="number" min={1} className="h-8 w-16 rounded border border-grid bg-white px-2 text-sm" value={a.minutes ?? ''} placeholder={t('minutes')}
                onChange={(e) => setAgenda(agenda.map((x, j) => (j === i ? { ...x, minutes: e.target.value ? Number(e.target.value) : null } : x)))} />
              <Button variant="ghost" size="icon-sm" aria-label={t('removeRow')} onClick={() => setAgenda(agenda.filter((_, j) => j !== i))}><X /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setAgenda([...agenda, { title: '', minutes: null }])}><Plus /> {t('addAgenda')}</Button>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">{t('field.attendees')} ({people.length})</div>
        <div className="mb-1 text-xs text-muted-foreground">{t('team')}</div>
        <div className="grid max-h-40 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto rounded border border-grid p-2 text-sm sm:grid-cols-2">
          {team.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={has(p.id)} onChange={() => toggleUser(p.id)} />
              <span>{p.full_name}</span>{!p.email && <span className="text-xs text-muted-foreground">({t('noEmail')})</span>}
            </label>
          ))}
        </div>
        <div className="mb-1 mt-2 text-xs text-muted-foreground">{t('external')}</div>
        <ul className="mb-1 space-y-0.5 text-sm">
          {people.filter((x) => !x.user_id).map((x) => (
            <li key={x.email} className="flex items-center gap-2"><Mail className="size-3.5 text-muted-foreground" />{x.name} <span className="text-xs text-muted-foreground">{x.email}</span>
              <Button variant="ghost" size="icon-sm" aria-label={t('removeRow')} onClick={() => setPeople(people.filter((p) => p !== x))}><X /></Button></li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <input className="h-8 w-40 rounded border border-grid bg-white px-2 text-sm" placeholder={t('extName')} value={ext.name} onChange={(e) => setExt({ ...ext, name: e.target.value })} />
          <input className="h-8 flex-1 rounded border border-grid bg-white px-2 text-sm" placeholder={t('extEmail')} type="email" value={ext.email} onChange={(e) => setExt({ ...ext, email: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExternal(); } }} />
          <Button variant="outline" size="sm" disabled={!ext.email.trim()} onClick={addExternal}><Plus /> {t('addExternal')}</Button>
        </div>
      </div>

      {timeChanged && <p className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800">{t('changedAfterInvite')}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {meeting && meeting.status !== 'held' && !meeting.mom_recorded_at && (
            <Button variant="outline" className="text-destructive" disabled={busy} onClick={remove}><Trash2 /> {t('delete')}</Button>
          )}
          {meeting?.status === 'planned' && (
            <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(t('confirmCancel', { no: meeting.meeting_no }))) void save('cancelled'); }}>{t('cancelMeeting')}</Button>
          )}
          {meeting?.status === 'cancelled' && <Button variant="outline" disabled={busy} onClick={() => save('planned')}>{t('reopen')}</Button>}
        </div>
        <Button disabled={busy || !f.title.trim() || !f.start} onClick={() => save()}>{t('save')}</Button>
      </div>
    </div>
  );
}
