import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  UPLOAD_CONTENT_ACCEPT_ATTRIBUTE,
  UPLOAD_CONTENT_ALLOWED_EXTENSIONS,
  UPLOAD_CONTENT_MAX_FILES_DEFAULT
} from './upload-content.constants';
import type {
  UploadContentBanner,
  UploadContentEvent,
  UploadContentLibraryItem,
  UploadContentUploadQueueItem,
  UploadContentViewMode
} from './upload-content.types';
import {
  uploadContentBuildTitlesSetLower,
  uploadContentCreateId,
  uploadContentFormatBytes,
  uploadContentGetExtension,
  uploadContentGetTitleFromFilename,
  uploadContentIsAllowedExtension,
  uploadContentIsVideoByExtension,
  uploadContentMakeSuggestedUniqueTitle,
  uploadContentSanitizeTitle
} from './upload-content.utils';

/** Maximum filename length (inclusive). Filenames at or above this are rejected. */
const UPLOAD_CONTENT_MAX_FILENAME_LENGTH = 255;

/** Regex that matches any character NOT allowed in a filename. */
const INVALID_FILENAME_CHARS_RE = /[^a-zA-Z0-9_.]/;

/**
 * Minimal interface for a Filestack client instance.
 * Exposes only the methods used by this component.
 */
type FilestackClient = {
  upload: (file: File, options?: any) => Promise<any>;
  picker?: (options: any) => { open: () => void; close?: () => void };
};

@Component({
  selector: 'upload-content',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './upload-content.html',
  styleUrl: './upload-content.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UploadContentComponent implements OnInit, OnDestroy {
  private readonly apiKeySig = signal('');
  private readonly maxFilesSig = signal(UPLOAD_CONTENT_MAX_FILES_DEFAULT);
  private readonly allowedExtensionsSig = signal<readonly string[]>(UPLOAD_CONTENT_ALLOWED_EXTENSIONS);
  private readonly usePickerSig = signal(false);
  private readonly googleApiKeySig = signal('');
  private readonly googleClientIdSig = signal('');
  private googleApisLoaded = false;
  private initialLibraryValue: UploadContentLibraryItem[] = [];

  @Input({ required: true })
  set filestackApiKey(value: string) {
    this.apiKeySig.set(value ?? '');
    void this.tryInitClient();
  }
  get filestackApiKey(): string {
    return this.apiKeySig();
  }

  @Input()
  set maxFiles(value: number) {
    const v = Number.isFinite(value) && value > 0 ? value : UPLOAD_CONTENT_MAX_FILES_DEFAULT;
    this.maxFilesSig.set(v);
  }
  get maxFiles(): number {
    return this.maxFilesSig();
  }

  @Input()
  set allowedExtensions(value: ReadonlyArray<string>) {
    this.allowedExtensionsSig.set(
      value?.length ? Array.from(value) : UPLOAD_CONTENT_ALLOWED_EXTENSIONS
    );
  }
  get allowedExtensions(): readonly string[] {
    return this.allowedExtensionsSig();
  }

  @Input()
  set initialLibrary(value: UploadContentLibraryItem[]) {
    this.initialLibraryValue = value ?? [];
    this.library.set(this.initialLibraryValue);
    this.syncDuplicates();
  }
  get initialLibrary(): UploadContentLibraryItem[] {
    return this.initialLibraryValue;
  }

  @Input()
  set startOpen(value: boolean) {
    this.isOpen.set(value ?? true);
  }
  get startOpen(): boolean {
    return this.isOpen();
  }

  @Input()
  set useFilestackPicker(value: boolean) {
    this.usePickerSig.set(Boolean(value));
  }
  get useFilestackPicker(): boolean {
    return this.usePickerSig();
  }

  @Input()
  set googleApiKey(value: string) {
    this.googleApiKeySig.set(value ?? '');
  }
  get googleApiKey(): string {
    return this.googleApiKeySig();
  }

  @Input()
  set googleClientId(value: string) {
    this.googleClientIdSig.set(value ?? '');
  }
  get googleClientId(): string {
    return this.googleClientIdSig();
  }

  @Output() OnUpload = new EventEmitter<UploadContentEvent>();
  @Output() closed = new EventEmitter<void>();

  protected readonly acceptAttribute = UPLOAD_CONTENT_ACCEPT_ATTRIBUTE;
  protected readonly formatBytes = uploadContentFormatBytes;
  protected readonly isOpen = signal(true);
  protected readonly isDragging = signal(false);
  protected readonly viewMode = signal<UploadContentViewMode>('grid');

  protected readonly queue = signal<(UploadContentUploadQueueItem & {
    isRenamed?: boolean;
    hasInvalidFilename?: boolean;
    filenameTooLong?: boolean;
  })[]>([]);

  protected readonly library = signal<UploadContentLibraryItem[]>([]);
  protected readonly errors = signal<string[]>([]);
  protected readonly successOpen = signal(false);

  protected readonly renameTarget = signal<{ kind: 'queue' | 'library'; id: string } | null>(null);
  protected readonly renameDraft = signal('');

  /**
   * Validation error message for the currently active rename input.
   * Null when the draft is valid (or no rename is in progress).
   */
  protected readonly renameValidationError = signal<string | null>(null);

  protected readonly fileInputRef = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  private client: FilestackClient | null = null;
  private objectUrls = new Map<string, string>();
  private lastEmitAt = 0;

  protected readonly maxReached = computed(() => this.queue().length >= this.maxFiles);

  protected readonly hasDuplicateTitles = computed(() =>
    this.queue().some((q) => q.status !== 'uploaded' && Boolean(q.isDuplicateTitle))
  );

  protected readonly hasInvalidFilenames = computed(() =>
    this.queue().some((q) => q.status !== 'uploaded' && Boolean(q.hasInvalidFilename))
  );

  protected readonly hasTooLongFilenames = computed(() =>
    this.queue().some((q) => q.status !== 'uploaded' && Boolean(q.filenameTooLong))
  );

  protected readonly hasQueuedItems = computed(() => this.queue().length > 0);

  protected readonly isUploading = computed(() =>
    this.queue().some((q) => q.status === 'uploading')
  );

  protected readonly uploadDisabled = computed(() => {
    if (!this.hasQueuedItems()) return true;
    if (this.hasDuplicateTitles()) return true;
    if (this.hasInvalidFilenames()) return true;
    if (this.hasTooLongFilenames()) return true;
    if (this.isUploading()) return true;
    return false;
  });

  /**
   * Whether the Save button in the rename inline editor should be disabled.
   * Blocked when the draft is empty or has a live validation error.
   */
  protected readonly renameSaveDisabled = computed(() => {
    if (!this.renameDraft()) return true;
    if (this.renameValidationError() !== null) return true;
    if (this.isUploading()) return true;
    return false;
  });

  protected readonly banners = computed<UploadContentBanner[]>(() => {
    const banners: UploadContentBanner[] = [];

    if (this.hasTooLongFilenames()) {
      const tooLongItems = this.queue().filter(
        (q) => q.status !== 'uploaded' && q.filenameTooLong
      );
      const names = tooLongItems.map((q) => q.filename).join(', ');
      banners.push({
        id: 'filename-too-long',
        kind: 'error',
        title: 'Filename too long',
        message: `${tooLongItems.length === 1 ? 'A file exceeds' : 'Some files exceed'} the maximum filename length of ${UPLOAD_CONTENT_MAX_FILENAME_LENGTH} characters: ${names}`
      });
    }

    if (this.hasInvalidFilenames()) {
      const invalidItems = this.queue().filter(
        (q) => q.status !== 'uploaded' && q.hasInvalidFilename
      );
      const names = invalidItems.map((q) => q.filename).join(', ');
      banners.push({
        id: 'invalid-filenames',
        kind: 'error',
        title: 'Invalid filename',
        message: `${invalidItems.length === 1 ? 'A file has' : 'Some files have'} invalid characters (only letters, numbers, underscores, and periods are allowed): ${names}`
      });
    }

    if (this.hasDuplicateTitles()) {
      const dupCount = this.queue().filter((q) => q.status !== 'uploaded' && q.isDuplicateTitle).length;
      banners.push({
        id: 'duplicate-titles',
        kind: 'warning',
        title: 'Duplicate',
        message: `${dupCount} file${dupCount === 1 ? '' : 's'} with duplicate title`
      });

      const firstDup = this.queue().find((q) => q.status !== 'uploaded' && q.isDuplicateTitle);
      if (firstDup) {
        banners.push({
          id: 'suggestion-rename',
          kind: 'success',
          title: 'Suggestion',
          message: `1 file rename: ${firstDup.title} → ${this.getSuggestedTitleFor(firstDup.id)}`,
          actions: [
            { id: 'rename', label: 'Rename', variant: 'secondary' },
            { id: 'accept', label: 'Accept', variant: 'primary' }
          ]
        });
      }
    }

    for (const e of this.errors()) {
      banners.push({
        id: `err_${e}`,
        kind: 'error',
        title: 'Upload error',
        message: e
      });
    }

    return banners;
  });

  ngOnInit(): void {
    void this.tryInitClient();
    this.syncDuplicates();
  }

  ngOnDestroy(): void {
    for (const [, url] of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  protected close(): void {
    for (const q of this.queue()) this.revokeItemObjectUrl(q.id);
    this.queue.set([]);
    this.cancelRename();
    this.isOpen.set(false);
    this.closed.emit();
  }

  protected openBrowse(): void {
    if (this.isUploading()) return;
    if (this.useFilestackPicker && this.client?.picker) {
      this.openPicker(['local_file_system', 'googledrive', 'dropbox']);
      return;
    }
    this.fileInputRef().nativeElement.click();
  }

  protected openSource(source: 'googledrive' | 'dropbox', ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.isUploading()) return;
    if (source === 'googledrive' && this.googleApiKeySig() && this.googleClientIdSig()) {
      void this.openGoogleDrivePicker();
      return;
    }
    this.openPicker([source]);
  }

  private openPicker(fromSources: string[]): void {
    if (!this.client?.picker) return;

    this.emitUploadEvent('Uploading');
    const picker = this.client.picker({
      fromSources,
      accept: this.allowedExtensions.map((e) => `.${String(e).toLowerCase()}`),
      maxFiles: this.maxFiles,
      onUploadDone: (res: any) => {
        const files = (res?.filesUploaded ?? []) as any[];
        const next = files.map((f) => ({
          id: uploadContentCreateId('lib'),
          title: uploadContentGetTitleFromFilename(String(f.filename ?? '')),
          filename: String(f.filename ?? ''),
          url: String(f.url ?? ''),
          handle: String(f.handle ?? ''),
          mimetype: String(f.mimetype ?? ''),
          sizeBytes: typeof f.size === 'number' ? f.size : undefined,
          isVideo: uploadContentIsVideoByExtension(uploadContentGetExtension(String(f.filename ?? ''))),
          uploadedAtIso: new Date().toISOString()
        })) as UploadContentLibraryItem[];

        this.library.set([...next, ...this.library()]);
        this.emitUploadEvent('Uploaded');
      },
      onFileUploadFailed: (_file: any, err: any) => {
        const msg =
          typeof err === 'string' ? err : err?.message ? String(err.message) : 'An upload failed.';
        this.errors.set([msg]);
        this.emitUploadEvent('Uploaded');
      }
    });

    picker.open();
  }

  protected onFileInputChange(ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    if (!input?.files?.length) return;
    this.addFiles(Array.from(input.files));
    input.value = '';
  }

  protected onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (this.isUploading()) return;
    this.isDragging.set(true);
  }

  protected onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging.set(false);
  }

  protected onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging.set(false);
    if (this.isUploading()) return;
    const files = Array.from(ev.dataTransfer?.files ?? []);
    if (!files.length) return;
    this.addFiles(files);
  }

  protected removeFromQueue(id: string): void {
    const current = this.queue();
    const item = current.find((q) => q.id === id);
    if (item) this.revokeItemObjectUrl(item.id);
    this.queue.set(current.filter((q) => q.id !== id));
    this.syncDuplicates();
    this.emitUploadEvent('Uploading');
  }

  protected beginRename(kind: 'queue' | 'library', id: string): void {
    const item =
      kind === 'queue'
        ? this.queue().find((q) => q.id === id)
        : this.library().find((l) => l.id === id);
    if (!item) return;
    this.renameTarget.set({ kind, id });
    this.renameValidationError.set(null);

    if (kind === 'queue') {
      const filename = (item as any).filename ?? '';
      const dotIndex = filename.lastIndexOf('.');
      this.renameDraft.set(dotIndex !== -1 ? filename.slice(0, dotIndex) : filename);
    } else {
      this.renameDraft.set((item as any).title ?? '');
    }
  }

  protected cancelRename(): void {
    this.renameTarget.set(null);
    this.renameDraft.set('');
    this.renameValidationError.set(null);
  }

  /**
   * Runs live validation on the rename draft as the user types.
   *
   * Called on every `(ngModelChange)` of the rename input. Sets
   * `renameValidationError` to a human-readable message when the current
   * draft stem (before the original extension is re-appended) contains
   * invalid characters; clears it when the draft is valid.
   *
   * @param draft - The raw string currently in the rename input.
   */
  protected onRenameDraftChange(draft: string): void {
    this.renameDraft.set(draft);

    if (!draft) {
      // Empty draft — defer "required" feedback until save is attempted.
      this.renameValidationError.set(null);
      return;
    }

    // The user types only the stem; we preview what the full filename will
    // look like once we re-attach the original extension before validating.
    const target = this.renameTarget();
    let preview = draft;

    if (target?.kind === 'queue') {
      const original = this.queue().find((q) => q.id === target.id);
      const originalFilename = (original as any)?.filename ?? '';
      const dotIndex = originalFilename.lastIndexOf('.');
      const ext = dotIndex !== -1 ? originalFilename.slice(dotIndex) : '';
      preview = draft + ext;
    }

    if (INVALID_FILENAME_CHARS_RE.test(preview)) {
      this.renameValidationError.set(
        'Only letters, numbers, underscores, and periods are allowed.'
      );
    } else {
      this.renameValidationError.set(null);
    }
  }

  /**
   * Commits the current `renameDraft` to the targeted item.
   *
   * Guards against saving when:
   * - The draft sanitises to an empty string.
   * - The full new filename (stem + original extension) contains invalid chars.
   *
   * For queue items the original file extension is re-appended to the new
   * filename and `hasInvalidFilename` is re-evaluated so queue-level banners
   * stay in sync. For library items only the `title` field is updated.
   */
  protected saveRename(): void {
    const target = this.renameTarget();
    if (!target) return;

    const desired = uploadContentSanitizeTitle(this.renameDraft());
    if (!desired) {
      this.renameValidationError.set('Filename cannot be empty.');
      return;
    }

    if (target.kind === 'queue') {
      const original = this.queue().find((q) => q.id === target.id);
      const originalFilename = (original as any)?.filename ?? '';
      const dotIndex = originalFilename.lastIndexOf('.');
      const ext = dotIndex !== -1 ? originalFilename.slice(dotIndex) : '';
      const newFilename = desired + ext;

      // Final guard — catches any chars that slipped past live validation.
      if (INVALID_FILENAME_CHARS_RE.test(newFilename)) {
        this.renameValidationError.set(
          'Only letters, numbers, underscores, and periods are allowed.'
        );
        return;
      }

      const filenameTooLong = newFilename.length >= UPLOAD_CONTENT_MAX_FILENAME_LENGTH;
      if (filenameTooLong) {
        this.renameValidationError.set(
          `Filename must be shorter than ${UPLOAD_CONTENT_MAX_FILENAME_LENGTH} characters.`
        );
        return;
      }

      const next = this.queue().map((q) =>
        q.id === target.id
          ? {
            ...q,
            filename: newFilename,
            isRenamed: true,
            hasInvalidFilename: false,
            filenameTooLong: false
          }
          : q
      );
      this.queue.set(next);
      this.syncDuplicates();
    } else {
      this.library.set(
        this.library().map((l) => (l.id === target.id ? { ...l, title: desired } : l))
      );
    }

    this.cancelRename();
  }

  protected onBannerAction(bannerId: string, actionId: string): void {
    if (bannerId !== 'suggestion-rename') return;

    const firstDup = this.queue().find((q) => q.isDuplicateTitle);
    if (!firstDup) return;

    if (actionId === 'rename') {
      this.beginRename('queue', firstDup.id);
      return;
    }

    if (actionId === 'accept') {
      const suggested = this.getSuggestedTitleFor(firstDup.id);
      const originalFilename = firstDup.filename ?? '';
      const dotIndex = originalFilename.lastIndexOf('.');
      const ext = dotIndex !== -1 ? originalFilename.slice(dotIndex) : '';
      const newFilename = suggested + ext;
      this.queue.set(
        this.queue().map((q) =>
          q.id === firstDup.id
            ? { ...q, title: suggested, filename: newFilename, isRenamed: true }
            : q
        )
      );
      this.syncDuplicates();
    }
  }

  protected setViewMode(mode: UploadContentViewMode): void {
    this.viewMode.set(mode);
  }

  protected async uploadAll(): Promise<void> {
    if (this.uploadDisabled()) return;
    if (!this.client) {
      this.errors.set(['Filestack client not initialized.']);
      return;
    }

    this.errors.set([]);
    this.emitUploadEvent('Uploading');

    const toUpload = this.queue().filter((q) => q.status === 'queued' || q.status === 'error');
    this.queue.set(
      this.queue().map((q) =>
        toUpload.some((t) => t.id === q.id)
          ? { ...q, status: 'uploading', progressPct: 0, errorMessage: undefined }
          : q
      )
    );

    const results = await Promise.allSettled(toUpload.map((q) => this.uploadOne(q.id)));
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    if (rejected.length) {
      this.errors.set(
        rejected.map((r) => (typeof r.reason === 'string' ? r.reason : 'An upload failed.'))
      );
    }

    const allSucceeded = this.queue().every((q) => q.status === 'uploaded');
    if (allSucceeded) this.successOpen.set(true);

    this.emitUploadEvent('Uploaded');
    this.cancelRename();
  }

  protected dismissSuccess(): void {
    this.successOpen.set(false);
    for (const q of this.queue()) this.revokeItemObjectUrl(q.id);
    this.queue.set([]);
  }

  protected videoEnter(el: HTMLVideoElement): void {
    void el.play().catch(() => undefined);
  }

  protected videoLeave(el: HTMLVideoElement): void {
    el.pause();
    el.currentTime = 0;
  }

  protected trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  private addFiles(files: File[]): void {
    const max = Math.max(1, this.maxFiles ?? UPLOAD_CONTENT_MAX_FILES_DEFAULT);
    if (this.queue().length + files.length > max) {
      this.errors.set([`You can upload a maximum of ${max} files at a time.`]);
      return;
    }

    const rejected: string[] = [];
    const tooLongRejected: string[] = [];
    const accepted: (UploadContentUploadQueueItem & {
      isRenamed?: boolean;
      hasInvalidFilename?: boolean;
      filenameTooLong?: boolean;
    })[] = [];

    for (const file of files) {
      const ext = uploadContentGetExtension(file.name);
      if (!uploadContentIsAllowedExtension(ext, this.allowedExtensions)) {
        rejected.push(file.name);
        continue;
      }

      if (file.name.length >= UPLOAD_CONTENT_MAX_FILENAME_LENGTH) {
        tooLongRejected.push(file.name);
        continue;
      }

      const id = uploadContentCreateId('file');
      const objectUrl = URL.createObjectURL(file);
      this.objectUrls.set(id, objectUrl);

      const hasInvalidChars = INVALID_FILENAME_CHARS_RE.test(file.name);

      accepted.push({
        id,
        file,
        objectUrl,
        status: 'queued',
        progressPct: 0,
        title: uploadContentGetTitleFromFilename(file.name),
        filename: file.name,
        extension: ext,
        isVideo: uploadContentIsVideoByExtension(ext),
        sizeBytes: file.size,
        isRenamed: false,
        hasInvalidFilename: hasInvalidChars,
        filenameTooLong: false
      });
    }

    const errorMessages: string[] = [];
    if (tooLongRejected.length) {
      errorMessages.push(
        `Filename too long (max ${UPLOAD_CONTENT_MAX_FILENAME_LENGTH - 1} characters): ${tooLongRejected.join(', ')}. Please rename the file on your device and try again.`
      );
    }
    if (rejected.length) {
      errorMessages.push(
        `Unsupported file type: ${rejected.join(', ')}. Allowed: ${this.allowedExtensions.join(', ')}.`
      );
    }

    this.errors.set(errorMessages);

    if (!accepted.length) return;
    this.queue.set([...this.queue(), ...accepted]);
    this.syncDuplicates();
    this.emitUploadEvent('Uploading');
  }

  private async tryInitClient(): Promise<void> {
    const key = this.filestackApiKey?.trim();
    if (!key) {
      this.client = null;
      return;
    }
    const mod = (await import('filestack-js')) as any;
    this.client = mod.init(key) as FilestackClient;
  }

  /**
   * Lazily loads the Google API script (gapi) and the Google Identity Services
   * (GIS) script the first time a Google Drive picker is requested.
   */
  private loadGoogleApis(): Promise<void> {
    if (this.googleApisLoaded) return Promise.resolve();

    const loadScript = (src: string): Promise<void> =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(s);
      });

    return Promise.all([
      loadScript('https://apis.google.com/js/api.js'),
      loadScript('https://accounts.google.com/gsi/client')
    ]).then(() => {
      this.googleApisLoaded = true;
    });
  }

  /**
   * Opens the native Google Drive file picker using the Google Picker API
   * and Google Identity Services for OAuth2.
   *
   * Selected files are fetched via the Drive API and fed into `addFiles()`
   * so all existing validation, rename, and duplicate-detection logic applies.
   */
  private async openGoogleDrivePicker(): Promise<void> {
    try {
      await this.loadGoogleApis();
    } catch {
      this.errors.set(['Failed to load Google APIs. Please check your connection.']);
      return;
    }

    const gapi = (window as any)['gapi'];
    const google = (window as any)['google'];
    if (!gapi || !google) {
      this.errors.set(['Google APIs did not load correctly.']);
      return;
    }

    const apiKey = this.googleApiKeySig();
    const clientId = this.googleClientIdSig();

    // Allowed MIME types that match the component's extension allow-list.
    const ALLOWED_MIME_TYPES = [
      'image/jpeg',
      'image/png',
      'video/mp4',
      'video/webm'
    ].join(',');

    // Request an OAuth2 token via GIS, then open the picker on callback.
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (tokenResponse: any) => {
        if (tokenResponse.error) {
          this.errors.set([`Google sign-in failed: ${tokenResponse.error}`]);
          return;
        }

        const accessToken: string = tokenResponse.access_token;

        gapi.load('picker', () => {
          const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
            .setMimeTypes(ALLOWED_MIME_TYPES)
            .setIncludeFolders(false);

          const picker = new google.picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(accessToken)
            .setDeveloperKey(apiKey)
            .setCallback(async (data: any) => {
              if (data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) return;

              this.emitUploadEvent('Uploading');
              const docs: any[] = data[google.picker.Response.DOCUMENTS] ?? [];
              const fetchedFiles: File[] = [];

              for (const doc of docs) {
                const fileId: string = doc[google.picker.Document.ID];
                const fileName: string = doc[google.picker.Document.NAME] ?? 'google-drive-file';
                const mimeType: string = doc[google.picker.Document.MIME_TYPE] ?? 'application/octet-stream';

                try {
                  const res = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                  );
                  if (!res.ok) {
                    const errBody = await res.json().catch(() => null);
                    const detail = errBody?.error?.message ?? errBody?.error?.status ?? `HTTP ${res.status}`;
                    throw new Error(detail);
                  }
                  const blob = await res.blob();
                  fetchedFiles.push(new File([blob], fileName, { type: mimeType }));
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  this.errors.set([`Could not download "${fileName}" from Google Drive: ${msg}`]);
                }
              }

              if (fetchedFiles.length) this.addFiles(fetchedFiles);
            })
            .build();

          picker.setVisible(true);
        });
      }
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  private async uploadOne(queueId: string): Promise<void> {
    const item = this.queue().find((q) => q.id === queueId);
    if (!item) return;

    try {
      let simulatedPct = 0;
      const progressInterval = setInterval(() => {
        simulatedPct = Math.min(simulatedPct + Math.random() * 12, 90);
        const pct = Math.round(simulatedPct);
        this.queue.set(
          this.queue().map((q) => (q.id === queueId ? { ...q, progressPct: pct } : q))
        );
        this.emitUploadEvent('Uploading', true);
      }, 400);

      const form = new FormData();
      form.append('file', item.file, item.filename);

      const res = await fetch('http://localhost:3000/api/upload', {
        method: 'POST',
        body: form
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed.' }));
        throw new Error((err as any).error ?? 'Upload failed.');
      }

      const data = await res.json() as {
        url: string;
        handle: string;
        filename: string;
        size: number;
        mimetype: string;
      };

      const uploaded: UploadContentLibraryItem = {
        id: uploadContentCreateId('lib'),
        title: item.title,
        filename: data.filename ?? item.filename,
        url: data.url ?? '',
        handle: data.handle,
        mimetype: data.mimetype,
        sizeBytes: data.size ?? item.sizeBytes,
        isVideo: item.isVideo,
        uploadedAtIso: new Date().toISOString()
      };

      this.library.set([uploaded, ...this.library()]);
      this.queue.set(
        this.queue().map((q) =>
          q.id === queueId ? { ...q, status: 'uploaded', progressPct: 100 } : q
        )
      );
      this.syncDuplicates();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'An upload failed. Please try again.';
      this.queue.set(
        this.queue().map((q) =>
          q.id === queueId ? { ...q, status: 'error', errorMessage: msg } : q
        )
      );
      throw msg;
    }
  }

  private emitUploadEvent(state: 'Uploading' | 'Uploaded', throttle = false): void {
    if (throttle) {
      const now = Date.now();
      if (now - this.lastEmitAt < 250) return;
      this.lastEmitAt = now;
    }
    this.OnUpload.emit({
      state,
      queue: this.queue(),
      library: this.library(),
      errors: this.errors()
    });
  }

  private syncDuplicates(): void {
    const activeQueue = this.queue().filter((q) => q.status !== 'uploaded');
    const queueTitleCounts = new Map<string, number>();
    for (const q of activeQueue) {
      const key = uploadContentSanitizeTitle(q.title).toLowerCase();
      if (!key) continue;
      queueTitleCounts.set(key, (queueTitleCounts.get(key) ?? 0) + 1);
    }

    const libTitlesLower = uploadContentBuildTitlesSetLower(this.library().map((l) => l.title));

    const queue = this.queue();
    const next = queue.map((q) => {
      if (q.status === 'uploaded') {
        return { ...q, isDuplicateTitle: false };
      }
      const k = uploadContentSanitizeTitle(q.title).toLowerCase();
      const inQueueDup = (queueTitleCounts.get(k) ?? 0) > 1;
      const inLibraryDup = libTitlesLower.has(k);
      return {
        ...q,
        isDuplicateTitle: Boolean(k) && (inQueueDup || inLibraryDup)
      };
    });

    this.queue.set(next);
  }

  private getSuggestedTitleFor(queueId: string): string {
    const item = this.queue().find((q) => q.id === queueId);
    if (!item) return '';

    const taken = [
      ...this.library().map((l) => l.title),
      ...this.queue()
        .filter((q) => q.status !== 'uploaded' && q.id !== queueId)
        .map((q) => q.title)
    ];
    const takenLower = uploadContentBuildTitlesSetLower(taken);
    return uploadContentMakeSuggestedUniqueTitle(item.title, takenLower);
  }

  private revokeItemObjectUrl(id: string): void {
    const url = this.objectUrls.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.objectUrls.delete(id);
  }
}