'use client';

import { CalendarDays, Check, Download, FileText, PenLine, Save, Send, Signature, Trash2, Type, Undo2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { ActionButton, CommentDialog, PageHeader, Section, StatusChip, TextField, UserSelect } from '@/components/common';
import { confirmDialog } from '@/components/ConfirmDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SRS_SIGNER_STATUSES, SRS_STATUSES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDateTime } from '@/lib/format';
import type { SrsDocument, SrsField, SrsFieldKind, SrsSigner } from '@/lib/types';
import { cn } from '@/lib/utils';
import { nameImage } from './ink';
import MySignatureDialog from './MySignatureDialog';
import PdfPages from './PdfPages';

type Box = { key: string; kind: SrsFieldKind; page_no: number; x: number; y: number; w: number; h: number };
type LayoutSigner = { signer_id: number; role_label: string; fields: Box[] };

const COLORS = ['#0073ea', '#e2445c', '#00a35c', '#a25ddc', '#d97706', '#037f8c', '#ff642e', '#5559df'];
/** default box size in PDF points */
const DEFAULT_PT: Record<SrsFieldKind, [number, number]> = { signature: [150, 50], name: [170, 32], date: [100, 18] };
const KIND_ICON = { signature: Signature, name: Type, date: CalendarDays } as const;
const KINDS: SrsFieldKind[] = ['signature', 'name', 'date'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
let seq = 0;
const newKey = () => `n${++seq}`;

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
  const [layout, setLayout] = useState<LayoutSigner[]>([]);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [active, setActive] = useState(0);
  const [placing, setPlacing] = useState<SrsFieldKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
    if (!dirtyRef.current) {
      setLayout(ss.map((x) => ({
        signer_id: x.signer_id, role_label: x.role_label ?? '',
        fields: ff.filter((b) => b.signer_row_id === x.id).map((b) => ({ key: `f${b.id}`, kind: b.kind, page_no: b.page_no, x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h) })),
      })));
    }
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
      load();
    });
    return () => es.close();
  }, [id, load, me?.id, notify, profileName, t]);

  const markDirty = (fn: (l: LayoutSigner[]) => LayoutSigner[]) => {
    setLayout(fn);
    dirtyRef.current = true;
    setDirty(true);
  };

  const editing = !!doc && doc.status === 'draft' && canEdit;
  const myRow = signers.find((s) => s.signer_id === me?.id);
  const myTurn = doc?.status === 'signing' && myRow?.status === 'pending';
  const colorOf = (signerId: number) => COLORS[Math.max(0, (editing ? layout.map((l) => l.signer_id) : signers.map((s) => s.signer_id)).indexOf(signerId)) % COLORS.length];
  const pdfUrl = doc ? `/api/srs/${id}/file?v=${doc.stamped_sha256 ?? doc.original_sha256}` : '';
  const myFields = useMemo(() => (myRow ? fields.filter((f) => f.signer_row_id === myRow.id) : []), [fields, myRow]);

  // ---- layout editing ----
  const updateBox = (si: number, key: string, patch: Partial<Box>) =>
    markDirty((l) => l.map((s, i) => (i === si ? { ...s, fields: s.fields.map((b) => (b.key === key ? { ...b, ...patch } : b)) } : s)));
  const removeBox = (si: number, key: string) => markDirty((l) => l.map((s, i) => (i === si ? { ...s, fields: s.fields.filter((b) => b.key !== key) } : s)));

  const place = (pageNo: number, size: { w: number; h: number }, e: React.PointerEvent<HTMLDivElement>) => {
    if (!placing || !doc || !layout[active]) return;
    const r = e.currentTarget.getBoundingClientRect();
    const page = doc.pages[pageNo - 1] ?? { w: size.w, h: size.h };
    const w = Math.min(0.9, DEFAULT_PT[placing][0] / page.w);
    const h = Math.min(0.9, DEFAULT_PT[placing][1] / page.h);
    const x = clamp((e.clientX - r.left) / size.w - w / 2, 0, 1 - w);
    const y = clamp((e.clientY - r.top) / size.h - h / 2, 0, 1 - h);
    const key = newKey();
    markDirty((l) => l.map((s, i) => (i === active ? { ...s, fields: [...s.fields, { key, kind: placing, page_no: pageNo, x, y, w, h }] } : s)));
    setSelected(key);
    setPlacing(null);
  };

  const saveLayout = async () => {
    const { error } = await db.rpc('srs_save_layout', {
      p_srs_id: id,
      p_signers: layout.map((s) => ({ signer_id: s.signer_id, role_label: s.role_label || null, fields: s.fields.map(({ kind, page_no, x, y, w, h }) => ({ kind, page_no, x, y, w, h })) })),
    });
    if (error) {
      notify(errMsg(error), 'error');
      return false;
    }
    dirtyRef.current = false;
    setDirty(false);
    return true;
  };

  const run = async (fn: () => Promise<boolean | void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const send = () => run(async () => {
    const missingSig = layout.filter((s) => !s.fields.some((f) => f.kind === 'signature'));
    if (!layout.length) return notify(t('editor.needSigner'), 'warning');
    if (missingSig.length) return notify(t('editor.needSignatureBox', { names: missingSig.map((s) => profileName(s.signer_id)).join(', ') }), 'warning');
    if (!(await confirmDialog({ title: t('editor.sendTitle'), description: t('editor.sendDescription', { count: layout.length }), confirmText: t('editor.send') }))) return;
    if (dirtyRef.current && !(await saveLayout())) return;
    const { error } = await db.rpc('srs_send', { p_srs_id: id });
    if (error) return notify(errMsg(error), 'error');
    notify(t('editor.sent'), 'success');
    await load();
  });

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
  const overlay = (pageNo: number, size: { w: number; h: number }) => {
    if (editing) {
      return (
        <div className={cn('absolute inset-0', placing && 'cursor-crosshair bg-primary/5')} onPointerDown={(e) => (placing ? place(pageNo, size, e) : setSelected(null))}>
          {layout.flatMap((s, si) => s.fields.filter((b) => b.page_no === pageNo).map((b) => (
            <EditableBox key={b.key} box={b} size={size} color={colorOf(s.signer_id)} label={`${profileName(s.signer_id)} · ${t(`kind.${b.kind}`)}`}
              selected={selected === b.key} dim={si !== active}
              onSelect={() => { setSelected(b.key); setActive(si); }}
              onChange={(p) => updateBox(si, b.key, p)} onDelete={() => removeBox(si, b.key)} />
          )))}
        </div>
      );
    }
    // signed boxes are already in the PDF; show who is still to sign where
    const open = signers.filter((s) => s.status !== 'signed');
    return open.flatMap((s) => fields.filter((f) => f.signer_row_id === s.id && f.page_no === pageNo).map((f) => {
      const mine = s.signer_id === me.id && myTurn;
      const color = colorOf(s.signer_id);
      return (
        <div key={f.id} className={cn('absolute flex items-end justify-center rounded-sm border-2 border-dashed text-[10px] leading-tight', mine && 'animate-pulse border-solid')}
          style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, borderColor: color, background: `${color}${mine ? '26' : '12'}` }}>
          <span className="truncate px-1 font-medium" style={{ color }}>{mine ? t(`kind.${f.kind}`) : `${profileName(s.signer_id)} · ${t(`kind.${f.kind}`)}`}</span>
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
        actions={<>
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-lg bg-[#eef0f4] p-3 sm:p-5">
          {editing && placing && (
            // floating, so the pages do not move between choosing the box type and clicking where it goes
            <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-center text-sm text-white shadow-lg">
              {t('editor.placing', { kind: t(`kind.${placing}`), name: profileName(layout[active]?.signer_id) })}
              <button type="button" className="ml-3 underline" onClick={() => setPlacing(null)}>{t('editor.stopPlacing')}</button>
            </div>
          )}
          <PdfPages url={pdfUrl} overlay={overlay} />
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {editing ? (
            <Section title={t('editor.title')} className="mb-0">
              <p className="mb-3 text-xs text-muted-foreground">{t('editor.help')}</p>
              <div className="space-y-2">
                {layout.map((s, si) => {
                  const color = colorOf(s.signer_id);
                  return (
                    <div key={s.signer_id} className={cn('rounded-md border p-2.5', si === active && 'ring-2')} style={si === active ? { borderColor: color, ['--tw-ring-color' as string]: `${color}55` } : undefined}
                      onClick={() => setActive(si)}>
                      <div className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: color }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{si + 1}. {profileName(s.signer_id)}</span>
                        <Button variant="ghost" size="icon-sm" aria-label={t('editor.removeSigner')} onClick={(e) => { e.stopPropagation(); markDirty((l) => l.filter((_, i) => i !== si)); setActive(0); }}><Trash2 className="size-4" /></Button>
                      </div>
                      <TextField className="mt-1.5" placeholder={t('editor.rolePlaceholder')} value={s.role_label}
                        onChange={(v) => markDirty((l) => l.map((x, i) => (i === si ? { ...x, role_label: v } : x)))} />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {KINDS.map((k) => {
                          const Icon = KIND_ICON[k];
                          const n = s.fields.filter((f) => f.kind === k).length;
                          return (
                            <Button key={k} size="sm" variant={placing === k && si === active ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                              onClick={(e) => { e.stopPropagation(); setActive(si); setPlacing(placing === k && si === active ? null : k); }}>
                              <Icon className="size-3.5" /> {t(`kind.${k}`)}{n > 0 && <span className="ml-0.5 rounded bg-black/10 px-1">{n}</span>}
                            </Button>
                          );
                        })}
                      </div>
                      {!s.fields.some((f) => f.kind === 'signature') && <div className="mt-1.5 text-xs text-[#d97706]">{t('editor.noSignatureBox')}</div>}
                    </div>
                  );
                })}
              </div>
              <UserSelect className="mt-3" label={t('editor.addSigner')} value={null}
                onChange={(uid) => {
                  if (!uid) return;
                  if (layout.some((s) => s.signer_id === uid)) return notify(t('editor.alreadySigner'), 'warning');
                  markDirty((l) => [...l, { signer_id: uid, role_label: '', fields: [] }]);
                  setActive(layout.length);
                }} />
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1" disabled={busy || !dirty} onClick={() => run(saveLayout)}><Save /> {dirty ? t('editor.save') : t('editor.saved')}</Button>
                <Button className="flex-1" disabled={busy} onClick={send}><Send /> {t('editor.send')}</Button>
              </div>
            </Section>
          ) : (
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

/** A box being placed: drag to move, corner handle to resize, × to remove */
function EditableBox({ box, size, color, label, selected, dim, onSelect, onChange, onDelete }: {
  box: Box; size: { w: number; h: number }; color: string; label: string; selected: boolean; dim: boolean;
  onSelect: () => void; onChange: (p: Partial<Box>) => void; onDelete: () => void;
}) {
  const drag = useRef<{ mode: 'move' | 'resize'; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);

  const start = (mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, x: box.x, y: box.y, w: box.w, h: box.h };
    onSelect();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / size.w;
    const dy = (e.clientY - d.py) / size.h;
    if (d.mode === 'move') onChange({ x: clamp(d.x + dx, 0, 1 - d.w), y: clamp(d.y + dy, 0, 1 - d.h) });
    else onChange({ w: clamp(d.w + dx, 0.02, 1 - d.x), h: clamp(d.h + dy, 0.01, 1 - d.y) });
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div className={cn('group absolute cursor-move touch-none rounded-sm border-2 select-none', dim && !selected && 'opacity-60')}
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, borderColor: color, background: `${color}1f`, boxShadow: selected ? `0 0 0 3px ${color}40` : undefined }}
      onPointerDown={(e) => start('move', e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span className="pointer-events-none absolute -top-4 left-0 max-w-[16rem] truncate rounded-t px-1 text-[10px] leading-4 font-medium text-white" style={{ background: color }}>{label}</span>
      <button type="button" aria-label="remove" className={cn('absolute -top-2.5 -right-2.5 hidden size-5 items-center justify-center rounded-full bg-white shadow ring-1 ring-black/10 group-hover:flex', selected && 'flex')}
        onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
        <X className="size-3" />
      </button>
      <span className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border-2 bg-white" style={{ borderColor: color }}
        onPointerDown={(e) => start('resize', e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
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
