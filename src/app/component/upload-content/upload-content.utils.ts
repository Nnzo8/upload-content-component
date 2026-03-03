export function uploadContentCreateId(prefix = 'uc'): string {
  // crypto.randomUUID is supported in modern browsers; fall back for tests/older envs
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${raw}`;
}

export function uploadContentGetExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

export function uploadContentGetTitleFromFilename(filename: string): string {
  const idx = filename.lastIndexOf('.');
  const base = idx > 0 ? filename.slice(0, idx) : filename;
  return uploadContentSanitizeTitle(base);
}

export function uploadContentSanitizeTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .trim();
}

export function uploadContentIsAllowedExtension(
  ext: string,
  allowed: ReadonlyArray<string>
): boolean {
  return allowed.map((a) => a.toLowerCase()).includes(ext.toLowerCase());
}

export function uploadContentIsVideoByExtension(ext: string): boolean {
  return ext === 'mp4' || ext === 'webm';
}

export function uploadContentFormatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const v = bytes / Math.pow(1024, i);
  const digits = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function uploadContentMakeSuggestedUniqueTitle(
  desiredTitle: string,
  takenTitlesLower: Set<string>
): string {
  const base = uploadContentSanitizeTitle(desiredTitle) || 'untitled';
  if (!takenTitlesLower.has(base.toLowerCase())) return base;

  let n = 1;
  while (takenTitlesLower.has(`${base}_${n}`.toLowerCase())) n++;
  return `${base}_${n}`;
}

export function uploadContentBuildTitlesSetLower(titles: string[]): Set<string> {
  return new Set(titles.map((t) => uploadContentSanitizeTitle(t).toLowerCase()));
}

