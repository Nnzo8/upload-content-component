import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import type {
  UploadContentEvent,
  UploadContentLibraryItem,
  UploadContentViewMode
} from './component/upload-content/upload-content.types';
import { UploadContentComponent } from './component/upload-content/upload-content';
import { environment } from '../environments/environment';
import { uploadContentSanitizeTitle } from './component/upload-content/upload-content.utils';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, UploadContentComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly filestackApiKey = signal(environment.filestack.apiKey);
  protected readonly lastUploadEvent = signal<UploadContentEvent | null>(null);
  protected readonly showUpload = signal(false);
  protected readonly library = signal<UploadContentLibraryItem[]>([]);
  protected readonly viewMode = signal<UploadContentViewMode>('grid');

  protected readonly renameTargetId = signal<string | null>(null);
  protected readonly renameDraft = signal('');

  protected handleUpload(ev: UploadContentEvent): void {
    this.lastUploadEvent.set(ev);
    this.library.set(ev.library ?? []);
  }

  protected openUpload(): void {
    this.showUpload.set(true);
  }

  protected handleUploadClosed(): void {
    this.showUpload.set(false);
  }

  protected setViewMode(mode: UploadContentViewMode): void {
    this.viewMode.set(mode);
  }

  protected beginLibraryRename(id: string): void {
    const item = this.library().find((l) => l.id === id);
    if (!item) return;
    this.renameTargetId.set(id);
    this.renameDraft.set(item.title ?? '');
  }

  protected cancelLibraryRename(): void {
    this.renameTargetId.set(null);
    this.renameDraft.set('');
  }

  protected saveLibraryRename(): void {
    const id = this.renameTargetId();
    if (!id) return;
    const desired = uploadContentSanitizeTitle(this.renameDraft());
    if (!desired) return;

    this.library.set(
      this.library().map((l) => (l.id === id ? { ...l, title: desired } : l))
    );
    this.cancelLibraryRename();
  }

  protected videoEnter(el: HTMLVideoElement): void {
    void el.play().catch(() => undefined);
  }

  protected videoLeave(el: HTMLVideoElement): void {
    el.pause();
    el.currentTime = 0;
  }
}
