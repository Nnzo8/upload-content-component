import type { UploadContentAllowedExtension } from './upload-content.constants';

export type UploadContentViewMode = 'grid' | 'list';

export type UploadContentBannerKind = 'error' | 'warning' | 'success' | 'info';

/** UI banner displayed above the file dashboard. */
export interface UploadContentBanner {
  id: string;
  kind: UploadContentBannerKind;
  title: string;
  message?: string;
  actions?: Array<{
    id: string;
    label: string;
    variant?: 'primary' | 'secondary' | 'ghost';
  }>;
}

/** Upload lifecycle state emitted to the parent via `OnUpload`. */
export type UploadContentUploadState = 'Uploading' | 'Uploaded';

export type UploadContentItemStatus =
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'error';

export interface UploadContentUploadQueueItem {
  id: string;
  file: File;
  objectUrl: string;
  status: UploadContentItemStatus;
  progressPct: number;
  /** User-facing title (editable). */
  title: string;
  filename: string;
  extension: UploadContentAllowedExtension | string;
  isVideo: boolean;
  sizeBytes: number;
  errorMessage?: string;
  hasInvalidFilename?: boolean;
  filenameTooLong?: boolean;    
  isDuplicateTitle?: boolean;
  duplicateTitleOfId?: string;
}

/** A successfully uploaded asset shown in the channel library/dashboard. */
export interface UploadContentLibraryItem {
  id: string;
  title: string;
  filename: string;
  url: string;
  handle?: string;
  mimetype?: string;
  sizeBytes?: number;
  isVideo: boolean;
  uploadedAtIso: string;
}

/** Event payload for `(OnUpload)` output. */
export interface UploadContentEvent {
  state: UploadContentUploadState;
  queue: UploadContentUploadQueueItem[];
  library: UploadContentLibraryItem[];
  errors: string[];
}

export interface UploadContentConfig {
  filestackApiKey: string;
  maxFiles: number;
  allowedExtensions: ReadonlyArray<UploadContentAllowedExtension>;
  viewMode: UploadContentViewMode;
}


// The rest of your existing types remain unchanged below this point
// (UploadContentLibraryItem, UploadContentEvent, UploadContentBanner, etc.)
