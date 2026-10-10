'use client';

import { BadgeCheck, ExternalLink, Link2, Paperclip, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { EVIDENCE_TYPES, optLabel } from '@/lib/constants';
import { errMsg, fmtDateTime } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { EntityType, Evidence, EvidenceRequirement } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { EmptyState, SelectField, TextField, Tip } from './common';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

function guessType(file: File): string {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx?|csv)$/.test(n)) return 'excel';
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return 'screenshot';
  if (/\.(log|txt)$/.test(n)) return 'log';
  if (/\.(eml|msg)$/.test(n)) return 'email';
  if (/\.(docx?|pptx?)$/.test(n)) return 'document';
  return 'other';
}

const VERIFY_STYLE: Record<string, string> = {
  verified: 'bg-[#00c875] text-white',
  rejected: 'bg-[#e2445c] text-white',
  pending: 'bg-[#c4c4c4] text-[#323338]',
};

export default function EvidencePanel({
  entityType, entityId, projectId, requestId, canAdd, canVerify, defaultInternal = true, allowPublicToggle = false, onChange, compact, requirements = [], reloadKey,
}: {
  entityType: EntityType; entityId: string; projectId?: string | null; requestId?: string | null;
  canAdd: boolean; canVerify?: boolean; defaultInternal?: boolean; allowPublicToggle?: boolean;
  onChange?: () => void; compact?: boolean;
  /** checklist items this evidence can satisfy */
  requirements?: EvidenceRequirement[]; reloadKey?: number;
}) {
  const supabase = supabaseBrowser();
  const { me, profileName, notify } = useApp();
  const [items, setItems] = useState<Evidence[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ url: '', file_name: '', evidence_type: 'sharepoint', description: '' });
  const [internal, setInternal] = useState(defaultInternal);
  const [busy, setBusy] = useState(false);
  const [reqId, setReqId] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('evidence').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('uploaded_at');
    setItems((data ?? []) as Evidence[]);
  }, [supabase, entityType, entityId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load, reloadKey]);

  const base = {
    entity_type: entityType, entity_id: entityId,
    project_id: projectId ?? null, request_id: requestId ?? null,
    uploaded_by: me?.id, is_internal: allowPublicToggle ? internal : defaultInternal,
    is_required: !!reqId, verification_status: 'pending', requirement_id: reqId || null,
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const folder = projectId ? `project/${projectId}` : `request/${requestId}`;
        const path = `${folder}/${entityType}-${entityId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
        const up = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type || undefined });
        if (up.error) throw up.error;
        const ins = await supabase.from('evidence').insert({
          ...base, evidence_type: guessType(file), file_name: file.name, storage_path: path,
          mime_type: file.type || null, file_size: file.size, url: null, description: null,
        });
        if (ins.error) {
          await supabase.storage.from('evidence').remove([path]);
          throw ins.error;
        }
      }
      notify('Evidence uploaded');
      setReqId('');
      await load();
      onChange?.();
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addLink = async () => {
    const { error } = await supabase.from('evidence').insert({
      ...base, evidence_type: link.evidence_type, url: link.url.trim(), file_name: link.file_name.trim() || link.url.trim(),
      description: link.description.trim() || null, storage_path: null, mime_type: null, file_size: null,
    });
    if (error) return notify(errMsg(error), 'error');
    setLinkOpen(false);
    setLink({ url: '', file_name: '', evidence_type: 'sharepoint', description: '' });
    notify('Link added');
    setReqId('');
    await load();
    onChange?.();
  };

  const open = async (ev: Evidence) => {
    if (ev.url) return window.open(ev.url, '_blank', 'noopener');
    const { data, error } = await supabase.storage.from('evidence').createSignedUrl(ev.storage_path!, 300);
    if (error) return notify(errMsg(error), 'error');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const verify = async (ev: Evidence, status: 'verified' | 'rejected') => {
    const { error } = await supabase.from('evidence')
      .update({ verification_status: status, verified_by: me?.id, verified_at: new Date().toISOString() }).eq('id', ev.id);
    if (error) return notify(errMsg(error), 'error');
    await load();
  };

  const remove = async (ev: Evidence) => {
    if (!confirm(`Remove evidence "${ev.file_name ?? ev.url}"?`)) return;
    const { error } = await supabase.from('evidence').delete().eq('id', ev.id);
    if (error) return notify(errMsg(error), 'error');
    if (ev.storage_path) await supabase.storage.from('evidence').remove([ev.storage_path]);
    await load();
    onChange?.();
  };

  return (
    <div>
      {canAdd && (
        <div className="no-print mb-2 flex flex-wrap items-center gap-2">
          {requirements.length > 0 && (
            <SelectField className="w-64" value={reqId} allowEmpty placeholder="Satisfies checklist item…" onChange={setReqId}
              options={requirements.map((r) => ({ value: r.id, label: `${r.is_mandatory ? '★ ' : ''}${r.name}` }))} />
          )}
          <Button variant="outline" size="sm" asChild disabled={busy}>
            <label className="cursor-pointer">
              <Paperclip /> {busy ? 'Uploading…' : 'Upload file'}
              <input hidden type="file" multiple onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            </label>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}><Link2 /> Add link</Button>
          {allowPublicToggle && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={!internal} onCheckedChange={(c) => setInternal(!c)} /> Visible to User / Management
            </label>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState text="No evidence attached" />
      ) : (
        <Table className="board-table">
          {!compact && (
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">File / Link</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead className="no-print" />
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {items.map((ev) => (
              <TableRow key={ev.id}>
                <TableCell className="max-w-80">
                  <button type="button" onClick={() => open(ev)} className="flex max-w-full items-center gap-1 text-left font-medium text-primary hover:underline">
                    <span className="truncate">{ev.file_name ?? ev.url}</span>
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                  {ev.requirement_id && <span className="mr-1 rounded bg-[#cce5ff] px-1.5 text-[10px] text-[#0060b9]">✓ {requirements.find((r) => r.id === ev.requirement_id)?.name ?? 'Checklist'}</span>}
                  {!ev.is_internal && <span className="mr-1 rounded bg-secondary px-1.5 text-[10px]">Shared</span>}
                  {ev.description && <span className="text-xs text-muted-foreground">{ev.description}</span>}
                </TableCell>
                <TableCell className="text-center">{optLabel(EVIDENCE_TYPES, ev.evidence_type)}</TableCell>
                <TableCell className="text-center">
                  <div className="text-xs">{profileName(ev.uploaded_by)}</div>
                  <div className="text-xs text-muted-foreground">{fmtDateTime(ev.uploaded_at)}</div>
                </TableCell>
                <TableCell className="p-1 text-center">
                  <span className={cn('inline-flex h-7 w-full min-w-24 items-center justify-center rounded text-[13px] capitalize', VERIFY_STYLE[ev.verification_status])}>{ev.verification_status}</span>
                </TableCell>
                <TableCell className="no-print text-right whitespace-nowrap">
                  {canVerify && ev.verification_status !== 'verified' && (
                    <Tip title="Mark verified"><Button variant="ghost" size="icon-sm" className="text-[#00854d]" onClick={() => verify(ev, 'verified')}><BadgeCheck /></Button></Tip>
                  )}
                  {canVerify && ev.verification_status === 'pending' && (
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => verify(ev, 'rejected')}>Reject</Button>
                  )}
                  {(ev.uploaded_by === me?.id || canVerify) && (
                    <Tip title="Remove"><Button variant="ghost" size="icon-sm" onClick={() => remove(ev)}><Trash2 /></Button></Tip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add evidence link</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <SelectField label="Type" value={link.evidence_type} onChange={(v) => setLink({ ...link, evidence_type: v })} options={EVIDENCE_TYPES} />
            <TextField label="URL" required value={link.url} onChange={(v) => setLink({ ...link, url: v })} placeholder="https://…" />
            <TextField label="Title" value={link.file_name} onChange={(v) => setLink({ ...link, file_name: v })} />
            <TextField label="Description" value={link.description} onChange={(v) => setLink({ ...link, description: v })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button disabled={!/^https?:\/\//.test(link.url.trim())} onClick={addLink}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
