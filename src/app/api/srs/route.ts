import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { createSrs } from '@/server/srs';

const MAX_BYTES = Number(process.env.EVIDENCE_MAX_MB ?? 50) * 1024 * 1024;

/** Upload a new SRS version: multipart "file" (PDF) + project_id, title, requirement_id (optional) */
export const POST = withUser(async (me, req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('No file uploaded');
  if (file.size > MAX_BYTES) throw new AppError(`File is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('The SRS must be a PDF file');
  const requirementId = Number(form.get('requirement_id')) || null;
  const doc = await withCtx(me, (ctx) => createSrs(ctx, {
    projectId: Number(form.get('project_id')), title: String(form.get('title') ?? ''), requirementId, fileName: file.name, bytes,
  }));
  // storage keys stay on the server (same as the data API, which hides them)
  const data: Partial<typeof doc> = { ...doc };
  delete data.original_path;
  delete data.stamped_path;
  return { data };
});
