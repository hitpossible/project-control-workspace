'use client';

/** Ink colour of everything stamped on an SRS (the server draws the date in the same colour) */
export const INK = '#1a1f4d';

/** Canvas → PNG data URL cropped to what was drawn (+ padding); null when the canvas is empty */
export function trimmedPng(src: HTMLCanvasElement, pad = 8): string | null {
  const ctx = src.getContext('2d');
  if (!ctx) return null;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/**
 * The signer's name (and position) as a PNG. Drawn by the browser so Thai vowels and tone marks are placed
 * correctly — PDF text drawing on the server does not shape Thai.
 */
export async function nameImage(name: string, position?: string | null): Promise<string> {
  const family = getComputedStyle(document.body).getPropertyValue('--font-sarabun').trim() || 'sans-serif';
  await Promise.all([document.fonts.load(`600 64px ${family}`, name), document.fonts.load(`400 44px ${family}`, position || 'ก')]).catch(() => undefined);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const line1 = `(${name})`;
  const f1 = `600 64px ${family}`;
  const f2 = `400 44px ${family}`;
  ctx.font = f1;
  const w1 = ctx.measureText(line1).width;
  ctx.font = f2;
  const w2 = position ? ctx.measureText(position).width : 0;
  c.width = Math.ceil(Math.max(w1, w2)) + 40;
  c.height = position ? 160 : 100;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = f1;
  ctx.fillText(line1, c.width / 2, 50);
  if (position) {
    ctx.font = f2;
    ctx.fillText(position, c.width / 2, 120);
  }
  return trimmedPng(c, 4) ?? c.toDataURL('image/png');
}
