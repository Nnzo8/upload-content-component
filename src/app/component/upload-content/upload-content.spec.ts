import { TestBed } from '@angular/core/testing';
import { UploadContentComponent } from './upload-content';

function file(name: string, type = 'application/octet-stream') {
  return new File(['x'], name, { type });
}

describe('UploadContentComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UploadContentComponent]
    }).compileComponents();
  });

  it('rejects unsupported extensions', async () => {
    const fixture = TestBed.createComponent(UploadContentComponent);
    const c = fixture.componentInstance as any;
    c.allowedExtensions = ['png', 'jpg', 'jpeg', 'mp4', 'webm'];
    fixture.detectChanges();

    c.addFiles([file('doc.pdf', 'application/pdf')]);
    fixture.detectChanges();

    expect(c.queue().length).toBe(0);
    expect(c.errors().join(' ')).toContain('Unsupported file type');
  });

  it('flags duplicate titles', async () => {
    const fixture = TestBed.createComponent(UploadContentComponent);
    const c = fixture.componentInstance as any;
    c.allowedExtensions = ['png', 'jpg', 'jpeg', 'mp4', 'webm'];
    fixture.detectChanges();

    c.addFiles([file('bred.png', 'image/png'), file('bred.jpg', 'image/jpeg')]);
    fixture.detectChanges();

    expect(c.queue().length).toBe(2);
    expect(c.queue().some((q: any) => q.isDuplicateTitle)).toBe(true);
    expect(c.uploadDisabled()).toBe(true);
  });
});

