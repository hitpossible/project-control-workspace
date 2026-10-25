import { withUser } from '@/server/api';
import { AppError, type Row, withCtx } from '@/server/db';
import { insertRow } from '@/server/engine';
import { checkEvidenceFile } from '@/server/file-types';
import { POLICIES } from '@/server/policies';
import { putObject, removeObject } from '@/server/storage';

const MAX_BYTES = Number(process.env.EVIDENCE_MAX_MB ?? 50) * 1024 * 1024;

/**
 * Upload one evidence file: multipart form with "file" + "meta" (JSON evidence row without storage fields).
 * The access policy is checked before the object is stored; the row insert runs the usual hooks.
 */
export const POST = withUser(async (me, req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('No file uploaded');
  if (file.size > MAX_BYTES) throw new AppError(`File is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = checkEvidenceFile(file.name, bytes);
  const meta = JSON.parse(String(form.get('meta') ?? '{}')) as Row;
  const folder = meta.project_id ? `project/${meta.project_id}` : `request/${meta.request_id}`;
  const key = `${folder}/${meta.entity_type}-${meta.entity_id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;

  return withCtx(me, async (ctx) => {
    const row: Row = { ...meta, file_name: file.name, storage_path: key, mime_type: mime, file_size: file.size, url: null };
    if (!(await POLICIES.evidence.insert!(ctx, row))) throw new AppError('Not allowed to add evidence here', 403);
    await putObject(key, bytes, mime);
    try {
      return { data: await insertRow(ctx, 'evidence', row) };
    } catch (e) {
      await removeObject(key).catch(() => undefined);
      throw e;
    }
  });
});
