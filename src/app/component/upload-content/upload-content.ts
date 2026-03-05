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
/**
 * Upload modal + dashboard that validates files locally and uploads via Filestack.
 *
 * - **Inputs**: `filestackApiKey`, `maxFiles`, `allowedExtensions`, `initialLibrary`, `startOpen`
 * - **Outputs**: `OnUpload` (emits `Uploading`/`Uploaded` with queue + library), `closed`
 */
export class UploadContentComponent implements OnInit, OnDestroy {
  private readonly apiKeySig = signal('');
  private readonly maxFilesSig = signal(UPLOAD_CONTENT_MAX_FILES_DEFAULT);
  private readonly allowedExtensionsSig = signal<readonly string[]>(
    UPLOAD_CONTENT_ALLOWED_EXTENSIONS
  );
  private readonly usePickerSig = signal(false);

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

  @Output() OnUpload = new EventEmitter<UploadContentEvent>();
  @Output() closed = new EventEmitter<void>();

  protected readonly acceptAttribute = UPLOAD_CONTENT_ACCEPT_ATTRIBUTE;
  protected readonly formatBytes = uploadContentFormatBytes;

  protected readonly isOpen = signal(true);
  protected readonly isDragging = signal(false);
  protected readonly viewMode = signal<UploadContentViewMode>('grid');

  protected readonly queue = signal<(UploadContentUploadQueueItem & { isRenamed?: boolean })[]>([]);
  protected readonly library = signal<UploadContentLibraryItem[]>([]);
  protected readonly errors = signal<string[]>([]);

  protected readonly successOpen = signal(false);

  protected readonly renameTarget = signal<{ kind: 'queue' | 'library'; id: string } | null>(
    null
  );
  protected readonly renameDraft = signal('');

  protected readonly fileInputRef = viewChild.required<ElementRef<HTMLInputElement>>(
    'fileInput'
  );

  private client: FilestackClient | null = null;
  private objectUrls = new Map<string, string>();
  private lastEmitAt = 0;

  protected readonly maxReached = computed(
    () => this.queue().length >= this.maxFiles
  );

  protected readonly hasDuplicateTitles = computed(() =>
    this.queue().some((q) => q.status !== 'uploaded' && Boolean(q.isDuplicateTitle))
  );

  protected readonly hasQueuedItems = computed(() => this.queue().length > 0);

  protected readonly isUploading = computed(() =>
    this.queue().some((q) => q.status === 'uploading')
  );

  protected readonly uploadDisabled = computed(() => {
    if (!this.hasQueuedItems()) return true;
    if (!this.filestackApiKey?.trim()) return true;
    if (this.hasDuplicateTitles()) return true;
    if (this.isUploading()) return true;
    return false;
  });

  protected readonly banners = computed<UploadContentBanner[]>(() => {
    const banners: UploadContentBanner[] = [];

    if (!this.filestackApiKey?.trim()) {
      banners.push({
        id: 'missing-key',
        kind: 'warning',
        title: 'Filestack API key missing',
        message: 'Provide `filestackApiKey` to enable uploads.'
      });
    }

    if (this.hasDuplicateTitles()) {
      const dupCount = this.queue().filter((q) => q.status !== 'uploaded' && q.isDuplicateTitle)
        .length;
      banners.push({
        id: 'duplicate-titles',
        kind: 'warning',
        title: 'Duplicate',
        message: `${dupCount} file${dupCount === 1 ? '' : 's'} with duplicate title`
      });

      const firstDup = this.queue().find(
        (q) => q.status !== 'uploaded' && q.isDuplicateTitle
      );
      if (firstDup) {
        banners.push({
          id: 'suggestion-rename',
          kind: 'success',
          title: 'Suggestion',
          message: `1 file rename: ${firstDup.title} → ${this.getSuggestedTitleFor(
            firstDup.id
          )}`,
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
          isVideo: uploadContentIsVideoByExtension(
            uploadContentGetExtension(String(f.filename ?? ''))
          ),
          uploadedAtIso: new Date().toISOString()
        })) as UploadContentLibraryItem[];

        this.library.set([...next, ...this.library()]);
        this.emitUploadEvent('Uploaded');
      },
      onFileUploadFailed: (_file: any, err: any) => {
        const msg =
          typeof err === 'string'
            ? err
            : err?.message
              ? String(err.message)
              : 'An upload failed.';
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

    if (kind === 'queue') {
      const filename = (item as any).filename ?? '';
      const dotIndex = filename.lastIndexOf('.');
      // Seed draft with name only, no extension
      this.renameDraft.set(dotIndex !== -1 ? filename.slice(0, dotIndex) : filename);
    } else {
      this.renameDraft.set((item as any).title ?? '');
    }
  }

  protected cancelRename(): void {
    this.renameTarget.set(null);
    this.renameDraft.set('');
  }

  protected saveRename(): void {
    const target = this.renameTarget();
    if (!target) return;

    const desired = uploadContentSanitizeTitle(this.renameDraft());
    if (!desired) return;

    if (target.kind === 'queue') {
      const original = this.queue().find((q) => q.id === target.id);
      const originalFilename = (original as any)?.filename ?? '';
      const dotIndex = originalFilename.lastIndexOf('.');
      // Reattach the original extension
      const ext = dotIndex !== -1 ? originalFilename.slice(dotIndex) : '';
      const newFilename = desired + ext;

      const next = this.queue().map((q) =>
        q.id === target.id
          ? { ...q, filename: newFilename, isRenamed: true }
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
      this.queue.set(
        this.queue().map((q) =>
          q.id === firstDup.id
            ? { ...q, title: suggested, isRenamed: true }
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
        rejected.map((r) =>
          typeof r.reason === 'string' ? r.reason : 'An upload failed.'
        )
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

  private addFiles(files: File[]): void {
    const max = Math.max(1, this.maxFiles ?? UPLOAD_CONTENT_MAX_FILES_DEFAULT);
    if (this.queue().length + files.length > max) {
      this.errors.set([`You can upload a maximum of ${max} files at a time.`]);
      return;
    }

    const rejected: string[] = [];
    const accepted: (UploadContentUploadQueueItem & { isRenamed?: boolean })[] = [];

    for (const file of files) {
      const ext = uploadContentGetExtension(file.name);
      if (!uploadContentIsAllowedExtension(ext, this.allowedExtensions)) {
        rejected.push(file.name);
        continue;
      }

      const id = uploadContentCreateId('file');
      const objectUrl = URL.createObjectURL(file);
      this.objectUrls.set(id, objectUrl);

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
        isRenamed: false
      });
    }

    if (rejected.length) {
      this.errors.set([
        `Unsupported file type: ${rejected.join(', ')}. Allowed: ${this.allowedExtensions.join(
          ', '
        )}.`
      ]);
    } else {
      this.errors.set([]);
    }

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

    // Lazy import to keep unit tests/browser bundles happy.
    const mod = (await import('filestack-js')) as any;
    this.client = mod.init(key) as FilestackClient;
  }

  private async uploadOne(queueId: string): Promise<void> {
    const item = this.queue().find((q) => q.id === queueId);
    if (!item || !this.client) return;

    try {
      const res = await this.client.upload(item.file, {
        onProgress: (evt: any) => {
          const pct = Math.max(0, Math.min(100, Math.round(evt.totalPercent)));
          this.queue.set(
            this.queue().map((q) =>
              q.id === queueId ? { ...q, progressPct: pct } : q
            )
          );
          this.emitUploadEvent('Uploading', true);
        }
      });

      const uploaded: UploadContentLibraryItem = {
        id: uploadContentCreateId('lib'),
        title: item.title,
        filename: item.filename,
        url: (res as any).url ?? '',
        handle: (res as any).handle,
        mimetype: (res as any).mimetype,
        sizeBytes: (res as any).size ?? item.sizeBytes,
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
      const msg =
        e instanceof Error ? e.message : 'An upload failed. Please try again.';
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

    const libTitlesLower = uploadContentBuildTitlesSetLower(
      this.library().map((l) => l.title)
    );

    // Duplicates are only relevant for queue items: if a queue title is repeated
    // within queue OR already exists in the library.
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