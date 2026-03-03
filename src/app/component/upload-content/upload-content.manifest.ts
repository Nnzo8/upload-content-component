import {
  UPLOAD_CONTENT_ALLOWED_EXTENSIONS,
  UPLOAD_CONTENT_MAX_FILES_DEFAULT
} from './upload-content.constants';
import type { UploadContentConfig } from './upload-content.types';

export const UPLOAD_CONTENT_DEFAULT_CONFIG: UploadContentConfig = {
  filestackApiKey: '',
  maxFiles: UPLOAD_CONTENT_MAX_FILES_DEFAULT,
  allowedExtensions: UPLOAD_CONTENT_ALLOWED_EXTENSIONS,
  viewMode: 'grid'
};

export const UPLOAD_CONTENT_MANIFEST = {
  name: 'upload-content',
  selector: 'upload-content',
  inputs: [
    'filestackApiKey',
    'maxFiles',
    'allowedExtensions',
    'initialLibrary',
    'startOpen',
    'useFilestackPicker'
  ],
  outputs: ['OnUpload', 'closed'],
  defaults: UPLOAD_CONTENT_DEFAULT_CONFIG
} as const;

