'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';

/** "My signature": drawn once, then stamped on every SRS I approve */
export default function MySignatureDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const t = useTranslations('srs.signature');
  const { notify } = useApp();
  const pad = useRef<SignaturePadHandle>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch('/api/me/signature?check=1', { cache: 'no-store' }).then(async (c) => {
      const has = !!(await c.json()).data?.has_signature;
      const r = has ? await fetch('/api/me/signature', { cache: 'no-store' }) : null;
      if (!alive) return;
      const url = r?.ok ? URL.createObjectURL(await r.blob()) : null;
      setCurrent(url);
      setDrawing(!url);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const save = async () => {
    const image = pad.current?.toPng();
    if (!image) return;
    setBusy(true);
    try {
      const r = await fetch('/api/me/signature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return notify(j.error?.message ?? r.statusText, 'error');
      notify(t('saved'), 'success');
      onSaved?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/me/signature', { method: 'DELETE' });
      if (!r.ok) return notify(r.statusText, 'error');
      setCurrent(null);
      setDrawing(true);
      notify(t('removed'), 'success');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {current && !drawing ? (
          <div className="rounded-md border bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- private blob URL */}
            <img src={current} alt={t('title')} className="mx-auto max-h-36" />
          </div>
        ) : (
          <SignaturePad ref={pad} onChange={setEmpty} />
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {current && !drawing && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>{t('remove')}</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('close')}</Button>
            {current && !drawing
              ? <Button onClick={() => setDrawing(true)}>{t('redraw')}</Button>
              : <Button disabled={busy || empty} onClick={save}>{t('save')}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
