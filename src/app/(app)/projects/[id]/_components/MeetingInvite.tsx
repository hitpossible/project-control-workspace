'use client';

import { Paperclip, Send, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { SelectField, TextField } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import { errMsg, fmtDateTime } from '@/lib/format';
import type { InviteKind, ProjectMeeting } from '@/lib/meetings';
import { rpc } from './ClosureSignoff';
import type { TabProps } from './types';

type Draft = { subject: string; body: string; ai?: boolean };

/** POST to the AI helper route; nothing is saved or sent by it */
export async function meetingAi(projectId: number, body: Record<string, unknown>): Promise<{ data?: unknown; error?: { message: string } }> {
  const res = await fetch(`/api/projects/${projectId}/meeting-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ error: { message: res.statusText } }));
}

/** Step 2: the e-mail (AI draft → edit → send) and the log of what was sent. The user presses Send; nothing goes out by itself. */
export default function MeetingInvite({ data, reload, meeting, startKind }: TabProps & { meeting: ProjectMeeting; startKind?: InviteKind }) {
  const t = useTranslations('project.meetings.invite');
  const { notify } = useApp();
  const lang = useLocale() === 'en' ? 'en' : 'th';
  const sentBefore = data.invitations.some((i) => i.meeting_id === meeting.id && i.kind !== 'mom');
  const allowed: InviteKind[] = meeting.status === 'cancelled' ? ['cancel'] : meeting.status === 'held' ? ['mom'] : sentBefore ? ['update', 'invite'] : ['invite', 'update'];
  const [kind, setKind] = useState<InviteKind>(startKind && allowed.includes(startKind) ? startKind : allowed[0]);
  const [draft, setDraft] = useState<Draft>({ subject: '', body: '' });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const withMail = meeting.attendees.filter((a) => a.email);
  const [to, setTo] = useState<string[]>(withMail.map((a) => a.email!));
  const [ics, setIcs] = useState(true);
  const log = data.invitations.filter((i) => i.meeting_id === meeting.id);

  const seq = useRef(0);
  const makeDraft = async (plain = false) => {
    const mine = ++seq.current;
    setBusy('draft');
    try {
      const r = kind === 'mom'
        ? await meetingAi(data.project.id, { kind: 'mom_mail', meeting_id: meeting.id, lang })
        : await meetingAi(data.project.id, { kind: 'invitation', mail_kind: kind, meeting_id: meeting.id, lang, plain });
      if (r.error || !r.data) throw new Error(r.error?.message ?? 'Failed');
      if (mine !== seq.current) return; // a newer draft was asked for meanwhile
      const d = r.data as Draft;
      setDraft({ subject: d.subject, body: d.body, ai: d.ai });
      setNote(kind === 'mom' || plain ? t('template') : d.ai ? t('aiDone') : t('aiOff'));
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  };

  const send = async () => {
    if (!window.confirm(t('confirm', { n: to.length }))) return;
    setBusy('send');
    try {
      await rpc('send_meeting_email', {
        p_id: meeting.id, p_kind: kind, p_subject: draft.subject, p_body: draft.body, p_lang: lang, p_attach_ics: ics && kind !== 'mom',
        p_ai_drafted: !!draft.ai, p_recipients: withMail.filter((a) => to.includes(a.email!)).map((a) => ({ name: a.name, email: a.email })),
      });
      notify(t('sentTo', { n: to.length }));
      setDraft({ subject: '', body: '' });
      setNote(null);
      await reload();
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {withMail.length === 0 ? <p className="text-sm text-muted-foreground">{t('noRecipients')}</p> : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <SelectField label={t('kind')} value={kind} onChange={(v) => { seq.current++; setBusy(null); setKind(v as InviteKind); setDraft({ subject: '', body: '' }); setNote(null); }}
              options={allowed.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} className="w-56" />
            {kind !== 'mom' && (
              <Button variant="outline" disabled={busy !== null} onClick={() => makeDraft()}><Sparkles /> {busy === 'draft' ? t('drafting') : t('draftAi')}</Button>
            )}
            <Button variant="outline" disabled={busy === 'send'} onClick={() => makeDraft(true)}>{t('draftPlain')}</Button>
          </div>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('to')}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-grid p-2 text-sm">
              {withMail.map((a) => (
                <label key={a.email} className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={to.includes(a.email!)} onChange={() => setTo(to.includes(a.email!) ? to.filter((x) => x !== a.email) : [...to, a.email!])} />
                  {a.name} <span className="text-xs text-muted-foreground">{a.email}</span>
                </label>
              ))}
            </div>
          </div>
          <TextField label={t('subject')} value={draft.subject} onChange={(v) => setDraft({ ...draft, subject: v, ai: draft.ai })} />
          <TextField label={t('body')} multiline rows={12} value={draft.body} onChange={(v) => setDraft({ ...draft, body: v, ai: draft.ai })} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {kind !== 'mom' ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={ics} onChange={(e) => setIcs(e.target.checked)} /><Paperclip className="size-3.5" />{t('attachIcs')}</label>
            ) : <span />}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{t('nothingAutomatic')}</span>
              <Button disabled={busy !== null || !draft.subject.trim() || !draft.body.trim() || !to.length} onClick={send}><Send /> {busy === 'send' ? t('sending') : t('send')}</Button>
            </div>
          </div>
        </>
      )}

      <div>
        <div className="mb-1 text-sm font-semibold">{t('log')}</div>
        {log.length === 0 ? <p className="text-sm text-muted-foreground">{t('logEmpty')}</p> : (
          <ul className="space-y-1">
            {log.map((i) => (
              <li key={i.id} className="rounded border border-grid p-2 text-sm">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{t(`kinds.${i.kind}`)}</span> · {i.subject}
                    <span className="ml-2 text-xs text-muted-foreground">{fmtDateTime(i.sent_at)} · {t('recipients', { n: i.recipients.length })}{i.with_ics && ` · ${t('withIcs')}`}{i.ai_drafted && ` · ${t('ai')}`}</span>
                  </summary>
                  <div className="mt-2 text-xs text-muted-foreground">{i.recipients.map((r) => `${r.name} <${r.email}>`).join(', ')}</div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{i.body}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
