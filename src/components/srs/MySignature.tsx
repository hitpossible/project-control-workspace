'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { Button } from '@/components/ui/button';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';

/** "My signature" editor: shows the saved one, or a pad to draw it. Loads whenever `active` turns on. */
export default function MySignature({ active = true, onSaved, actions }: { active?: boolean; onSaved?: () => void; actions?: React.ReactNode }) {
  const t = useTranslations('srs.signature');
  const { notify } = useApp();
  const pad = useRef<SignaturePadHandle>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let url: string | null = null;
    fetch('/api/me/signature?check=1', { cache: 'no-store' }).then(async (c) => {
      const has = !!(await c.json()).data?.has_signature;
      const r = has ? await fetch('/api/me/signature', { cache: 'no-store' }) : null;
      if (!alive) return;
      url = r?.ok ? URL.createObjectURL(await r.blob()) : null;
      setCurrent(url);
      setDrawing(!url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [active]);

  const save = async () => {
    const image = pad.current?.toPng();
    if (!image) return;
    setBusy(true);
    try {
      const r = await fetch('/api/me/signature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return notify(j.error?.message ?? r.statusText, 'error');
      notify(t('saved'), 'success');
      setCurrent(image);
      setDrawing(false);
      onSaved?.();
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
    <div className="space-y-4">
      {current && !drawing ? (
        <div className="rounded-md border bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- private blob / data URL */}
          <img src={current} alt={t('title')} className="mx-auto max-h-36" />
        </div>
      ) : (
        <SignaturePad ref={pad} onChange={setEmpty} />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <div>
          {current && !drawing && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>{t('remove')}</Button>}
          {current && drawing && <Button variant="ghost" disabled={busy} onClick={() => setDrawing(false)}>{t('cancel')}</Button>}
        </div>
        <div className="flex gap-2">
          {actions}
          {current && !drawing
            ? <Button onClick={() => setDrawing(true)}>{t('redraw')}</Button>
            : <Button disabled={busy || empty} onClick={save}>{t('save')}</Button>}
        </div>
      </div>
    </div>
  );
}
