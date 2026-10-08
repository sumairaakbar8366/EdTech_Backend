/** Allowed upload types, identified by their leading bytes rather than the client's claim. */
export const ALLOWED_TYPES = {
  'application/pdf': { ext: ['pdf'], magic: [{ at: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] }, // %PDF
  'image/png': { ext: ['png'], magic: [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }] },
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: [{ at: 0, bytes: [0xff, 0xd8, 0xff] }] },
  // .docx is a ZIP container
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], magic: [{ at: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }] },
  // ISO base media: "ftyp" box at byte 4
  'video/mp4': { ext: ['mp4'], magic: [{ at: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] },
} as const;

export type AllowedMime = keyof typeof ALLOWED_TYPES;

/** Types accepted for student/staff/admission documents. */
export const DOCUMENT_TYPES: readonly AllowedMime[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Types accepted for learning material and assignment files (page 10: PDF, Word, video, image). */
export const LMS_TYPES: readonly AllowedMime[] = [...DOCUMENT_TYPES, 'video/mp4'];

/** Returns the detected MIME type if the file content and extension agree and are allowed. */
export function detectAllowedType(fileName: string, data: Buffer, allowed: readonly AllowedMime[] = DOCUMENT_TYPES): AllowedMime | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  for (const mime of allowed) {
    const spec = ALLOWED_TYPES[mime];
    if (!(spec.ext as readonly string[]).includes(ext)) continue;
    if (spec.magic.some((sig) => sig.bytes.every((byte, i) => data[sig.at + i] === byte))) return mime;
  }
  return null;
}

/** Strips path parts and unsafe characters so the stored name is safe to echo in headers. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 150);
}
