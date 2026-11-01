'use client';

import { CircleCheckBig, Hourglass, MessageSquareWarning, PenLine, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { dispatchEmails, useApp } from '@/providers/AppProvider';
import { ActionButton, CommentDialog, TextField } from '@/components/shared/form';
import MySignature from '@/components/srs/MySignature';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDateTime } from '@/lib/format';
import type { TabProps } from './types';

/**
 * Closure sign-off (projects from a request): the leader sends the delivery for acceptance, the requestor or a
 * requestor representative accepts it — which completes the project — or asks for changes. Server: rpc/closure.ts
 */
type Props = Pick<TabProps, 'data' | 'perm' | 'reload'>;

export const pendingClosure = (data: TabProps['data']) => data.closures.find((c) => c.status === 'pending') ?? null;

/** Whether I may accept / send back this project's delivery (mirrors closureAcceptors on the server) */
export function useCanAccept(data: TabProps['data']) {
  const { me } = useApp();
  if (!me) return false;
  return data.project.requestor_id === me.id || data.members.some((m) => m.user_id === me.id && m.member_role === 'requestor_rep');
}

/** Workflow call that throws the server message; sends queued e-mails */
export async function rpc(fn: string, args: Record<string, unknown>) {
  const { error } = await dbClient().rpc(fn, args);
  if (error) throw new Error(errMsg(error));
  dispatchEmails();
}

/** In the close dialog of a project with a request: the handover summary and "Send for acceptance" */
export function SendForAcceptance({ data, reload, blocked, onDone }: Pick<Props, 'data' | 'reload'> & { blocked: boolean; onDone: () => void }) {
  const t = useTranslations('project.closure');
  const { notify } = useApp();
  const last = data.closures[0];
  const [summary, setSummary] = useState(last?.status === 'changes_requested' ? last.summary : '');
  const [busy, setBusy] = useState(false);
  return (
    <>
      {last?.status === 'changes_requested' && (
        <Alert className="border-amber-400 bg-amber-50">
          <MessageSquareWarning className="text-amber-600" />
          <AlertTitle>{t('changesTitle')}</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{last.decision_comment}</AlertDescription>
        </Alert>
      )}
      <TextField multiline rows={4} label={t('summary')} required value={summary} onChange={setSummary} placeholder={t('summaryPlaceholder')} helperText={t('summaryHelp')} />
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>{t('notYet')}</Button>
        <ActionButton tone="success" disabled={blocked || busy || !summary.trim()} onClick={async () => {
          setBusy(true);
          try {
            await rpc('request_closure', { p_project_id: data.project.id, p_summary: summary });
            notify(t('sent'));
            onDone();
            await reload();
          } catch (e) {
            notify(errMsg(e), 'error');
          } finally {
            setBusy(false);
          }
        }}><PenLine /> {t('send')}</ActionButton>
      </DialogFooter>
    </>
  );
}

function AcceptDialog({ data, reload, onClose }: Pick<Props, 'data' | 'reload'> & { onClose: () => void }) {
  const t = useTranslations('project.closure');
  const { notify } = useApp();
  const c = pendingClosure(data)!;
  const [hasSignature, setHasSignature] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/me/signature?check=1', { cache: 'no-store' }).then((r) => r.json()).then((j) => setHasSignature(!!j.data?.has_signature));
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('acceptTitle')}</DialogTitle>
          <DialogDescription>{t('acceptDescription', { code: data.project.project_code })}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{c.summary}</div>
        {hasSignature === false ? (
          <div className="space-y-2">
            <p className="text-sm text-amber-700">{t('needSignature')}</p>
            <MySignature onSaved={() => setHasSignature(true)} />
          </div>
        ) : (
          <TextField multiline rows={2} label={t('commentOptional')} value={comment} onChange={setComment} />
        )}
        <p className="text-xs text-muted-foreground">{t('acceptNote')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('notYet')}</Button>
          <ActionButton tone="success" disabled={!hasSignature || busy} onClick={async () => {
            setBusy(true);
            try {
              await rpc('decide_closure', { p_closure_id: c.id, p_accept: true, p_comment: comment || null });
              notify(t('accepted'));
              onClose();
              await reload();
            } catch (e) {
              notify(errMsg(e), 'error');
            } finally {
              setBusy(false);
            }
          }}><CircleCheckBig /> {t('accept')}</ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Overview banner: waiting for acceptance (accept / ask for changes / withdraw), changes asked for, or who accepted */
export function ClosureBanner({ data, perm, reload }: Props) {
  const t = useTranslations('project.closure');
  const { me, notify, profileName } = useApp();
  const c = data.closures[0];
  // the server refuses the sender as acceptor (a leader who is also requestor representative)
  const canAccept = useCanAccept(data) && c?.requested_by !== me?.id;
  const [dialog, setDialog] = useState<'accept' | 'changes' | null>(null);
  const p = data.project;
  if (!c || !p.request_id) return null;

  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    try {
      await rpc(fn, args);
      notify(msg);
      await reload();
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  if (c.status === 'pending') {
    return (
      <>
        <Alert className="mb-4 border-[#579bfc] bg-[#579bfc]/5">
          <Hourglass className="text-[#579bfc]" />
          <AlertTitle>{canAccept ? t('pendingTitleAcceptor') : t('pendingTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{t('pendingText', { by: profileName(c.requested_by), date: fmtDateTime(c.requested_at) })}</span>
            <div className="rounded-md border bg-white p-3 text-sm whitespace-pre-wrap text-foreground">{c.summary}</div>
            <div className="flex flex-wrap gap-2">
              {canAccept && <ActionButton tone="success" size="sm" onClick={() => setDialog('accept')}><CircleCheckBig /> {t('accept')}</ActionButton>}
              {canAccept && <Button size="sm" variant="outline" onClick={() => setDialog('changes')}><MessageSquareWarning /> {t('requestChanges')}</Button>}
              {perm.manage && <Button size="sm" variant="ghost" onClick={() => act('withdraw_closure', { p_closure_id: c.id }, t('withdrawn'))}><Undo2 /> {t('withdraw')}</Button>}
            </div>
          </AlertDescription>
        </Alert>
        {dialog === 'accept' && <AcceptDialog data={data} reload={reload} onClose={() => setDialog(null)} />}
        <CommentDialog open={dialog === 'changes'} title={t('requestChanges')} required variant="warning" confirmLabel={t('requestChanges')}
          description={t('changesDescription')} onClose={() => setDialog(null)}
          onConfirm={async (comment) => {
            setDialog(null);
            await act('decide_closure', { p_closure_id: c.id, p_accept: false, p_comment: comment }, t('changesSent'));
          }} />
      </>
    );
  }

  if (c.status === 'changes_requested' && !['completed', 'cancelled'].includes(p.status) && (perm.manage || canAccept)) {
    return (
      <Alert className="mb-4 border-amber-400 bg-amber-50">
        <MessageSquareWarning className="text-amber-600" />
        <AlertTitle>{t('changesTitle')}</AlertTitle>
        <AlertDescription>
          <span className="text-xs">{t('decidedBy', { by: profileName(c.decided_by), date: fmtDateTime(c.decided_at) })}</span>
          <span className="mt-1 block whitespace-pre-wrap text-foreground">{c.decision_comment}</span>
        </AlertDescription>
      </Alert>
    );
  }

  if (c.status === 'accepted' && p.status === 'completed') {
    return (
      <Alert className="mb-4 border-[#00c875] bg-[#00c875]/5">
        <CircleCheckBig className="text-[#00c875]" />
        <AlertTitle>{t('acceptedTitle')}</AlertTitle>
        <AlertDescription>
          {t('decidedBy', { by: profileName(c.decided_by), date: fmtDateTime(c.decided_at) })}
          {c.decision_comment && <span className="mt-1 block whitespace-pre-wrap text-foreground">{c.decision_comment}</span>}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
