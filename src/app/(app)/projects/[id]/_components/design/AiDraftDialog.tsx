'use client';

import { Database, Sparkles, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type DiagramContent, type DiagramKind, ofKind } from '@/lib/diagram';

export function AiDraftDialog({ open, onOpenChange, projectId, current, onDraft }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: number; current: DiagramContent;
  onDraft: (d: { title: string; content: DiagramContent }, kind: DiagramKind, revise: boolean) => void;
}) {
  const t = useTranslations('design.ai');
  const tk = useTranslations('design.kind');
  const tc = useTranslations('common');
  const { notify } = useApp();
  const [prompt, setPrompt] = useState('');
  // default to whatever the canvas already has the most of
  const [kind, setKind] = useState<DiagramKind>(() => {
    const tables = current.nodes.filter((n) => n.type === 'entity').length;
    return tables > current.nodes.length - tables ? 'er' : 'flowchart';
  });
  const [revise, setRevise] = useState(true);
  const [busy, setBusy] = useState(false);
  const existing = ofKind(current, kind);
  const others = current.nodes.length - existing.nodes.length;

  const run = async () => {
    setBusy(true);
    const rev = revise && existing.nodes.length > 0;
    try {
      const j = await fetch(`/api/projects/${projectId}/diagram-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, prompt, current: rev ? existing : null }),
      }).then((r) => r.json());
      if (j.error) return notify(j.error.message, 'error');
      if (j.data?.off) return notify(t('off'), 'warning');
      onDraft(j.data, kind, rev);
      notify(t('done'));
      onOpenChange(false);
    } catch {
      notify(t('failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-[#a25ddc]" /> {t('button')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('what')}</Label>
            <div className="flex gap-2">
              {(['flowchart', 'er'] as const).map((k) => (
                <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)}>
                  {k === 'er' ? <Database /> : <Workflow />} {tk(k)}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diagram-prompt">{t('prompt')}</Label>
            <Textarea id="diagram-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={2000} placeholder={t(`placeholder.${kind}`)} />
          </div>
          {existing.nodes.length > 0 && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={revise} onCheckedChange={(v) => setRevise(!!v)} /> {t(`revise.${kind}`)}</label>
          )}
          {(others > 0 || (existing.nodes.length > 0 && !revise)) && (
            <p className="text-xs text-muted-foreground">{t('placedBeside')}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button disabled={busy} onClick={run}><Sparkles /> {busy ? t('running') : t('run')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
