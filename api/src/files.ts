import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './orders.js';

/** Licence documents: PDFs and images only, up to 10 MB, checked by their first bytes as well as their type. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const KINDS = {
  'application/pdf': { ext: 'pdf', magic: (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  'image/jpeg': { ext: 'jpg', magic: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': {
    ext: 'webp',
    magic: (b: Uint8Array) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  },
} as const;
export type FileKind = keyof typeof KINDS;
export const FILE_TYPES = Object.keys(KINDS) as [FileKind, ...FileKind[]];

export const FileRef = z.object({
  key: z.string().regex(/^licences\/[a-z0-9-]+\.(pdf|jpg|png|webp)$/),
  name: z.string().max(120),
  type: z.enum(FILE_TYPES),
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
});
export type FileRef = z.infer<typeof FileRef>;

const BAD_TYPE = 'Upload a PDF or an image (JPG, PNG, WebP).';

/** Checks an upload and returns the key and metadata to store it under. */
export function checkUpload(name: string, type: string, bytes: Uint8Array): FileRef {
  const kind = KINDS[type as FileKind];
  if (!kind || !kind.magic(bytes)) throw new HttpError(400, BAD_TYPE, 'bad_file_type');
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'That file is over 10 MB. Try a smaller scan or a PDF.', 'too_large');
  if (bytes.length === 0) throw new HttpError(400, 'That file is empty. Pick the document again.', 'empty_file');
  const base = name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'document';
  return { key: `licences/${randomBytes(4).toString('hex')}-${base}.${kind.ext}`, name: name.slice(0, 120), type: type as FileKind, size: bytes.length };
}
