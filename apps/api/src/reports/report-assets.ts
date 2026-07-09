import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve a bundled asset (fonts, logos) regardless of whether we run from
 * source or dist. Returns null if the asset is missing so callers degrade
 * gracefully (e.g. skip a logo) instead of crashing.
 */
export function assetPath(relative: string): string | null {
  const candidates = [
    join(process.cwd(), 'assets', relative),
    join(__dirname, '..', '..', 'assets', relative),
    join(__dirname, '..', 'assets', relative),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export const FONT_TH = () => assetPath('fonts/THSarabunNew.ttf');
export const FONT_TH_BOLD = () => assetPath('fonts/THSarabunNew-Bold.ttf');
export const LOGO_UNIVERSITY = () => assetPath('logos/university.png');
export const LOGO_FACULTY = () => assetPath('logos/faculty.png');
