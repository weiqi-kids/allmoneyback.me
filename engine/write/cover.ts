// engine/write/cover.ts
//
// E12 配圖管線接點：把一張封面圖「掛」到一份已驗證草稿上。
//
// 流程：
//   1. 由草稿 frontmatter（標題／分歧）衍生生圖 prompt。
//   2. generateCoverImage(...)（真實模式呼叫 OpenAI；STUB 寫佔位 PNG）。
//   3. 把 coverImage 路徑與 coverC2paVerified 寫進 frontmatter：
//        coverC2paVerified = (c2pa==='embedded')
//        —— 只有真實、帶 Content Credentials 的圖才為 true；STUB 佔位 → false。
//   4. 重新過一次生產用 articlesSchema（fail loud），重組 markdown
//      （日期保持 'YYYY-MM-DD' 字串，與 write/critique 的序列化策略一致）。
//
// 設計：不在這裡寫死 coverImage——它由實際產出決定；未呼叫此函式時 coverImage 維持 unset。

import yaml from 'js-yaml';
import { articlesSchema } from '../../src/schemas/articles';
import { generateCoverImage } from '../lib/image.js';
import type { DraftArticle } from './index.js';
import { createLogger } from '../lib/log.js';

const log = createLogger('cover');

/** 由標題＋錨點/對照衍生一段中性、跨文化的配圖 prompt。 */
function buildCoverPrompt(fm: DraftArticle['frontmatter']): string {
  const cultures = [fm.anchorCulture, ...fm.comparedCultures].join('、');
  return [
    `為一篇跨文化觀察文章設計一張封面插畫。主題：「${fm.title}」。`,
    `涉及的文化處境：${cultures}。`,
    '風格：中性、現代、編輯插畫；呈現「並置／對照」而非評判任何一方；',
    '避免刻板的民族符號與國旗；構圖留白、適合作為文章頂部橫幅。',
  ].join('');
}

/**
 * 把 frontmatter（日期為 Date）轉回 YAML 用的原始物件（日期還原成字串）。
 * 與 write/index.ts、critique/index.ts 的序列化策略一致。
 */
function frontmatterToRaw(fm: DraftArticle['frontmatter']): Record<string, unknown> {
  return {
    ...fm,
    generatedDate: fm.generatedDate.toISOString().slice(0, 10),
    updatedDate: fm.updatedDate.toISOString().slice(0, 10),
  };
}

export interface AttachCoverOpts {
  /** 封面輸出目錄；預設交給 generateCoverImage（src/content/articles/_covers）。 */
  outDir?: string;
  /** 圖片尺寸覆寫。 */
  size?: string;
  /**
   * frontmatter.coverImage 要寫入的「參照路徑」覆寫。
   * 預設用 generateCoverImage 回傳的實際寫出路徑。
   */
  coverImagePath?: string;
}

export interface AttachCoverResult {
  draft: DraftArticle;
  c2pa: 'embedded' | 'stub-none';
  coverC2paVerified: boolean;
  stub: boolean;
  model: string;
  /** 圖片實際寫出的磁碟路徑。 */
  imagePath: string;
}

/**
 * 為一份草稿產生封面圖並把結果掛回 frontmatter，回傳更新後的草稿。
 * coverC2paVerified 只有在 c2pa==='embedded'（真實帶 credentials 的圖）時才為 true。
 */
export async function attachCoverImage(
  draft: DraftArticle,
  slug: string,
  opts?: AttachCoverOpts,
): Promise<AttachCoverResult> {
  const prompt = buildCoverPrompt(draft.frontmatter);

  const result = await generateCoverImage({
    prompt,
    slug,
    outDir: opts?.outDir,
    size: opts?.size,
  });

  const coverC2paVerified = result.c2pa === 'embedded';

  // frontmatter.coverImage：預設用實際寫出路徑；呼叫端可覆寫成 Astro 可引用的相對路徑。
  const coverImage = opts?.coverImagePath ?? result.path;

  const raw = frontmatterToRaw(draft.frontmatter);
  raw.coverImage = coverImage;
  raw.coverC2paVerified = coverC2paVerified;

  // 重新過生產用 articlesSchema（fail loud）。
  const frontmatter = articlesSchema.parse(raw);

  const yamlBlock = yaml.dump(raw, { lineWidth: -1, noRefs: true });
  const markdown = `---\n${yamlBlock}---\n\n${draft.body}\n`;

  log.info('cover attached', {
    slug,
    coverImage,
    coverC2paVerified,
    c2pa: result.c2pa,
    stub: result.stub,
  });

  return {
    draft: { frontmatter, body: draft.body, markdown },
    c2pa: result.c2pa,
    coverC2paVerified,
    stub: result.stub,
    model: result.model,
    imagePath: result.path,
  };
}
