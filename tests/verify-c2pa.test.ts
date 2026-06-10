import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 受測對象是 scripts/verify-c2pa.mjs（ESM）；以相對路徑 import。
import { hasC2paManifest, verifyArticleCovers } from '../scripts/verify-c2pa.mjs';

// 最小 PNG 檔頭（8-byte signature），不含任何 C2PA / JUMBF 標記。
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 合成一個「帶 C2PA 標記」的 buffer：PNG 檔頭 + jumb 盒 + c2pa 標籤。 */
function makeC2paBuffer(): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    Buffer.from('....jumb....jumdc2pa........c2pa.assertions....', 'latin1'),
  ]);
}

/** 合成一個「無 C2PA 標記」的 buffer：純 PNG 檔頭 + 任意非標記 bytes。 */
function makePlainBuffer(): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from('IHDR....IDAT....IEND', 'latin1')]);
}

describe('hasC2paManifest', () => {
  it('帶 c2pa + jumb 標記的 buffer → true', () => {
    expect(hasC2paManifest(makeC2paBuffer())).toBe(true);
  });

  it('只有 c2pa（無 jumb/jumd/cai/contentauth）→ false', () => {
    const buf = Buffer.concat([PNG_SIGNATURE, Buffer.from('c2pa-only-no-box', 'latin1')]);
    expect(hasC2paManifest(buf)).toBe(false);
  });

  it('c2pa + cai 次標記 → true', () => {
    const buf = Buffer.concat([PNG_SIGNATURE, Buffer.from('cai....c2pa.claim', 'latin1')]);
    expect(hasC2paManifest(buf)).toBe(true);
  });

  it('純 PNG 檔頭（無任何標記）→ false', () => {
    expect(hasC2paManifest(makePlainBuffer())).toBe(false);
  });

  it('空 buffer → false', () => {
    expect(hasC2paManifest(Buffer.alloc(0))).toBe(false);
  });
});

describe('verifyArticleCovers', () => {
  let dir: string;
  let contentDir: string;
  let coversDir: string;
  let distDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'c2pa-test-'));
    contentDir = path.join(dir, 'articles');
    coversDir = path.join(contentDir, '_covers');
    distDir = path.join(dir, 'dist');
    mkdirSync(coversDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeArticle(slug: string, fm: Record<string, string>, body = 'body') {
    const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
    writeFileSync(
      path.join(contentDir, `${slug}.md`),
      `---\n${lines.join('\n')}\n---\n\n${body}\n`,
      'utf8',
    );
  }

  it('coverC2paVerified=true + 來源封面帶標記 → ok, checked 1, 無 failure', async () => {
    writeArticle('good', {
      coverC2paVerified: 'true',
      coverImage: './_covers/good.png',
    });
    writeFileSync(path.join(coversDir, 'good.png'), makeC2paBuffer());

    const res = await verifyArticleCovers({ contentDir, distDir });
    expect(res.ok).toBe(true);
    expect(res.checked).toBe(1);
    expect(res.failures).toHaveLength(0);
  });

  it('coverC2paVerified=true + 來源封面缺標記 → ok:false, 列出 failure（build-gate）', async () => {
    writeArticle('stripped', {
      coverC2paVerified: 'true',
      coverImage: './_covers/stripped.png',
    });
    writeFileSync(path.join(coversDir, 'stripped.png'), makePlainBuffer());

    const res = await verifyArticleCovers({ contentDir, distDir });
    expect(res.ok).toBe(false);
    expect(res.checked).toBe(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].slug).toBe('stripped');
    expect(res.failures[0].reason).toContain('manifest');
  });

  it('coverC2paVerified=true + 來源封面檔不存在 → failure', async () => {
    writeArticle('missing', {
      coverC2paVerified: 'true',
      coverImage: './_covers/missing.png',
    });
    // 故意不寫檔。

    const res = await verifyArticleCovers({ contentDir, distDir });
    expect(res.ok).toBe(false);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].slug).toBe('missing');
    expect(res.failures[0].reason).toContain('不存在');
  });

  it('已建置 dist 封面缺標記 → failure（最佳化剝離把關）', async () => {
    writeArticle('built', {
      coverC2paVerified: 'true',
      coverImage: './_covers/built.png',
    });
    writeFileSync(path.join(coversDir, 'built.png'), makeC2paBuffer()); // source OK
    // dist 命中但被剝掉 manifest：
    const astroDir = path.join(distDir, '_astro');
    mkdirSync(astroDir, { recursive: true });
    writeFileSync(path.join(astroDir, 'built.abc12345.png'), makePlainBuffer());

    const res = await verifyArticleCovers({ contentDir, distDir });
    expect(res.ok).toBe(false);
    expect(res.failures.some((f) => f.reason.includes('剝離'))).toBe(true);
  });

  it('coverC2paVerified=false → 跳過，checked 0, ok', async () => {
    writeArticle('unverified', {
      coverC2paVerified: 'false',
      coverImage: './_covers/unverified.png',
    });
    // 即使檔案缺標記也不該被檢查。
    writeFileSync(path.join(coversDir, 'unverified.png'), makePlainBuffer());

    const res = await verifyArticleCovers({ contentDir, distDir });
    expect(res.ok).toBe(true);
    expect(res.checked).toBe(0);
    expect(res.failures).toHaveLength(0);
  });

  it('無 coverImage → 跳過，checked 0, ok', async () => {
    writeArticle('nocover', { coverC2paVerified: 'true' });

    const res = await verifyArticleCovers({ contentDir, distDir });
    expect(res.ok).toBe(true);
    expect(res.checked).toBe(0);
    expect(res.failures).toHaveLength(0);
  });

  it('空內容目錄 → ok, checked 0（current repo 綠燈情境）', async () => {
    const res = await verifyArticleCovers({ contentDir, distDir });
    expect(res.ok).toBe(true);
    expect(res.checked).toBe(0);
  });
});
