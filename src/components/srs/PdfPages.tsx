'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { pdfjs } from '@/lib/pdfjs';

/**
 * All pages of a PDF, stacked at the container width. `overlay(pageNo, size)` is drawn on top of each page
 * (signature boxes); its coordinates are CSS pixels of the shown page, so boxes stored as fractions map 1:1.
 */
export default function PdfPages({ url, overlay, onLoaded }: {
  url: string;
  overlay?: (pageNo: number, size: { w: number; h: number }) => React.ReactNode;
  onLoaded?: (pages: number) => void;
}) {
  const t = useTranslations('srs');
  const wrap = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let alive = true;
    let task: { destroy: () => Promise<void> } | null = null;
    pdfjs()
      .then((m) => {
        const t = m.getDocument({ url, withCredentials: true });
        task = t;
        return t.promise;
      })
      .then((d) => {
        if (!alive) return;
        setError(false);
        setDoc(d);
        onLoaded?.(d.numPages);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      void task?.destroy();
    };
    // onLoaded is a notification only — reloading the file on every render would flicker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} className="w-full">
      {error && <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t('pdfError')}</div>}
      {!doc && !error && <div className="h-[70vh] animate-pulse rounded-md bg-muted" />}
      {doc && width > 0 && Array.from({ length: doc.numPages }, (_, i) => (
        <div key={`${url}:${i}`}>
          <PdfPage doc={doc} pageNo={i + 1} width={width} overlay={overlay} />
          <div className="mb-4 text-center text-xs text-muted-foreground">{t('pageOf', { page: i + 1, total: doc.numPages })}</div>
        </div>
      ))}
    </div>
  );
}

function PdfPage({ doc, pageNo, width, overlay }: {
  doc: PDFDocumentProxy; pageNo: number; width: number;
  overlay?: (pageNo: number, size: { w: number; h: number }) => React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let alive = true;
    doc.getPage(pageNo).then((page) => {
      if (!alive || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      setSize({ w: width, h: base.height * scale });
      task = page.render({ canvas: c, viewport: vp });
      task.promise.catch(() => undefined);
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, pageNo, width]);

  return (
    <div className="relative mx-auto mb-1.5 bg-white shadow-sm ring-1 ring-black/10" style={{ width, height: size?.h }} data-page={pageNo}>
      <canvas ref={canvas} className="block" style={{ width, height: size?.h }} />
      {size && overlay && <div className="absolute inset-0">{overlay(pageNo, size)}</div>}
    </div>
  );
}
