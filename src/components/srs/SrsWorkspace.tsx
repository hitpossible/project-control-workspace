'use client';

import { Check, Download, FileText, PenLine, Undo2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { ActionButton, CommentDialog } from '@/components/shared/form';
import { PageHeader, Section } from '@/components/shared/layout';
import { StatusChip } from '@/components/shared/labels';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SRS_SIGNER_STATUSES, SRS_STATUSES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDateTime } from '@/lib/format';
import type { SrsDocument, SrsField, SrsSigner } from '@/lib/types';
import { cn } from '@/lib/utils';
import { nameImage } from './ink';
import MySignatureDialog from './MySignatureDialog';
import PdfPages from './PdfPages';
import SrsEditor, { FieldLabel, SIGNER_COLORS } from './SrsEditor';

/** One SRS: place each signer's boxes (draft), then sign / send back (signing) — signatures appear as they come in */
export default function SrsWorkspace({ id }: { id: number }) {
  const t = useTranslations('srs');
  const db = dbClient();
  const { me, profileName, notify } = useApp();
  const [doc, setDoc] = useState<SrsDocument | null>(null);
  const [missing, setMissing] = useState(false);
  const [signers, setSigners] = useState<SrsSigner[]>([]);
  const [fields, setFields] = useState<SrsField[]>([]);
  const [project, setProject] = useState<{ id: number; project_code: string; project_name: string } | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasSignature, setHasSignature] = useState<boolean | null>(null);
  const [mySig, setMySig] = useState<{ open: boolean; then?: boolean }>({ open: false });
  const [signOpen, setSignOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: d } = await db.from('srs_documents').select('*').eq('id', id).maybeSingle();
    if (!d) return setMissing(true);
    const doc = d as SrsDocument;
    const [s, f, pv, edit] = await Promise.all([
      db.from('srs_signers').select('*').eq('srs_id', id).order('seq'),
      db.from('srs_fields').select('*').eq('srs_id', id).order('id'),
      db.from('v_projects').select('id, project_code, project_name').eq('id', doc.project_id).maybeSingle(),
      db.rpc('can_view_internal', { p_project_id: doc.project_id }),
    ]);
    const ss = (s.data ?? []) as SrsSigner[];
    const ff = (f.data ?? []) as SrsField[];
    setDoc(doc);
    setSigners(ss);
    setFields(ff);
    setProject(pv.data ?? null);
    setCanEdit(!!edit.data);
  }, [db, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/me/signature?check=1', { cache: 'no-store' }).then((r) => r.json()).then((j) => setHasSignature(!!j.data?.has_signature)).catch(() => setHasSignature(false));
  }, []);

  // live: reload when someone signs / sends back / sends / cancels
  useEffect(() => {
    const es = new EventSource(`/api/srs/${id}/stream`);
    es.addEventListener('changed', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as { by: number; action: string };
      if (ev.by !== me?.id && ['signed', 'rejected', 'cancelled'].includes(ev.action)) {
        notify(t(`live.${ev.action as 'signed' | 'rejected' | 'cancelled'}`, { name: profileName(ev.by) }), 'info');
      }
      if (ev.action === 'layout') return; // the open editor keeps its own copy of the boxes
      load();
    });
    return () => es.close();
  }, [id, load, me?.id, notify, profileName, t]);

  const editing = !!doc && doc.status === 'draft' && canEdit;
  const myRow = signers.find((s) => s.signer_id === me?.id);
  const myTurn = doc?.status === 'signing' && myRow?.status === 'pending';
  const colorOf = (signerId: number) => SIGNER_COLORS[Math.max(0, signers.map((s) => s.signer_id).indexOf(signerId)) % SIGNER_COLORS.length];
  const pdfUrl = doc ? `/api/srs/${id}/file?v=${doc.stamped_sha256 ?? doc.original_sha256}` : '';
  const myFields = useMemo(() => (myRow ? fields.filter((f) => f.signer_row_id === myRow.id) : []), [fields, myRow]);

  const run = async (fn: () => Promise<boolean | void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => run(async () => {
    if (!(await confirmDialog({ title: t('cancelTitle'), description: t('cancelDescription'), confirmText: t('cancel'), destructive: true }))) return;
    const { error } = await db.rpc('srs_cancel', { p_srs_id: id });
    if (error) return notify(errMsg(error), 'error');
    await load();
  });

  // ---- signing ----
  const approve = () => {
    if (hasSignature === false) return setMySig({ open: true, then: true });
    setSignOpen(true);
  };

  const sign = () => run(async () => {
    if (!me) return;
    const name = myFields.some((f) => f.kind === 'name') ? await nameImage(me.full_name, me.position) : null;
    const res = await fetch(`/api/srs/${id}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name_image: name }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return notify(j.error?.message ?? res.statusText, 'error');
    setSignOpen(false);
    notify(j.data?.completed ? t('sign.completed') : t('sign.done'), 'success');
    await load();
  });

  const reject = async (comment: string) => {
    const { error } = await db.rpc('srs_reject', { p_srs_id: id, p_comment: comment });
    if (error) return notify(errMsg(error), 'error');
    setRejectOpen(false);
    notify(t('reject.done'), 'success');
    await load();
  };

  if (missing) return <Alert><AlertDescription>{t('notFound')}</AlertDescription></Alert>;
  if (!doc || !me) return null;

  // ---- page overlays ----
  const overlay = (pageNo: number) => {
    // signed boxes are already in the PDF; show who is still to sign where
    const open = signers.filter((s) => s.status !== 'signed');
    return open.flatMap((s) => fields.filter((f) => f.signer_row_id === s.id && f.page_no === pageNo).map((f) => {
      const mine = s.signer_id === me.id && myTurn;
      const color = colorOf(s.signer_id);
      return (
        <div key={f.id} className={cn('absolute flex items-center justify-center rounded-sm border-2 border-dashed text-[11px] leading-tight', mine && 'animate-pulse border-solid')}
          style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, borderColor: color, background: `${color}${mine ? '26' : '12'}`, color }}>
          <FieldLabel kind={f.kind} label={mine ? t(`kind.${f.kind}`) : `${profileName(s.signer_id)} · ${t(`kind.${f.kind}`)}`} className="pb-0.5 font-medium" />
        </div>
      );
    }));
  };

  const scrollToMine = () => {
    const f = myFields[0];
    if (f) document.querySelector(`[data-page="${f.page_no}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><FileText className="size-5 text-primary" />{doc.title} <span className="text-muted-foreground">V{doc.version_no}</span></span>}
        subtitle={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusChip list={SRS_STATUSES} value={doc.status} />
            {project && <Link href={`/projects/${project.id}?tab=srs`} className="font-semibold text-primary">{project.project_code} — {project.project_name}</Link>}
            <span>· {doc.file_name} · {t('pages', { count: doc.page_count })}</span>
          </div>
        }
        actions={!editing && <>
          <Button variant="outline" asChild><a href={`${pdfUrl}&download=1`}><Download /> {doc.stamped_sha256 ? t('downloadSigned') : t('download')}</a></Button>
          {canEdit && ['draft', 'signing', 'rejected'].includes(doc.status) && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={cancel}><X /> {t('cancel')}</Button>}
        </>}
      />

      {myTurn && (
        <Alert className="mb-4 border-[#fdab3d] bg-[#fff8ec]">
          <AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
            <PenLine className="size-5 text-[#d97706]" />
            <span className="font-medium">{t('sign.yourTurn', { count: myFields.length })}</span>
            <Button variant="link" size="sm" className="px-0" onClick={scrollToMine}>{t('sign.showMine')}</Button>
            <div className="ml-auto flex gap-2">
              <ActionButton tone="destructive" outline disabled={busy} onClick={() => setRejectOpen(true)}><Undo2 /> {t('reject.button')}</ActionButton>
              <ActionButton tone="success" disabled={busy} onClick={approve}><Check /> {t('sign.button')}</ActionButton>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {doc.status === 'rejected' && (
        <Alert className="mb-4 border-[#e2445c] bg-[#fdecef]">
          <AlertDescription className="text-foreground">
            {signers.filter((s) => s.status === 'rejected').map((s) => (
              <div key={s.id}><span className="font-semibold">{t('reject.by', { name: profileName(s.signer_id) })}</span> “{s.comment}”</div>
            ))}
            {canEdit && <div className="mt-1 text-xs">{t('reject.next')}</div>}
          </AlertDescription>
        </Alert>
      )}
      {doc.status === 'signed' && (
        <Alert className="mb-4 border-[#00c875] bg-[#e9fbf3]">
          <AlertDescription className="text-foreground">{t('signedBanner', { date: fmtDateTime(doc.completed_at) })}</AlertDescription>
        </Alert>
      )}
      {doc.status === 'superseded' && <Alert className="mb-4"><AlertDescription>{t('supersededBanner')}</AlertDescription></Alert>}

      {editing ? <SrsEditor key={doc.id} doc={doc} signers={signers} fields={fields} projectId={project?.id ?? null} pdfUrl={pdfUrl} onChanged={load} /> : (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-lg bg-[#eef0f4] p-3 sm:p-5">
          <PdfPages url={pdfUrl} overlay={overlay} />
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          {(
            <Section title={t('signers.title')} className="mb-0">
              {signers.length === 0 ? <p className="text-sm text-muted-foreground">{doc.status === 'draft' ? t('signers.draft') : '–'}</p> : (
                <ol className="space-y-2.5">
                  {signers.map((s) => (
                    <li key={s.id} className="rounded-md border p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: colorOf(s.signer_id) }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{profileName(s.signer_id)}{s.signer_id === me.id && <span className="ml-1 text-xs font-normal text-muted-foreground">({t('signers.you')})</span>}</div>
                          {s.role_label && <div className="truncate text-xs text-muted-foreground">{s.role_label}</div>}
                        </div>
                        <StatusChip list={SRS_SIGNER_STATUSES} value={s.status} />
                      </div>
                      {s.signed_at && <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(s.signed_at)}</div>}
                      {s.status === 'rejected' && s.comment && <div className="mt-1 text-xs italic">“{s.comment}”</div>}
                    </li>
                  ))}
                </ol>
              )}
              {doc.status === 'draft' && !canEdit && <p className="mt-2 text-xs text-muted-foreground">{t('signers.draft')}</p>}
            </Section>
          )}
          <Section title={t('integrity.title')} className="mb-0">
            <dl className="space-y-1.5 text-xs">
              <div><dt className="text-muted-foreground">{t('integrity.original')}</dt><dd className="font-mono break-all">{doc.original_sha256}</dd></div>
              {doc.stamped_sha256 && <div><dt className="text-muted-foreground">{t('integrity.stamped')}</dt><dd className="font-mono break-all">{doc.stamped_sha256}</dd></div>}
              <div className="pt-1"><a className="text-primary hover:underline" href={`/api/srs/${id}/file?original=1&download=1`}>{t('integrity.downloadOriginal')}</a></div>
            </dl>
          </Section>
        </div>
      </div>

      )}

      <MySignatureDialog open={mySig.open}
        onClose={() => setMySig({ open: false })}
        onSaved={() => { setHasSignature(true); if (mySig.then) setSignOpen(true); }} />

      <SignConfirm open={signOpen} busy={busy} doc={doc} name={me.full_name} position={me.position ?? null} boxes={myFields.length}
        onClose={() => setSignOpen(false)} onConfirm={sign} onChangeSignature={() => { setSignOpen(false); setMySig({ open: true, then: true }); }} />

      <CommentDialog open={rejectOpen} title={t('reject.title')} description={t('reject.description')} confirmLabel={t('reject.button')} required variant="destructive"
        onClose={() => setRejectOpen(false)} onConfirm={reject} />
    </>
  );
}

/** Last step before signing: what will be stamped, and an explicit acknowledgement */
function SignConfirm({ open, busy, doc, name, position, boxes, onClose, onConfirm, onChangeSignature }: {
  open: boolean; busy: boolean; doc: SrsDocument; name: string; position: string | null; boxes: number;
  onClose: () => void; onConfirm: () => void; onChangeSignature: () => void;
}) {
  const t = useTranslations('srs.sign');
  const [ack, setAck] = useState(false);
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let url: string | null = null;
    fetch('/api/me/signature', { cache: 'no-store' }).then(async (r) => {
      if (!r.ok) return;
      url = URL.createObjectURL(await r.blob());
      setImg(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
      setAck(false);
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('confirmTitle')}</DialogTitle>
          <DialogDescription>{t('confirmDescription', { title: doc.title, version: doc.version_no, count: boxes })}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-white p-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- private blob URL */}
          {img ? <img src={img} alt="" className="mx-auto max-h-24" /> : <div className="h-24" />}
          <div className="mt-1 text-sm font-semibold">({name})</div>
          {position && <div className="text-xs text-muted-foreground">{position}</div>}
          <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={onChangeSignature}>{t('change')}</button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
          <span>{t('ack', { version: doc.version_no })}</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('back')}</Button>
          <ActionButton tone="success" disabled={!ack || busy} onClick={onConfirm}><Check /> {t('confirm')}</ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
