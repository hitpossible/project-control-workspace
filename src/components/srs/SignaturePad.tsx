'use client';

import { Eraser, ImageUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { INK, trimmedPng } from './ink';

export type SignaturePadHandle = { toPng: () => string | null; clear: () => void };

const W = 900;
const H = 300;

/** Draw a signature with a finger, pen or mouse (or load a picture of one); exported as a trimmed transparent PNG */
const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const t = useTranslations('srs.signature');
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  const mark = useCallback((e: boolean) => {
    setEmpty(e);
    onChange?.(e);
  }, [onChange]);

  const clear = useCallback(() => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, W, H);
    mark(true);
  }, [mark]);

  useImperativeHandle(ref, () => ({ toPng: () => (canvas.current && !empty ? trimmedPng(canvas.current) : null), clear }), [empty, clear]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    if (empty) mark(false);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    // coalesced events keep fast strokes smooth on tablets
    for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
      const r = e.currentTarget.getBoundingClientRect();
      const p = { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
      const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
    }
  };

  const up = () => {
    last.current = null;
  };

  const load = (f: File | undefined) => {
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.current!.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      const s = Math.min(W / img.width, H / img.height) * 0.9;
      ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
      // a white background in a photo or scan becomes transparent
      const d = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < d.data.length; i += 4) if (d.data[i] > 225 && d.data[i + 1] > 225 && d.data[i + 2] > 225) d.data[i + 3] = 0;
      ctx.putImageData(d, 0, 0);
      URL.revokeObjectURL(img.src);
      mark(false);
    };
    img.src = URL.createObjectURL(f);
  };

  return (
    <div>
      <div className="relative rounded-md border-2 border-dashed bg-white">
        <canvas ref={canvas} width={W} height={H} className="block aspect-[3/1] w-full cursor-crosshair touch-none"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        <div className="pointer-events-none absolute inset-x-8 bottom-[22%] border-b border-muted-foreground/30" />
        {empty && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('drawHere')}</div>}
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear}><Eraser /> {t('clear')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}><ImageUp /> {t('upload')}</Button>
        <input ref={file} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
});

export default SignaturePad;
