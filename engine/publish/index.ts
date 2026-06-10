// engine/publish/index.ts
//
// E10（檔案落地部分）：把一份「已批判」的草稿寫到磁碟。
// 兩個落地動作，刻意分開，互不知道對方：
//   - publishArticle：寫進「會被網站 build 的內容目錄」（預設 src/content/articles/）。
//   - quarantineDraft：寫進「不會被 build 的審查目錄」（預設 repo root 的 _review/）。
//
// 規格的風險閘門（§4.2／§10.6）由 route/index.ts 決策「往哪寫」；本檔只負責「怎麼寫」。
// 刻意把 git commit/push 排除在這兩個函式之外——那是 E11 的 Actions workflow 的事，
// 否則測試一寫檔就 commit，會污染 repo。
//
// slug 命名方案（slugForDraft）：
//   形如 `<domainTopic>-<shorthash>`：
//     - domainTopic：草稿的 domainTopic（已是 ASCII，例如 'overtime'），
//       再經 asciiSlugify 正規化（小寫、空白→'-'、去掉非 [a-z0-9-] 字元）。
//       若正規化後為空（理論上不該發生，domainTopic 應為 ASCII），退回 'article'。
//     - shorthash：title 的 sha256 取前 8 個 hex 字元。
//       為什麼用 hash？中文標題不能直接當檔名 slug（非 ASCII、含空白／標點），
//       但又需要「同一份草稿 → 同一個檔名」的確定性與唯一性。
//       hash 提供 ASCII 安全、確定（純函式）、且足以區辨不同標題的 slug 尾段。
//   全小寫、無空白、僅 [a-z0-9-]，可安全當作跨平台檔名。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { createLogger } from '../lib/log.js';
import type { DraftArticle } from '../write/index.js';

const log = createLogger('publish');

/** 預設內容目錄（會被 Astro build）——相對 repo root。 */
export const DEFAULT_CONTENT_DIR = 'src/content/articles';
/** 預設審查目錄（在 src 之外，永遠不會被 build）——相對 repo root。 */
export const DEFAULT_REVIEW_DIR = '_review';

// ── 對外型別 ──────────────────────────────────────────────────────────────────

export interface PublishResult {
  /** 'published' = 寫進內容目錄（會上線）；'quarantined' = 寫進審查目錄（不上線）。 */
  action: 'published' | 'quarantined';
  /** 實際寫入的檔案路徑。 */
  path: string;
  /** 此草稿的 slug（= 檔名去掉 .md，未含去重後綴）。 */
  slug: string;
  /** 隔離時附帶的 issue 開立資訊（由 route 層填入）。 */
  issue?: { created: boolean; ref?: string; stub: boolean };
}

// ── slug ──────────────────────────────────────────────────────────────────────

/**
 * 把任意字串正規化成 ASCII slug 片段：小寫、空白→'-'、僅保留 [a-z0-9-]、
 * 摺疊連續 '-'、去頭尾 '-'。非 ASCII 字元（如中文）會被整段移除。
 */
function asciiSlugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 由草稿確定性地產生 slug：`<domainTopic>-<shorthash>`。
 * shorthash = sha256(title) 的前 8 個 hex 字元。
 * 同一份草稿（同 domainTopic + 同 title）→ 同一個 slug。
 * 保證 ASCII 安全、全小寫、無空白，可當跨平台檔名。
 * 詳見檔頭「slug 命名方案」。
 */
export function slugForDraft(draft: DraftArticle): string {
  const topic = asciiSlugify(draft.frontmatter.domainTopic) || 'article';
  const shorthash = createHash('sha256')
    .update(draft.frontmatter.title, 'utf8')
    .digest('hex')
    .slice(0, 8);
  return `${topic}-${shorthash}`;
}

// ── 寫檔（共用）────────────────────────────────────────────────────────────────

/**
 * 把 markdown 寫到 <dir>/<slug>.md。
 * 去重策略：若同名檔已存在且「內容不同」，不覆寫——改用 <slug>-2.md、<slug>-3.md……
 * （逐一遞增直到找到空檔名），並 log.warn。
 * 若同名檔已存在且「內容相同」（同一份草稿重跑），視為 idempotent，直接回該路徑、不再寫。
 * 回傳實際寫入（或既有相同）的檔案絕對／相對路徑。
 */
function writeMarkdown(dir: string, slug: string, markdown: string): string {
  fs.mkdirSync(dir, { recursive: true });

  const primary = path.join(dir, `${slug}.md`);
  if (fs.existsSync(primary)) {
    const existing = fs.readFileSync(primary, 'utf8');
    if (existing === markdown) {
      // 同一份草稿重跑：idempotent，不重寫。
      log.info('slug 既有檔內容相同，視為 idempotent，不重寫', { path: primary });
      return primary;
    }
    // 同名但內容不同：絕不靜默覆寫，改找帶數字後綴的空檔名。
    for (let n = 2; ; n++) {
      const candidate = path.join(dir, `${slug}-${n}.md`);
      if (!fs.existsSync(candidate)) {
        log.warn('slug 衝突（既有檔內容不同），改用數字後綴避免覆寫', {
          slug,
          wrote: candidate,
        });
        fs.writeFileSync(candidate, markdown, 'utf8');
        return candidate;
      }
      const c = fs.readFileSync(candidate, 'utf8');
      if (c === markdown) {
        log.info('帶後綴檔內容相同，視為 idempotent，不重寫', { path: candidate });
        return candidate;
      }
    }
  }

  fs.writeFileSync(primary, markdown, 'utf8');
  return primary;
}

// ── 對外函式 ──────────────────────────────────────────────────────────────────

/**
 * 把草稿「發布」成上線文章：寫 draft.markdown 到 <contentDir>/<slug>.md。
 * 不做 git commit/push（那是 E11 workflow 的事）。
 */
export function publishArticle(
  draft: DraftArticle,
  opts?: { contentDir?: string },
): PublishResult {
  const dir = opts?.contentDir ?? DEFAULT_CONTENT_DIR;
  const slug = slugForDraft(draft);
  const filePath = writeMarkdown(dir, slug, draft.markdown);
  log.info('article published', { slug, path: filePath });
  return { action: 'published', path: filePath, slug };
}

/**
 * 把草稿「隔離」進審查目錄：寫 draft.markdown 到 <reviewDir>/<slug>.md。
 * reviewDir 預設在 src 之外（repo root 的 _review/），永遠不會被 Astro build。
 */
export function quarantineDraft(
  draft: DraftArticle,
  opts?: { reviewDir?: string },
): PublishResult {
  const dir = opts?.reviewDir ?? DEFAULT_REVIEW_DIR;
  const slug = slugForDraft(draft);
  const filePath = writeMarkdown(dir, slug, draft.markdown);
  log.warn('draft quarantined（高立場風險，不發布）', { slug, path: filePath });
  return { action: 'quarantined', path: filePath, slug };
}
