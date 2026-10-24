import 'server-only';
import { createHash } from 'node:crypto';
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { AppError, type Ctx, inList } from './db';
import { deleteRow, getRow, insertRow, updateRow } from './engine';
import { notifyEvent } from './logic/common';
import { canViewInternal, canViewProject } from './perms';
import { publishSrs } from './srs-bus';
import { getObjectBuffer, putObject, removeObject } from './storage';

/**
 * SRS sign-off: upload a PDF, place each signer's boxes, send for signing; every approval stamps that signer's
 * signature (+ name image + server date) into their boxes. The stamped file is always rebuilt from the untouched
 * original plus all signatures so far. Fully signed → verified evidence on the chosen checklist item.
 */
export type SrsDoc = {
  id: number; project_id: number; version_no: number; title: string; file_name: string;
  original_path: string; original_sha256: string; page_count: number; pages: { w: number; h: number }[];
  stamped_path: string | null; stamped_sha256: string | null; requirement_id: number | null; evidence_id: number | null;
  status: 'draft' | 'signing' | 'signed' | 'rejected' | 'cancelled' | 'superseded';
  created_by: number | null;
};
type Signer = {
  id: number; srs_id: number; signer_id: number; seq: number; role_label: string | null; status: 'pending' | 'signed' | 'rejected';
  signed_at: string | null; signature_path: string | null; name_image_path: string | null;
};
type Field = { id: number; signer_row_id: number; kind: 'signature' | 'name' | 'date'; page_no: number; x: number; y: number; w: number; h: number };

export const FIELD_KINDS = ['signature', 'name', 'date'] as const;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const blank = (s: unknown) => !s || String(s).trim() === '';
const folderOf = (doc: SrsDoc) => doc.original_path.slice(0, doc.original_path.lastIndexOf('/'));

// ---------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------
/** the internal team prepares the SRS (upload, boxes, send, cancel) */
export const canEditSrs = (ctx: Ctx, projectId: number) => canViewInternal(ctx, projectId);

/** anyone who sees the project, plus the signers (who may be outside the project, e.g. the requestor's manager) */
export async function canReadSrs(ctx: Ctx, doc: Pick<SrsDoc, 'id' | 'project_id'>) {
  if (await canViewProject(ctx, doc.project_id)) return true;
  return !!(await ctx.val('SELECT 1 FROM srs_signers WHERE srs_id = ? AND signer_id = ?', [doc.id, ctx.uid]));
}

export async function loadSrs(ctx: Ctx, id: number, lock = false): Promise<SrsDoc> {
  const doc = (await getRow(ctx, 'srs_documents', id, lock)) as unknown as SrsDoc | null;
  if (!doc || !(await canReadSrs(ctx, doc))) throw new AppError('SRS not found', 404);
  return doc;
}

// ---------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------
async function loadPdf(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) throw new AppError('The PDF is password protected — export it again without a password');
    throw new AppError('The file is not a readable PDF');
  }
}

const rotationOf = (page: PDFPage) => (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;

/** page size as a viewer shows it (rotation applied) — the frame the box fractions are relative to */
function displaySize(page: PDFPage) {
  const cb = page.getCropBox();
  return rotationOf(page) % 180 ? { w: cb.height, h: cb.width } : { w: cb.width, h: cb.height };
}

/** Draws in the displayed frame (u right, v down from the top-left), whatever the page rotation */
function frame(page: PDFPage) {
  const rot = rotationOf(page);
  const cb = page.getCropBox();
  const size = displaySize(page);
  const toPdf = (u: number, v: number) => {
    switch (rot) {
      case 90: return { x: cb.x + v, y: cb.y + u };
      case 180: return { x: cb.x + cb.width - u, y: cb.y + v };
      case 270: return { x: cb.x + cb.width - v, y: cb.y + cb.height - u };
      default: return { x: cb.x + u, y: cb.y + cb.height - v };
    }
  };
  return {
    size,
    /** image scaled to fit the box, centred, upright on screen */
    image(img: PDFImage, b: { u: number; v: number; w: number; h: number }) {
      const s = Math.min(b.w / img.width, b.h / img.height);
      const w = img.width * s;
      const h = img.height * s;
      const at = toPdf(b.u + (b.w - w) / 2, b.v + (b.h - h) / 2 + h);
      page.drawImage(img, { ...at, width: w, height: h, rotate: degrees(rot) });
    },
    /** one line of Latin text, centred in the box, shrunk to fit */
    text(str: string, font: PDFFont, b: { u: number; v: number; w: number; h: number }) {
      let size = Math.min(b.h * 0.6, 14);
      const width = font.widthOfTextAtSize(str, size);
      if (width > b.w * 0.95) size *= (b.w * 0.95) / width;
      const tw = font.widthOfTextAtSize(str, size);
      const at = toPdf(b.u + (b.w - tw) / 2, b.v + b.h / 2 + size * 0.35);
      page.drawText(str, { ...at, size, font, color: rgb(0.1, 0.12, 0.3), rotate: degrees(rot) });
    },
  };
}

/** server time, Bangkok — the date stamped next to a signature (digits only, so no Thai shaping needed) */
export function stampDate(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** data:image/png;base64,… → PNG bytes (checked) */
export function pngFromDataUrl(dataUrl: unknown): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new AppError('Expected a PNG image');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError('The image is too large');
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new AppError('Expected a PNG image');
  return buf;
}

/** Rebuild the stamped PDF: original + the boxes of everyone who has signed */
async function restamp(ctx: Ctx, doc: SrsDoc): Promise<Uint8Array> {
  const pdf = await loadPdf(await getObjectBuffer(doc.original_path));
  const signers = await ctx.q<Signer>(`SELECT * FROM srs_signers WHERE srs_id = ? AND status = 'signed'`, [doc.id]);
  const fields = await ctx.q<Field>('SELECT * FROM srs_fields WHERE srs_id = ?', [doc.id]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const s of signers) {
    const sig = s.signature_path ? await pdf.embedPng(await getObjectBuffer(s.signature_path)) : null;
    const name = s.name_image_path ? await pdf.embedPng(await getObjectBuffer(s.name_image_path)) : null;
    for (const f of fields.filter((x) => x.signer_row_id === s.id)) {
      const page = pages[f.page_no - 1];
      if (!page) continue;
      const fr = frame(page);
      const box = { u: f.x * fr.size.w, v: f.y * fr.size.h, w: f.w * fr.size.w, h: f.h * fr.size.h };
      if (f.kind === 'signature' && sig) fr.image(sig, box);
      else if (f.kind === 'name' && name) fr.image(name, box);
      else if (f.kind === 'date' && s.signed_at) fr.text(stampDate(s.signed_at), font, box);
    }
  }
  const bytes = await pdf.save();
  const key = `${folderOf(doc)}/stamped-${Date.now()}.pdf`;
  await putObject(key, Buffer.from(bytes), 'application/pdf');
  const old = doc.stamped_path;
  await ctx.asWorkflow(() => updateRow(ctx, 'srs_documents', doc.id, { stamped_path: key, stamped_sha256: sha256(bytes) }));
  if (old) ctx.onCommit(() => removeObject(old));
  return bytes;
}

// ---------------------------------------------------------------------
// Upload a new version
// ---------------------------------------------------------------------
export async function createSrs(ctx: Ctx, a: { projectId: number; title: string; requirementId: number | null; fileName: string; bytes: Buffer }) {
  if (!(await ctx.val('SELECT 1 FROM projects WHERE id = ?', [a.projectId]))) throw new AppError('Project not found', 404);
  if (!(await canEditSrs(ctx, a.projectId))) throw new AppError('Only the project team can upload the SRS', 403);
  if (blank(a.title)) throw new AppError('A title is required');
  if (a.requirementId && !(await ctx.val('SELECT 1 FROM evidence_requirements WHERE id = ? AND project_id = ?', [a.requirementId, a.projectId]))) {
    throw new AppError('The checklist item does not belong to this project');
  }
  const pdf = await loadPdf(a.bytes);
  const pages = pdf.getPages().map((p) => {
    const s = displaySize(p);
    return { w: Math.round(s.w * 100) / 100, h: Math.round(s.h * 100) / 100 };
  });
  if (!pages.length) throw new AppError('The PDF has no pages');

  // serialize version numbers per project
  await ctx.exec('SELECT id FROM projects WHERE id = ? FOR UPDATE', [a.projectId]);
  const n = Number(await ctx.val('SELECT COALESCE(MAX(version_no), 0) + 1 FROM srs_documents WHERE project_id = ?', [a.projectId]));
  const key = `project/${a.projectId}/srs/v${n}-${Date.now()}/original.pdf`;
  await putObject(key, a.bytes, 'application/pdf');

  try {
    const prev = await ctx.one<{ id: number }>(
      `SELECT d.id FROM srs_documents d WHERE d.project_id = ? AND EXISTS (SELECT 1 FROM srs_signers s WHERE s.srs_id = d.id)
        ORDER BY d.version_no DESC LIMIT 1`, [a.projectId]);
    const doc = (await insertRow(ctx, 'srs_documents', {
      project_id: a.projectId, version_no: n, title: a.title.trim(), file_name: a.fileName, original_path: key,
      original_sha256: sha256(a.bytes), page_count: pages.length, pages, requirement_id: a.requirementId, status: 'draft', created_by: ctx.uid,
    })) as unknown as SrsDoc;

    // one SRS in progress at a time: earlier drafts / unsigned versions are replaced by this one
    for (const old of await ctx.q<{ id: number }>(
      `SELECT id FROM srs_documents WHERE project_id = ? AND id <> ? AND status IN ('draft','signing','rejected')`, [a.projectId, doc.id])) {
      await ctx.asWorkflow(() => updateRow(ctx, 'srs_documents', old.id, { status: 'superseded' }));
      publishSrs(old.id, { type: 'changed', by: ctx.uid ?? 0, action: 'cancelled' });
    }

    // start from the previous version's signers and boxes (boxes on pages that no longer exist are dropped)
    if (prev) {
      const fields = await ctx.q<Field>('SELECT * FROM srs_fields WHERE srs_id = ?', [prev.id]);
      for (const s of await ctx.q<Signer>('SELECT * FROM srs_signers WHERE srs_id = ? ORDER BY seq', [prev.id])) {
        const row = await insertRow(ctx, 'srs_signers', { srs_id: doc.id, project_id: a.projectId, signer_id: s.signer_id, seq: s.seq, role_label: s.role_label });
        for (const f of fields.filter((x) => x.signer_row_id === s.id && x.page_no <= pages.length)) {
          await insertRow(ctx, 'srs_fields', { srs_id: doc.id, signer_row_id: row.id, kind: f.kind, page_no: f.page_no, x: f.x, y: f.y, w: f.w, h: f.h });
        }
      }
    }
    return doc;
  } catch (e) {
    await removeObject(key).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------------
// Layout (draft only)
// ---------------------------------------------------------------------
type LayoutInput = { signer_id: number; role_label?: string | null; fields: { kind: string; page_no: number; x: number; y: number; w: number; h: number }[] }[];

export async function saveSrsLayout(ctx: Ctx, a: { p_srs_id: number; p_signers: LayoutInput }) {
  const doc = await loadSrs(ctx, Number(a.p_srs_id), true);
  if (!(await canEditSrs(ctx, doc.project_id))) throw new AppError('Only the project team can place signature boxes', 403);
  if (doc.status !== 'draft') throw new AppError('Signature boxes can only be changed before the SRS is sent for signing');
  const list = Array.isArray(a.p_signers) ? a.p_signers : [];
  const ids = list.map((s) => Number(s.signer_id));
  if (new Set(ids).size !== ids.length) throw new AppError('A person can only be a signer once');
  if (ids.length) {
    const [ph, params] = inList(ids);
    const active = Number(await ctx.val(`SELECT COUNT(*) FROM profiles WHERE is_active = 1 AND id IN (${ph})`, params));
    if (active !== ids.length) throw new AppError('Every signer must be an active user');
  }
  const num = (v: unknown) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 1e6) / 1e6;

  for (const s of await ctx.q<{ id: number }>('SELECT id FROM srs_signers WHERE srs_id = ?', [doc.id])) await deleteRow(ctx, 'srs_signers', s.id);
  for (const [i, s] of list.entries()) {
    const row = await insertRow(ctx, 'srs_signers', {
      srs_id: doc.id, project_id: doc.project_id, signer_id: Number(s.signer_id), seq: i + 1, role_label: blank(s.role_label) ? null : String(s.role_label).trim().slice(0, 100),
    });
    for (const f of Array.isArray(s.fields) ? s.fields : []) {
      if (!FIELD_KINDS.includes(f.kind as Field['kind'])) throw new AppError(`Unknown box type ${f.kind}`);
      const page = Number(f.page_no);
      if (!Number.isInteger(page) || page < 1 || page > doc.page_count) throw new AppError('A box is outside the document pages');
      const x = num(f.x);
      const y = num(f.y);
      const w = Math.min(num(f.w), 1 - x);
      const h = Math.min(num(f.h), 1 - y);
      if (w < 0.005 || h < 0.003) throw new AppError('A box is too small');
      await insertRow(ctx, 'srs_fields', { srs_id: doc.id, signer_row_id: row.id, kind: f.kind, page_no: page, x, y, w, h });
    }
  }
  publishSrs(doc.id, { type: 'changed', by: ctx.uid ?? 0, action: 'layout' });
  return { ok: true };
}

// ---------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------
async function projectCode(ctx: Ctx, projectId: number) {
  return (await ctx.val<string>('SELECT project_code FROM projects WHERE id = ?', [projectId])) ?? '';
}

export async function sendSrs(ctx: Ctx, a: { p_srs_id: number }) {
  const doc = await loadSrs(ctx, Number(a.p_srs_id), true);
  if (!(await canEditSrs(ctx, doc.project_id))) throw new AppError('Only the project team can send the SRS for signing', 403);
  if (doc.status !== 'draft') throw new AppError(`The SRS is already ${doc.status}`);
  const signers = await ctx.q<Signer & { boxes: number }>(
    `SELECT s.*, (SELECT COUNT(*) FROM srs_fields f WHERE f.signer_row_id = s.id AND f.kind = 'signature') boxes
       FROM srs_signers s WHERE s.srs_id = ? ORDER BY s.seq`, [doc.id]);
  if (!signers.length) throw new AppError('Add at least one signer');
  const noBox = signers.filter((s) => Number(s.boxes) === 0).map((s) => s.signer_id);
  if (noBox.length) {
    const [ph, params] = inList(noBox);
    const names = (await ctx.q<{ full_name: string }>(`SELECT full_name FROM profiles WHERE id IN (${ph})`, params)).map((p) => p.full_name);
    throw new AppError(`Place a signature box for: ${names.join(', ')}`);
  }
  await ctx.asWorkflow(() => updateRow(ctx, 'srs_documents', doc.id, { status: 'signing', sent_at: new Date().toISOString() }));
  const code = await projectCode(ctx, doc.project_id);
  await notifyEvent(ctx, {
    event: 'srs_sign_requested', projectId: doc.project_id, explicit: signers.map((s) => s.signer_id),
    title: `SRS waiting for your signature: ${code} ${doc.title} V${doc.version_no}`, body: `Requested by ${ctx.me?.full_name ?? '-'}`,
    link: `/srs/${doc.id}`, dedupe: `srs_sign:${doc.id}`,
  });
  publishSrs(doc.id, { type: 'changed', by: ctx.uid ?? 0, action: 'sent' });
  return { ok: true };
}

export async function signSrs(ctx: Ctx, a: { srsId: number; nameImage: Buffer | null; ip: string | null; userAgent: string | null }) {
  const doc = await loadSrs(ctx, a.srsId, true);
  if (doc.status !== 'signing') throw new AppError(doc.status === 'draft' ? 'The SRS has not been sent for signing yet' : `The SRS is ${doc.status}`);
  const me = await ctx.one<Signer>('SELECT * FROM srs_signers WHERE srs_id = ? AND signer_id = ? FOR UPDATE', [doc.id, ctx.uid]);
  if (!me) throw new AppError('You are not a signer of this SRS', 403);
  if (me.status !== 'pending') throw new AppError(`You have already ${me.status === 'signed' ? 'signed' : 'sent it back'}`);
  const sigPath = await ctx.val<string>('SELECT signature_path FROM profiles WHERE id = ?', [ctx.uid]);
  if (!sigPath) throw new AppError('Set up your signature first (My signature)');
  const needsName = !!(await ctx.val(`SELECT 1 FROM srs_fields WHERE signer_row_id = ? AND kind = 'name' LIMIT 1`, [me.id]));
  if (needsName && !a.nameImage) throw new AppError('The name image is missing');

  // the signature and name as they were at signing time — a later change of "My signature" does not alter this SRS
  const folder = folderOf(doc);
  const sigKey = `${folder}/signer-${me.id}-signature.png`;
  await putObject(sigKey, await getObjectBuffer(sigPath), 'image/png');
  let nameKey: string | null = null;
  if (needsName && a.nameImage) {
    nameKey = `${folder}/signer-${me.id}-name.png`;
    await putObject(nameKey, a.nameImage, 'image/png');
  }
  await ctx.asWorkflow(() => updateRow(ctx, 'srs_signers', me.id, {
    status: 'signed', signed_at: new Date().toISOString(), signature_path: sigKey, name_image_path: nameKey,
    doc_sha256: doc.original_sha256, ip: a.ip?.slice(0, 64) ?? null, user_agent: a.userAgent?.slice(0, 300) ?? null,
  }));

  const bytes = await restamp(ctx, doc);
  const left = Number(await ctx.val(`SELECT COUNT(*) FROM srs_signers WHERE srs_id = ? AND status <> 'signed'`, [doc.id]));
  if (left === 0) await complete(ctx, (await getRow(ctx, 'srs_documents', doc.id)) as unknown as SrsDoc, bytes);
  publishSrs(doc.id, { type: 'changed', by: ctx.uid ?? 0, action: 'signed' });
  return { ok: true, completed: left === 0 };
}

/** Everyone signed: the stamped file becomes verified evidence and earlier signed versions are superseded */
async function complete(ctx: Ctx, doc: SrsDoc, bytes: Uint8Array) {
  const now = new Date().toISOString();
  const req = doc.requirement_id
    ? await ctx.one<{ entity_type: string; entity_id: number }>('SELECT entity_type, entity_id FROM evidence_requirements WHERE id = ?', [doc.requirement_id])
    : null;
  // own copy: deleting the evidence row removes its file, which must not take the SRS file with it
  const key = `${folderOf(doc)}/signed-${Date.now()}.pdf`;
  await putObject(key, Buffer.from(bytes), 'application/pdf');
  const base = doc.file_name.replace(/\.pdf$/i, '');
  const ev = await ctx.asWorkflow(() => insertRow(ctx, 'evidence', {
    project_id: doc.project_id, entity_type: req?.entity_type ?? 'project', entity_id: req?.entity_id ?? doc.project_id,
    evidence_type: 'pdf', file_name: `${base} (V${doc.version_no} signed).pdf`, storage_path: key, mime_type: 'application/pdf', file_size: bytes.length,
    description: `${doc.title} V${doc.version_no} — signed in the system`, is_required: !!req, is_internal: false,
    verification_status: 'verified', verified_by: ctx.uid, verified_at: now, requirement_id: doc.requirement_id, uploaded_by: doc.created_by,
  }));
  await ctx.asWorkflow(async () => {
    await updateRow(ctx, 'srs_documents', doc.id, { status: 'signed', completed_at: now, evidence_id: ev.id });
    for (const old of await ctx.q<{ id: number }>(`SELECT id FROM srs_documents WHERE project_id = ? AND id <> ? AND status = 'signed'`, [doc.project_id, doc.id])) {
      await updateRow(ctx, 'srs_documents', old.id, { status: 'superseded' });
    }
  });
  const code = await projectCode(ctx, doc.project_id);
  await notifyEvent(ctx, {
    event: 'srs_signed', projectId: doc.project_id, explicit: [doc.created_by],
    title: `SRS fully signed: ${code} ${doc.title} V${doc.version_no}`, body: 'All signers have signed. The signed PDF is attached as evidence.',
    link: `/srs/${doc.id}`, dedupe: `srs_signed:${doc.id}`,
  });
}

export async function rejectSrs(ctx: Ctx, a: { p_srs_id: number; p_comment: string }) {
  const doc = await loadSrs(ctx, Number(a.p_srs_id), true);
  if (doc.status !== 'signing') throw new AppError(`The SRS is ${doc.status}`);
  if (blank(a.p_comment)) throw new AppError('Tell the team what needs to change');
  const me = await ctx.one<Signer>('SELECT * FROM srs_signers WHERE srs_id = ? AND signer_id = ? FOR UPDATE', [doc.id, ctx.uid]);
  if (!me || me.status !== 'pending') throw new AppError('You are not waiting to sign this SRS', 403);
  await ctx.asWorkflow(async () => {
    await updateRow(ctx, 'srs_signers', me.id, { status: 'rejected', signed_at: new Date().toISOString(), comment: String(a.p_comment).trim() });
    await updateRow(ctx, 'srs_documents', doc.id, { status: 'rejected' });
  });
  const code = await projectCode(ctx, doc.project_id);
  await notifyEvent(ctx, {
    event: 'srs_rejected', projectId: doc.project_id, explicit: [doc.created_by],
    title: `SRS sent back: ${code} ${doc.title} V${doc.version_no}`, body: `${ctx.me?.full_name ?? '-'}: ${String(a.p_comment).trim()}`,
    link: `/srs/${doc.id}`, dedupe: `srs_rejected:${doc.id}:${me.id}`,
  });
  publishSrs(doc.id, { type: 'changed', by: ctx.uid ?? 0, action: 'rejected' });
  return { ok: true };
}

export async function cancelSrs(ctx: Ctx, a: { p_srs_id: number }) {
  const doc = await loadSrs(ctx, Number(a.p_srs_id), true);
  if (!(await canEditSrs(ctx, doc.project_id))) throw new AppError('Only the project team can cancel the SRS', 403);
  if (!['draft', 'signing', 'rejected'].includes(doc.status)) throw new AppError(`The SRS is already ${doc.status}`);
  await ctx.asWorkflow(() => updateRow(ctx, 'srs_documents', doc.id, { status: 'cancelled' }));
  publishSrs(doc.id, { type: 'changed', by: ctx.uid ?? 0, action: 'cancelled' });
  return { ok: true };
}

// ---------------------------------------------------------------------
// The user's own signature
// ---------------------------------------------------------------------
export async function saveMySignature(ctx: Ctx, png: Buffer | null) {
  const old = await ctx.val<string>('SELECT signature_path FROM profiles WHERE id = ? FOR UPDATE', [ctx.uid]);
  let key: string | null = null;
  if (png) {
    key = `signatures/${ctx.uid}/${Date.now()}.png`;
    await putObject(key, png, 'image/png');
  }
  await ctx.exec('UPDATE profiles SET signature_path = ?, signature_updated_at = ? WHERE id = ?',
    [key, png ? new Date().toISOString().replace('T', ' ').replace('Z', '') : null, ctx.uid]);
  if (old) ctx.onCommit(() => removeObject(old));
  return { has_signature: !!key };
}

