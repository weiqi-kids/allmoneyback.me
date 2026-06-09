import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FONT_DIR = join(process.cwd(), 'src/assets/fonts');

let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

export async function loadFonts() {
  if (fontCache) return fontCache;

  const [regular, bold] = await Promise.all([
    readFile(join(FONT_DIR, 'NotoSansTC-Regular-static.ttf')),
    readFile(join(FONT_DIR, 'NotoSansTC-Bold-static.ttf')),
  ]);

  fontCache = {
    regular: regular.buffer as ArrayBuffer,
    bold: bold.buffer as ArrayBuffer,
  };

  return fontCache;
}
