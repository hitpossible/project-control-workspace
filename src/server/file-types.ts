import { AppError } from './db';

/**
 * Evidence uploads: only document / image / archive types on this list, and the file's first bytes must match its
 * extension (a renamed .html or .exe is refused). The stored MIME type comes from here, never from the browser.
 * EVIDENCE_EXTRA_TYPES (e.g. "dwg,step") allows more extensions; they are stored as application/octet-stream
 * and always download.
 */
type Kind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'zip' | 'ole' | '7z' | 'rar' | 'text' | 'mp4' | 'any';

const TYPES: Record<string, { mime: string; kind: Kind }> = {
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  png: { mime: 'image/png', kind: 'png' },
  jpg: { mime: 'image/jpeg', kind: 'jpeg' },
  jpeg: { mime: 'image/jpeg', kind: 'jpeg' },
  gif: { mime: 'image/gif', kind: 'gif' },
  webp: { mime: 'image/webp', kind: 'webp' },
  bmp: { mime: 'image/bmp', kind: 'bmp' },
  // Office Open XML = zip, legacy Office / Outlook .msg = OLE compound file
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'zip' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'zip' },
  xlsm: { mime: 'application/vnd.ms-excel.sheet.macroEnabled.12', kind: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'zip' },
  doc: { mime: 'application/msword', kind: 'ole' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'ole' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'ole' },
  msg: { mime: 'application/vnd.ms-outlook', kind: 'ole' },
  zip: { mime: 'application/zip', kind: 'zip' },
  '7z': { mime: 'application/x-7z-compressed', kind: '7z' },
  rar: { mime: 'application/vnd.rar', kind: 'rar' },
  txt: { mime: 'text/plain', kind: 'text' },
  log: { mime: 'text/plain', kind: 'text' },
  csv: { mime: 'text/csv', kind: 'text' },
  sql: { mime: 'text/plain', kind: 'text' },
  json: { mime: 'application/json', kind: 'text' },
  eml: { mime: 'message/rfc822', kind: 'text' },
  mp4: { mime: 'video/mp4', kind: 'mp4' },
};

function extra(): string[] {
  return (process.env.EVIDENCE_EXTRA_TYPES ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
}

const starts = (b: Buffer, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Buffer, s: string, at = 0) => b.subarray(at, at + s.length).toString('latin1') === s;

function matches(kind: Kind, b: Buffer): boolean {
  switch (kind) {
    case 'pdf': return ascii(b, '%PDF-');
    case 'png': return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg': return starts(b, [0xff, 0xd8, 0xff]);
    case 'gif': return ascii(b, 'GIF87a') || ascii(b, 'GIF89a');
    case 'webp': return ascii(b, 'RIFF') && ascii(b, 'WEBP', 8);
    case 'bmp': return ascii(b, 'BM');
    case 'zip': return starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06]);
    case 'ole': return starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case '7z': return starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    case 'rar': return ascii(b, 'Rar!');
    case 'mp4': return ascii(b, 'ftyp', 4);
    // plain text: no NUL bytes, and not markup a browser would run
    case 'text': {
      const head = b.subarray(0, 4096);
      if (head.includes(0)) return false;
      return !/^\s*<(?:!doctype|html|svg|script)/i.test(head.toString('utf8'));
    }
    case 'any': return true;
  }
}

/** Checks an uploaded evidence file; returns the MIME type to store, or throws 415 */
export function checkEvidenceFile(fileName: string, bytes: Buffer): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const type = TYPES[ext] ?? (extra().includes(ext) ? { mime: 'application/octet-stream', kind: 'any' as const } : null);
  if (!type) throw new AppError(`.${ext || '?'} files are not accepted. Allowed: ${[...Object.keys(TYPES), ...extra()].join(', ')}`, 415);
  if (!bytes.length) throw new AppError('The file is empty', 415);
  if (!matches(type.kind, bytes)) throw new AppError(`"${fileName}" does not look like a .${ext} file`, 415);
  return type.mime;
}
