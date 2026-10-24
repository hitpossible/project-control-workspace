'use client';

/** pdf.js, loaded on first use in the browser only (it needs the DOM and a worker) */
let lib: Promise<typeof import('pdfjs-dist')> | null = null;

export function pdfjs() {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    return m;
  });
  return lib;
}
