// engine/lib/image.ts
//
// E12 配圖：每篇文章產生一張 AI 封面圖（OpenAI Image / gpt-image-1）。
//
// 兩種模式（沿用 llm.ts 的 STUB 慣例）：
//
//   STUB 模式（無 OPENAI_API_KEY）：寫一張「確定性的佔位 PNG」到磁碟。
//     - 佔位圖是程式內合成的最小合法 PNG（純色畫布），「明顯是佔位」，
//       不是真正帶 Content Credentials 的 AI 圖。
//     - c2pa='stub-none'；對應 frontmatter 的 coverC2paVerified 應為 false。
//     - 不發任何網路請求；log.stub 標記。model='stub'。
//
//   真實模式（有 OPENAI_API_KEY）：呼叫 OpenAI Images API 生成圖。
//     - SDK 簽章（已對 node_modules/openai@6.42.0 之 resources/images.d.ts 驗證）：
//         client.images.generate(body): APIPromise<ImagesResponse>
//         ImagesResponse.data?: Array<Image>
//         Image.b64_json?: string  ← 「Returned by default for the GPT image models」
//         Image.url?:      string  ← 「Unsupported for the GPT image models」
//       故對 gpt-image-1，預設回傳 b64_json；本實作優先取 b64_json，
//       若 SDK 改回 url 則 fetch 該 URL 取 bytes（縱深處理，不猜測）。
//     - 取得的 bytes「原封不動」寫入磁碟（VERBATIM）——
//       絕不經 sharp/任何 optimizer。OpenAI 出廠即內嵌 C2PA Content Credentials
//       與 SynthID 浮水印；任何 re-encode 都會剝離 C2PA manifest。
//       保留 C2PA + SynthID 是本步驟的最高優先。
//       後續最佳化／驗證（E13）必須同樣保留或重新簽章。
//     - c2pa='embedded'；對應 coverC2paVerified 為 true。model='gpt-image-1'。
//
// client 延遲建構（只在真實分支 new OpenAI()），避免 import 時就需要 key。

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { createLogger } from './log';

const log = createLogger('image');

const MODEL = 'gpt-image-1';
const DEFAULT_SIZE = '1536x1024';
/** 預設封面輸出目錄（相對於 repo 根；真實封面會被 Astro content 引用）。 */
const DEFAULT_OUT_DIR = 'src/content/articles/_covers';

/** 無 OPENAI_API_KEY（未設或空字串）時為 STUB 模式。 */
export function isImageStubMode(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return key === undefined || key === '';
}

export interface CoverImageResult {
  /** 寫出的 PNG 檔路徑。 */
  path: string;
  /** 檔案位元組數。 */
  bytes: number;
  /**
   * 'embedded'  = 真實 AI 圖，出廠內嵌 C2PA Content Credentials（bytes 原封寫入）。
   * 'stub-none' = STUB 佔位圖，無任何 credentials。
   */
  c2pa: 'embedded' | 'stub-none';
  /** 是否為 STUB 模式產出。 */
  stub: boolean;
  /** 實際使用的模型（真實模式 'gpt-image-1'，STUB 模式 'stub'）。 */
  model: string;
}

export interface GenerateCoverImageOpts {
  /** 生圖 prompt（由標題／分歧衍生）。 */
  prompt: string;
  /** 文章 slug（決定輸出檔名 <slug>.png）。 */
  slug: string;
  /** 輸出目錄；預設 DEFAULT_OUT_DIR。 */
  outDir?: string;
  /** 圖片尺寸；預設 DEFAULT_SIZE（1536x1024）。 */
  size?: string;
}

// ── STUB 佔位 PNG 合成 ────────────────────────────────────────────────────────

/** big-endian uint32 → 4-byte Buffer。 */
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** 組一個 PNG chunk：length + type + data + CRC32。 */
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  return Buffer.concat([u32(data.length), typeBuf, data, u32(crc)]);
}

// 標準 CRC-32（PNG 用），每次呼叫即時建表，無 module 副作用。
function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 合成一張確定性的純色 16x16 PNG 佔位圖（灰底）。
 * 「明顯是佔位」：固定尺寸、純色、無任何 metadata/credentials。
 * 同一份程式碼永遠產生 byte-完全相同的輸出（確定性，利於測試）。
 */
function buildStubPng(): Buffer {
  const width = 16;
  const height = 16;
  // 每列前綴一個 filter byte(0)，RGB 三通道；純色 #9CA3AF（中性灰）。
  const r = 0x9c;
  const g = 0xa3;
  const b = 0xaf;
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([
    u32(width),
    u32(height),
    Buffer.from([8, 2, 0, 0, 0]), // bit depth 8, color type 2 (RGB), no interlace
  ]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export async function generateCoverImage(
  opts: GenerateCoverImageOpts,
): Promise<CoverImageResult> {
  const outDir = opts.outDir ?? DEFAULT_OUT_DIR;
  const size = opts.size ?? DEFAULT_SIZE;
  const outPath = path.join(outDir, `${opts.slug}.png`);

  fs.mkdirSync(outDir, { recursive: true });

  // ── STUB 模式：寫確定性佔位 PNG（無 credentials）──
  if (isImageStubMode()) {
    const png = buildStubPng();
    fs.writeFileSync(outPath, png);
    log.stub(`cover image（STUB 佔位 PNG，未發 API、無 C2PA）`, {
      slug: opts.slug,
      path: outPath,
      bytes: png.length,
    });
    return {
      path: outPath,
      bytes: png.length,
      c2pa: 'stub-none',
      stub: true,
      model: 'stub',
    };
  }

  // ── 真實模式：呼叫 OpenAI Images API，bytes 原封寫入（保留 C2PA + SynthID）──
  // client 延遲建構：只在這個分支才 import + new OpenAI()，import 時不需 key。
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI();

  log.info('cover image generate', { slug: opts.slug, model: MODEL, size });

  const res = await client.images.generate({ model: MODEL, prompt: opts.prompt, size });

  const image = res.data?.[0];
  if (image === undefined) {
    throw new Error('generateCoverImage: OpenAI 回傳的 data 為空（無圖）。');
  }

  // gpt-image 預設回 b64_json；若 SDK 改回 url 則 fetch 取 bytes。
  // 任一路徑取得的 bytes 都「原封不動」寫入——絕不 re-encode（會剝離 C2PA）。
  let bytes: Buffer;
  if (image.b64_json !== undefined && image.b64_json !== '') {
    bytes = Buffer.from(image.b64_json, 'base64');
  } else if (image.url !== undefined && image.url !== '') {
    const resp = await fetch(image.url);
    if (!resp.ok) {
      throw new Error(
        `generateCoverImage: 下載圖片失敗 HTTP ${resp.status}（url=${image.url}）。`,
      );
    }
    bytes = Buffer.from(await resp.arrayBuffer());
  } else {
    throw new Error('generateCoverImage: OpenAI 回傳的圖片既無 b64_json 也無 url。');
  }

  // VERBATIM 寫入：不經 sharp/任何 optimizer，保留出廠 C2PA Content Credentials
  // 與 SynthID。後續 E13 的最佳化／驗證必須同樣保留或重新簽章。
  fs.writeFileSync(outPath, bytes);

  log.info('cover image written（bytes 原封寫入，C2PA 已保留）', {
    slug: opts.slug,
    path: outPath,
    bytes: bytes.length,
    model: MODEL,
  });

  return {
    path: outPath,
    bytes: bytes.length,
    c2pa: 'embedded',
    stub: false,
    model: MODEL,
  };
}
