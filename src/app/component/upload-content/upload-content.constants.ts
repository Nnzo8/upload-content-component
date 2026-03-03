/** Allowed file extensions (validated before upload). */
export const UPLOAD_CONTENT_ALLOWED_EXTENSIONS = [
  'jpeg',
  'jpg',
  'png',
  'mp4',
  'webm'
] as const;

export type UploadContentAllowedExtension =
  (typeof UPLOAD_CONTENT_ALLOWED_EXTENSIONS)[number];

export const UPLOAD_CONTENT_MAX_FILES_DEFAULT = 10;

/** `<input type="file" accept="...">` value for the allowed extensions. */
export const UPLOAD_CONTENT_ACCEPT_ATTRIBUTE =
  '.jpeg,.jpg,.png,.mp4,.webm';

