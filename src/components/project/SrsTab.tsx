'use client';

import { FileSignature, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, Section, SelectField, StatusChip, TextField, entityKey } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SRS_STATUSES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { fmtDateTime } from '@/lib/format';
import type { EvidenceRequirement, SrsDocument, SrsSigner } from '@/lib/types';
import type { TabProps } from './types';

/** SRS sign-off: versions of the SRS, who has signed, and upload of a new version */
export default function SrsTab({ data, perm }: TabProps) {
  const t = useTranslations('srs');
  const tc = useTranslations('common');
  const db = dbClient();
  const router = useRouter();
  const { profileName, notify } = useApp();
  const p = data.project;
  const [docs, setDocs] = useState<SrsDocument[]>([]);
  const [signers, setSigners] = useState<SrsSigner[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: d } = await db.from('srs_documents').select('*').eq('project_id', p.id).order('version_no', { ascending: false });
    const list = (d ?? []) as SrsDocument[];
    setDocs(list);
    const { data: s } = list.length ? await db.from('srs_signers').select('*').in('srs_id', list.map((x) => x.id)).order('seq') : { data: [] };
    setSigners((s ?? []) as SrsSigner[]);
  }, [db, p.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  // the checklist item a signed SRS completes: by default the requirement document of the Requirement activity
  const names = useMemo(() => Object.fromEntries(data.activities.map((a) => [entityKey('activity', a.id), a.name])), [data.activities]);
  const reqOptions = data.requirements.map((r) => ({
    value: String(r.id),
    label: `${r.name} — ${r.entity_type === 'project' ? t('upload.projectLevel') : names[entityKey(r.entity_type, r.entity_id)] ?? r.entity_type}`,
  }));
  const defaultReq = useMemo(() => {
    const isReqAct = (r: EvidenceRequirement) => r.entity_type === 'activity' && /requirement/i.test(names[entityKey('activity', r.entity_id)] ?? '');
    const hit = data.requirements.find((r) => isReqAct(r) && /requirement|srs/i.test(r.name)) ?? data.requirements.find((r) => /srs/i.test(r.name));
    return hit ? String(hit.id) : '';
  }, [data.requirements, names]);

  const [form, setForm] = useState({ title: '', requirement: '', file: null as File | null });
  const [busy, setBusy] = useState(false);
  const start = () => {
    setForm({ title: docs[0]?.title ?? `SRS — ${p.project_name}`, requirement: docs[0]?.requirement_id ? String(docs[0].requirement_id) : defaultReq, file: null });
    setOpen(true);
  };

  const upload = async () => {
    if (!form.file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', form.file);
      fd.append('project_id', String(p.id));
      fd.append('title', form.title);
      if (form.requirement) fd.append('requirement_id', form.requirement);
      const res = await fetch('/api/srs', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return notify(j.error?.message ?? res.statusText, 'error');
      setOpen(false);
      router.push(`/srs/${j.data.id}`);
    } finally {
      setBusy(false);
    }
  };

  const active = docs.find((d) => ['draft', 'signing', 'rejected'].includes(d.status));

  return (
    <div>
      <Section
        title={<span className="inline-flex items-center gap-2"><FileSignature className="size-4.5" /> {t('tab.title')}</span>}
        actions={perm.internal && <Button onClick={start}><Upload /> {docs.length ? t('tab.uploadNew') : t('tab.upload')}</Button>}
      >
        <p className="text-sm text-muted-foreground">{t('tab.note')}</p>
        {active && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border bg-secondary/40 p-3 text-sm">
            <StatusChip list={SRS_STATUSES} value={active.status} />
            <span className="font-medium">{active.title} V{active.version_no}</span>
            <span className="text-muted-foreground">{t('tab.progress', { signed: signers.filter((s) => s.srs_id === active.id && s.status === 'signed').length, total: signers.filter((s) => s.srs_id === active.id).length })}</span>
            <Button asChild size="sm" className="ml-auto"><Link href={`/srs/${active.id}`}>{t('tab.open')}</Link></Button>
          </div>
        )}
      </Section>

      <BoardGroup title={t('tab.versions')} color="#784bd1" count={docs.length}>
        {docs.length === 0 ? <EmptyState text={t('tab.empty')} /> : (
          <Table className="board-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.version')}</TableHead><TableHead className="text-left">{t('col.title')}</TableHead><TableHead>{t('col.status')}</TableHead>
                <TableHead className="text-left">{t('col.signers')}</TableHead><TableHead>{t('col.uploaded')}</TableHead><TableHead>{t('col.completed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => {
                const mine = signers.filter((s) => s.srs_id === d.id);
                return (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => router.push(`/srs/${d.id}`)}>
                    <TableCell className="text-center font-semibold">V{d.version_no}</TableCell>
                    <TableCell><Link href={`/srs/${d.id}`} className="font-medium text-primary hover:underline">{d.title}</Link><div className="text-xs text-muted-foreground">{d.file_name}</div></TableCell>
                    <TableCell className="p-1"><StatusChip list={SRS_STATUSES} value={d.status} fullWidth /></TableCell>
                    <TableCell className="whitespace-normal text-xs">
                      {mine.length === 0 ? '–' : mine.map((s) => (
                        <span key={s.id} className="mr-2 inline-flex items-center gap-1">
                          <span className="size-2 rounded-full" style={{ background: s.status === 'signed' ? '#00c875' : s.status === 'rejected' ? '#e2445c' : '#fdab3d' }} />
                          {profileName(s.signer_id)}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="text-center text-xs">{profileName(d.created_by)}<br />{fmtDateTime(d.created_at)}</TableCell>
                    <TableCell className="text-center text-xs">{fmtDateTime(d.completed_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </BoardGroup>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{docs.length ? t('upload.titleNew', { version: (docs[0]?.version_no ?? 0) + 1 }) : t('upload.title')}</DialogTitle>
            <DialogDescription>{docs.length ? t('upload.descriptionNew') : t('upload.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <TextField label={t('upload.docTitle')} required value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
            <div>
              <div className="mb-1 text-sm font-medium">{t('upload.file')} <span className="text-destructive">*</span></div>
              <input type="file" accept="application/pdf,.pdf" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-white file:px-3 file:py-1.5"
                onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
            </div>
            <SelectField label={t('upload.requirement')} value={form.requirement} onChange={(v) => setForm({ ...form, requirement: v })}
              options={reqOptions} allowEmpty helperText={t('upload.requirementHelp')} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
            <Button disabled={busy || !form.file || !form.title.trim()} onClick={upload}><Upload /> {t('upload.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
