'use client';

import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, Eye, FileText, MousePointerClick, Plus, Send, Trash2, Upload, UserPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { Person, TextField, UserSelect } from '@/components/shared/common';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dbClient } from '@/lib/db/client';
import { errMsg } from '@/lib/format';
import type { SrsDocument, SrsField, SrsFieldKind, SrsSigner } from '@/lib/types';
import { cn } from '@/lib/utils';
import PdfPages from './PdfPages';

type Box = { key: string; kind: SrsFieldKind; page_no: number; x: number; y: number; w: number; h: number };
type LayoutSigner = { key: string; signer_id: number | null; role_label: string; fields: Box[] };
type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const SIGNER_COLORS = ['#0073ea', '#e2445c', '#00a35c', '#a25ddc', '#d97706', '#037f8c', '#ff642e', '#5559df'];
/** default field size in PDF points */
const DEFAULT_PT: Record<SrsFieldKind, [number, number]> = { signature: [140, 44], name: [160, 24], date: [100, 22] };
const KINDS: SrsFieldKind[] = ['signature', 'name', 'date'];
const SCRIPT = '"Segoe Script", "Snell Roundhand", "Brush Script MT", cursive';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
let seq = 0;
const newKey = (p: string) => `${p}${++seq}`;

/** Text shown inside a field, like on the final document: a script "Signature", plain "Name" / "Date" */
export function FieldLabel({ kind, label, className }: { kind: SrsFieldKind; label: string; className?: string }) {
  return <span className={cn('truncate px-1 leading-none', className)} style={kind === 'signature' ? { fontFamily: SCRIPT } : undefined}>{label}</span>;
}

/**
 * Preparing an SRS for signing, in three steps: 1. document & signers, 2. place fields, 3. preview & send.
 * The layout saves itself a moment after every change.
 */
export default function SrsEditor({ doc, signers, fields, projectId, pdfUrl, onChanged }: {
  doc: SrsDocument; signers: SrsSigner[]; fields: SrsField[]; projectId: number | null; pdfUrl: string; onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations('srs');
  const te = useTranslations('srs.editor');
  const db = dbClient();
  const { me, profileName, notify } = useApp();

  const [layout, setLayout] = useState<LayoutSigner[]>(() => signers.map((s) => ({
    key: `s${s.id}`, signer_id: s.signer_id, role_label: s.role_label ?? '',
    fields: fields.filter((f) => f.signer_row_id === s.id).map((f) => ({ key: `f${f.id}`, kind: f.kind, page_no: f.page_no, x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) })),
  })));
  const [step, setStep] = useState<1 | 2 | 3>(signers.length ? 2 : 1);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<SrsFieldKind | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [pdfWidth, setPdfWidth] = useState(0);
  const [busy, setBusy] = useState(false);

  // ---- autosave ----
  const [save, setSave] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const layoutRef = useRef(layout);
  const version = useRef(0);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  const persist = useCallback(() => {
    chain.current = chain.current.then(async () => {
      const v = version.current;
      setSave('saving');
      const { error } = await db.rpc('srs_save_layout', {
        p_srs_id: doc.id,
        p_signers: layoutRef.current.filter((s) => s.signer_id).map((s) => ({
          signer_id: s.signer_id, role_label: s.role_label || null, fields: s.fields.map(({ kind, page_no, x, y, w, h }) => ({ kind, page_no, x, y, w, h })),
        })),
      });
      if (error) {
        setSave('error');
        notify(errMsg(error), 'error');
        return false;
      }
      setSave(version.current === v ? 'saved' : 'pending');
      return true;
    });
    return chain.current;
  }, [db, doc.id, notify]);

  const change = (fn: (l: LayoutSigner[]) => LayoutSigner[]) => {
    setLayout(fn);
    version.current++;
    setSave('pending');
  };

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (save !== 'pending') return;
    const timer = setTimeout(persist, 700);
    return () => clearTimeout(timer);
  }, [layout, save, persist]);

  /** wait for the latest layout to be stored (before moving on / sending) */
  const flush = async () => (save === 'saved' ? chain.current : persist());

  // ---- signers ----
  const chosen = layout.filter((s) => s.signer_id);
  const colorOf = (i: number) => SIGNER_COLORS[i % SIGNER_COLORS.length];
  const nameOf = (s: LayoutSigner | undefined) => (s?.signer_id ? profileName(s.signer_id) : te('noSigner'));

  const addSigner = (id: number | null) => {
    if (id && layout.some((s) => s.signer_id === id)) return notify(te('alreadySigner'), 'warning');
    change((l) => [...l, { key: newKey('s'), signer_id: id, role_label: '', fields: [] }]);
  };
  const setSigner = (i: number, id: number | null) => {
    if (id && layout.some((s, j) => j !== i && s.signer_id === id)) return notify(te('alreadySigner'), 'warning');
    change((l) => l.map((s, j) => (j === i ? { ...s, signer_id: id } : s)));
  };
  const removeSigner = async (i: number) => {
    const s = layout[i];
    if (s.fields.length && !(await confirmDialog({ title: te('removeSignerTitle', { name: nameOf(s) }), description: te('removeSignerDescription', { count: s.fields.length }), destructive: true, confirmText: te('removeSigner') }))) return;
    change((l) => l.filter((_, j) => j !== i));
    setActive(0);
  };

  // ---- fields ----
  const signerOfBox = (key: string | null) => layout.findIndex((s) => s.fields.some((f) => f.key === key));
  const selectedSigner = signerOfBox(selected);
  const selectedBox = selectedSigner >= 0 ? layout[selectedSigner].fields.find((f) => f.key === selected) : undefined;

  const updateBox = (key: string, patch: Partial<Box>) =>
    change((l) => l.map((s) => ({ ...s, fields: s.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) })));
  const removeBox = (key: string) => {
    change((l) => l.map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== key) })));
    setSelected(null);
  };
  const reassign = (key: string, to: number) => change((l) => {
    const box = l.flatMap((s) => s.fields).find((f) => f.key === key);
    if (!box) return l;
    return l.map((s, i) => ({ ...s, fields: i === to ? [...s.fields.filter((f) => f.key !== key), box] : s.fields.filter((f) => f.key !== key) }));
  });

  // scale of the shown pages: CSS px per PDF point (pages are drawn at the container width)
  const scale = pdfWidth && doc.pages[0] ? pdfWidth / doc.pages[0].w : 1;
  const sizeFor = (kind: SrsFieldKind, pageNo: number) => {
    const page = doc.pages[pageNo - 1] ?? doc.pages[0];
    return { w: Math.min(0.9, DEFAULT_PT[kind][0] / page.w), h: Math.min(0.9, DEFAULT_PT[kind][1] / page.h) };
  };

  const drop = (pageNo: number, size: { w: number; h: number }, e: React.PointerEvent<HTMLDivElement>) => {
    if (!placing || !layout[active]?.signer_id) return;
    const r = e.currentTarget.getBoundingClientRect();
    const { w, h } = sizeFor(placing, pageNo);
    const x = clamp((e.clientX - r.left) / size.w - w / 2, 0, 1 - w);
    const y = clamp((e.clientY - r.top) / size.h - h / 2, 0, 1 - h);
    const key = newKey('n');
    const kind = placing;
    change((l) => l.map((s, i) => (i === active ? { ...s, fields: [...s.fields, { key, kind, page_no: pageNo, x, y, w, h }] } : s)));
    setSelected(key);
    setPlacing(null);
    setGhost(null);
  };

  // while placing, a ghost of the field follows the pointer; Esc stops, Delete removes the selected field
  useEffect(() => {
    if (!placing) return;
    const move = (e: PointerEvent) => setGhost({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [placing]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'Escape') {
        setPlacing(null);
        setGhost(null);
        setSelected(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && step === 2) removeBox(selected);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ---- steps ----
  const missingSig = chosen.filter((s) => !s.fields.some((f) => f.kind === 'signature'));
  const go = async (to: 1 | 2 | 3) => {
    if (to > 1 && !chosen.length) return notify(te('needSigner'), 'warning');
    if (to === 2 && layout.some((s) => !s.signer_id)) change((l) => l.filter((s) => s.signer_id));
    if (to === 3 && missingSig.length) return notify(te('needSignatureBox', { names: missingSig.map(nameOf).join(', ') }), 'warning');
    setPlacing(null);
    setSelected(null);
    if (to === 2) setActive((a) => Math.min(a, Math.max(0, chosen.length - 1)));
    setStep(to);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const send = () => run(async () => {
    if (!(await confirmDialog({ title: te('sendTitle'), description: te('sendDescription', { count: chosen.length }), confirmText: te('send') }))) return;
    if (!(await flush())) return;
    const { error } = await db.rpc('srs_send', { p_srs_id: doc.id });
    if (error) return notify(errMsg(error), 'error');
    notify(te('sent'), 'success');
    await onChanged();
  });

  const cancel = () => run(async () => {
    if (!(await confirmDialog({ title: t('cancelTitle'), description: t('cancelDescription'), confirmText: t('cancel'), destructive: true }))) return;
    const { error } = await db.rpc('srs_cancel', { p_srs_id: doc.id });
    if (error) return notify(errMsg(error), 'error');
    await onChanged();
  });

  // ---- page overlay ----
  const overlay = (pageNo: number, size: { w: number; h: number }) => (
    <div className={cn('absolute inset-0', placing && 'cursor-copy')}
      onPointerDown={() => !placing && setSelected(null)}
      onPointerUp={(e) => drop(pageNo, size, e)}>
      {layout.flatMap((s, si) => s.fields.filter((f) => f.page_no === pageNo).map((f) => (
        step === 2
          ? <FieldBox key={f.key} box={f} size={size} color={colorOf(si)} label={t(`kind.${f.kind}`)} owner={nameOf(s)}
            selected={selected === f.key} dim={si !== active && selected !== f.key}
            onSelect={() => { setSelected(f.key); setActive(si); }} onChange={(p) => updateBox(f.key, p)} onDelete={() => removeBox(f.key)} />
          : <div key={f.key} className="absolute flex items-center justify-center rounded-sm border-2 text-xs"
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, borderColor: colorOf(si), background: `${colorOf(si)}14`, color: colorOf(si) }}>
            <FieldLabel kind={f.kind} label={step === 3 ? `${t(`kind.${f.kind}`)} · ${nameOf(s)}` : t(`kind.${f.kind}`)} />
          </div>
      )))}
    </div>
  );

  const stepsMeta = [
    { n: 1 as const, icon: Upload, title: te('step1'), hint: te('step1Hint') },
    { n: 2 as const, icon: MousePointerClick, title: te('step2'), hint: te('step2Hint') },
    { n: 3 as const, icon: Eye, title: te('step3'), hint: te('step3Hint') },
  ];

  return (
    <div className={cn('grid gap-5', step === 2 ? 'xl:grid-cols-[230px_minmax(0,1fr)_270px]' : 'xl:grid-cols-[230px_minmax(0,1fr)]')}>
      {/* steps + quick actions */}
      <aside className="space-y-5 xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-lg border bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">{te('title')}</span>
            <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">{te('stepOf', { step, total: 3 })}</span>
          </div>
          <div className="mb-3 h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-primary transition-all" style={{ width: `${(step / 3) * 100}%` }} /></div>
          <ol className="space-y-2">
            {stepsMeta.map((s) => {
              const Icon = s.icon;
              const on = s.n === step;
              const done = s.n < step;
              return (
                <li key={s.n}>
                  <button type="button" onClick={() => go(s.n)}
                    className={cn('flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors', on ? 'border-primary bg-primary/5' : 'hover:bg-muted/60')}>
                    <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border', on && 'border-primary text-primary', done && 'border-[#00a35c] bg-[#00a35c] text-white')}>
                      {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className={cn('block text-sm font-medium', on && 'text-primary')}>{s.title}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">{s.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="rounded-lg border bg-white p-2 text-sm">
          <div className="px-2 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">{te('quickActions')}</div>
          <a href={`${pdfUrl}&download=1`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"><Download className="size-4" /> {t('download')}</a>
          <button type="button" disabled={busy} onClick={cancel} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-destructive hover:bg-muted"><X className="size-4" /> {t('cancel')}</button>
          {projectId && <Link href={`/projects/${projectId}?tab=srs`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"><ArrowLeft className="size-4" /> {te('backToProject')}</Link>}
          <div className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">
            {save === 'saving' ? te('saving') : save === 'pending' ? te('unsaved') : save === 'error' ? te('saveFailed') : te('allSaved')}
          </div>
        </div>
      </aside>

      {/* step content */}
      <div className="min-w-0">
        {step === 1 && (
          <div className="mx-auto max-w-3xl space-y-5">
            <section className="rounded-lg border bg-white p-5">
              <h2 className="text-base font-semibold">{te('documentTitle')}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{te('documentHint')}</p>
              <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                <FileText className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{doc.file_name}</div>
                  <div className="text-xs text-muted-foreground">V{doc.version_no} · {t('pages', { count: doc.page_count })}</div>
                </div>
                <Button variant="ghost" size="sm" asChild><a href={pdfUrl} target="_blank" rel="noopener"><Eye /> {te('open')}</a></Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{te('replaceHint')}</p>
            </section>

            <section className="rounded-lg border bg-white p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{te('signersTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{te('signersHint')}</p>
                </div>
                <div className="flex gap-2">
                  {me && !layout.some((s) => s.signer_id === me.id) && <Button variant="outline" size="sm" onClick={() => addSigner(me.id)}><UserPlus /> {te('addMyself')}</Button>}
                  <Button variant="outline" size="sm" onClick={() => addSigner(null)}><Plus /> {te('addSigner')}</Button>
                </div>
              </div>
              {layout.length === 0 ? (
                <button type="button" onClick={() => addSigner(null)} className="w-full rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground hover:bg-muted/40">{te('noSigners')}</button>
              ) : (
                <div className="space-y-2">
                  <div className="hidden gap-3 pr-11 pl-6 text-xs font-medium text-muted-foreground sm:flex">
                    <span className="flex-1">{te('colSigner')}</span><span className="flex-1">{te('colRole')}</span>
                  </div>
                  {layout.map((s, i) => (
                    <div key={s.key} className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                      <span className="size-3 shrink-0 rounded-full" style={{ background: colorOf(i) }} />
                      <UserSelect className="min-w-48 flex-1" value={s.signer_id} onChange={(id) => setSigner(i, id)} required />
                      <TextField className="min-w-40 flex-1" placeholder={te('rolePlaceholder')} value={s.role_label}
                        onChange={(v) => change((l) => l.map((x, j) => (j === i ? { ...x, role_label: v } : x)))} />
                      <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={te('removeSigner')} onClick={() => removeSigner(i)}><Trash2 className="size-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div className="flex justify-end">
              <Button onClick={() => go(2)}>{te('nextFields')} <ChevronRight /></Button>
            </div>
          </div>
        )}

        {step !== 1 && (
          <>
            {step === 3 && (
              <section className="mb-4 rounded-lg border bg-white p-4">
                <h2 className="text-base font-semibold">{te('previewTitle')}</h2>
                <p className="mb-3 text-sm text-muted-foreground">{te('previewHint')}</p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {chosen.map((s) => {
                    const i = layout.indexOf(s);
                    return (
                      <li key={s.key} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: colorOf(i) }} />
                        <span className="min-w-0 flex-1 truncate font-medium">{nameOf(s)}{s.role_label && <span className="font-normal text-muted-foreground"> · {s.role_label}</span>}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{KINDS.map((k) => `${t(`kind.${k}`)} ${s.fields.filter((f) => f.kind === k).length}`).join(' · ')}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <div className="rounded-lg bg-[#eef0f4] p-3 sm:p-5">
              <SizeProbe onWidth={setPdfWidth}><PdfPages url={pdfUrl} overlay={overlay} /></SizeProbe>
            </div>
            <div className="mt-4 flex justify-between">
              <Button variant="outline" onClick={() => go(step === 3 ? 2 : 1)}><ChevronLeft /> {te('back')}</Button>
              {step === 2
                ? <Button onClick={() => go(3)}>{te('nextPreview')} <ChevronRight /></Button>
                : <Button disabled={busy} onClick={send}><Send /> {te('send')}</Button>}
            </div>
          </>
        )}
      </div>

      {/* step 2: who the next field is for, the field palette, and the selected field */}
      {step === 2 && (
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-lg border bg-white p-3">
            <div className="mb-1.5 text-sm font-semibold">{te('selectedSigner')}</div>
            <Select value={String(active)} onValueChange={(v) => setActive(Number(v))}>
              <SelectTrigger className="h-10 w-full bg-white" style={{ borderColor: colorOf(active) }}><SelectValue /></SelectTrigger>
              <SelectContent>
                {layout.map((s, i) => (
                  <SelectItem key={s.key} value={String(i)}>
                    <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: colorOf(i) }} />{nameOf(s)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {layout[active]?.role_label && <div className="mt-1 text-xs text-muted-foreground">{layout[active].role_label}</div>}
          </div>

          <div className="rounded-lg border bg-white p-3">
            <div className="mb-0.5 text-sm font-semibold">{te('addFields')}</div>
            <p className="mb-2.5 text-xs text-muted-foreground">{te('addFieldsHint')}</p>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button key={k} type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    // touch pointers are captured by the button they start on — release so the page receives the drop
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                    setSelected(null); setPlacing(k); setGhost({ x: e.clientX, y: e.clientY }); }}
                  className={cn('flex h-12 touch-none items-center justify-center gap-2 rounded-md border bg-white text-sm transition-colors select-none hover:bg-muted', k === 'signature' && 'col-span-2', placing === k && 'ring-2')}
                  style={{ borderColor: placing === k ? colorOf(active) : undefined, ['--tw-ring-color' as string]: `${colorOf(active)}55` }}>
                  <FieldLabel kind={k} label={t(`kind.${k}`)} className={k === 'signature' ? 'text-lg' : undefined} />
                </button>
              ))}
            </div>
            {missingSig.length > 0 && <p className="mt-2.5 text-xs text-[#d97706]">{te('needSignatureBox', { names: missingSig.map(nameOf).join(', ') })}</p>}
          </div>

          {selectedBox && (
            <div className="rounded-lg border bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{te('fieldSettings', { kind: t(`kind.${selectedBox.kind}`) })}</span>
                <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={te('removeField')} onClick={() => removeBox(selectedBox.key)}><Trash2 className="size-4" /></Button>
              </div>
              <div className="mb-1 text-xs text-muted-foreground">{te('fieldFor')}</div>
              <Select value={String(selectedSigner)} onValueChange={(v) => { reassign(selectedBox.key, Number(v)); setActive(Number(v)); }}>
                <SelectTrigger className="h-9 w-full bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {layout.map((s, i) => <SelectItem key={s.key} value={String(i)}><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: colorOf(i) }} />{nameOf(s)}</span></SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">{te(`fieldHint.${selectedBox.kind}`)}</p>
            </div>
          )}

          <div className="rounded-lg border bg-white p-3">
            <div className="mb-2 text-sm font-semibold">{te('signersTitle')}</div>
            <ul className="space-y-1.5">
              {layout.map((s, i) => (
                <li key={s.key}>
                  <button type="button" onClick={() => setActive(i)} className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted', i === active && 'bg-muted')}>
                    <Person name={nameOf(s)} showName={false} size={22} />
                    <span className="min-w-0 flex-1 truncate">{nameOf(s)}</span>
                    <span className="flex gap-1">{KINDS.map((k) => {
                      const n = s.fields.filter((f) => f.kind === k).length;
                      return <span key={k} className={cn('rounded px-1 text-[10px]', n ? 'text-white' : 'bg-muted text-muted-foreground')} style={n ? { background: colorOf(i) } : undefined}>{t(`kind.${k}`)} {n}</span>;
                    })}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}

      {/* the field following the pointer while placing */}
      {placing && ghost && (
        <div className="pointer-events-none fixed z-50 flex items-center justify-center rounded-sm border-2 text-xs shadow-lg"
          style={{
            left: ghost.x, top: ghost.y, width: DEFAULT_PT[placing][0] * scale, height: DEFAULT_PT[placing][1] * scale, transform: 'translate(-50%, -50%)',
            borderColor: colorOf(active), background: `${colorOf(active)}26`, color: colorOf(active),
          }}>
          <FieldLabel kind={placing} label={t(`kind.${placing}`)} />
        </div>
      )}
      {placing && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {te('placing', { kind: t(`kind.${placing}`), name: nameOf(layout[active]) })}
          <button type="button" className="ml-3 underline" onClick={() => { setPlacing(null); setGhost(null); }}>{te('stopPlacing')}</button>
        </div>
      )}
    </div>
  );
}

/** reports the width its children are laid out at (the PDF pages fill it) */
function SizeProbe({ onWidth, children }: { onWidth: (w: number) => void; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const ro = new ResizeObserver(() => onWidth(Math.floor(node.clientWidth)));
    ro.observe(node);
    return () => ro.disconnect();
  }, [onWidth]);
  return <div ref={el}>{children}</div>;
}

/** A placed field: drag to move, any corner to resize, × (or Delete) to remove */
function FieldBox({ box, size, color, label, owner, selected, dim, onSelect, onChange, onDelete }: {
  box: Box; size: { w: number; h: number }; color: string; label: string; owner: string; selected: boolean; dim: boolean;
  onSelect: () => void; onChange: (p: Partial<Box>) => void; onDelete: () => void;
}) {
  const drag = useRef<{ mode: 'move' | Corner; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);
  const MIN_W = 0.03;
  const MIN_H = 0.012;

  const start = (mode: 'move' | Corner, e: React.PointerEvent) => {
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
    if (d.mode === 'move') return onChange({ x: clamp(d.x + dx, 0, 1 - d.w), y: clamp(d.y + dy, 0, 1 - d.h) });
    let { x, y, w, h } = d;
    if (d.mode.includes('e')) w = clamp(d.w + dx, MIN_W, 1 - d.x);
    if (d.mode.includes('s')) h = clamp(d.h + dy, MIN_H, 1 - d.y);
    if (d.mode.includes('w')) {
      x = clamp(d.x + dx, 0, d.x + d.w - MIN_W);
      w = d.x + d.w - x;
    }
    if (d.mode.includes('n')) {
      y = clamp(d.y + dy, 0, d.y + d.h - MIN_H);
      h = d.y + d.h - y;
    }
    onChange({ x, y, w, h });
  };
  const end = (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = null;
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  const corners: [Corner, string][] = [['nw', '-left-1.5 -top-1.5 cursor-nwse-resize'], ['ne', '-right-1.5 -top-1.5 cursor-nesw-resize'], ['sw', '-left-1.5 -bottom-1.5 cursor-nesw-resize'], ['se', '-right-1.5 -bottom-1.5 cursor-nwse-resize']];

  return (
    <div className={cn('group absolute flex cursor-move touch-none items-center justify-center rounded-sm border-2 text-xs select-none', dim && 'opacity-50')}
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, borderColor: color, background: `${color}1a`, color, boxShadow: selected ? `0 0 0 3px ${color}40` : undefined }}
      onPointerDown={(e) => start('move', e)} {...handlers}>
      <FieldLabel kind={box.kind} label={label} className={box.kind === 'signature' ? 'text-sm' : undefined} />
      <span className={cn('pointer-events-none absolute -top-[18px] left-[-2px] hidden max-w-[14rem] truncate rounded-t px-1.5 text-[10px] leading-4 font-medium text-white group-hover:block', selected && 'block')} style={{ background: color }}>{owner}</span>
      {selected && (
        <>
          <button type="button" aria-label="remove" className="absolute -top-[18px] -right-[2px] flex size-4 items-center justify-center rounded-t text-white" style={{ background: color }}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <X className="size-3" />
          </button>
          {corners.map(([c, pos]) => (
            <span key={c} className={cn('absolute size-3 rounded-full border-2 bg-white', pos)} style={{ borderColor: color }}
              onPointerDown={(e) => start(c, e)} {...handlers} />
          ))}
        </>
      )}
    </div>
  );
}
