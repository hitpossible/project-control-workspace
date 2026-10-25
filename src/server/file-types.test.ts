import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './db';
import { checkEvidenceFile } from './file-types';

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

const rejects = (name: string, b: Buffer) => {
  try {
    checkEvidenceFile(name, b);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(415);
    return (e as AppError).message;
  }
  throw new Error(`${name} was accepted`);
};

describe('checkEvidenceFile', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['report.pdf', bytes('%PDF-1.7\n'), 'application/pdf'],
    ['photo.PNG', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'],
    ['photo.jpg', bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['anim.gif', bytes('GIF89a'), 'image/gif'],
    ['pic.webp', bytes('RIFF', [0, 0, 0, 0], 'WEBP'), 'image/webp'],
    ['spec.docx', bytes([0x50, 0x4b, 0x03, 0x04]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['old.xls', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'application/vnd.ms-excel'],
    ['mail.msg', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'application/vnd.ms-outlook'],
    ['bundle.7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), 'application/x-7z-compressed'],
    ['notes.txt', bytes('บันทึกการประชุม\nline 2'), 'text/plain'],
    ['data.csv', bytes('a,b\n1,2\n'), 'text/csv'],
    ['clip.mp4', bytes([0, 0, 0, 0x18], 'ftypmp42'), 'video/mp4'],
  ])('accepts %s as %s', (name, b, mime) => {
    expect(checkEvidenceFile(name, b)).toBe(mime);
  });

  it.each(['page.html', 'logo.svg', 'tool.exe', 'script.js', 'noextension'])('refuses %s by extension', (name) => {
    expect(rejects(name, bytes('anything'))).toMatch(/not accepted/);
  });

  it('refuses a file whose content does not match its extension', () => {
    expect(rejects('fake.pdf', bytes('<html><script>alert(1)</script>'))).toMatch(/does not look like a \.pdf/);
    expect(rejects('fake.png', bytes('%PDF-1.4'))).toMatch(/does not look like/);
    expect(rejects('fake.docx', bytes('MZ\x90\x00'))).toMatch(/does not look like/);
  });

  it('refuses markup or binary content in a text file', () => {
    expect(rejects('page.txt', bytes('  <!DOCTYPE html><script>x</script>'))).toMatch(/does not look like/);
    expect(rejects('img.txt', bytes('<svg onload="x">'))).toMatch(/does not look like/);
    expect(rejects('bin.csv', bytes('a,b', [0], 'c'))).toMatch(/does not look like/);
  });

  it('refuses an empty file', () => {
    expect(rejects('empty.pdf', Buffer.alloc(0))).toMatch(/empty/);
  });

  it('allows extra extensions from EVIDENCE_EXTRA_TYPES, stored as octet-stream', () => {
    expect(() => checkEvidenceFile('part.dwg', bytes('AC1032'))).toThrow();
    vi.stubEnv('EVIDENCE_EXTRA_TYPES', 'dwg, .step');
    expect(checkEvidenceFile('part.dwg', bytes('AC1032'))).toBe('application/octet-stream');
    expect(checkEvidenceFile('model.STEP', bytes('ISO-10303-21;'))).toBe('application/octet-stream');
  });
});
