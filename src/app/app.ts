import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import type { UploadContentEvent } from './component/upload-content/upload-content.types';
import { UploadContentComponent } from './component/upload-content/upload-content';
import { environment } from '../environments/environment';

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

  protected handleUpload(ev: UploadContentEvent): void {
    this.lastUploadEvent.set(ev);
  }

  protected openUpload(): void {
    this.showUpload.set(true);
  }

  protected handleUploadClosed(): void {
    this.showUpload.set(false);
  }
}
