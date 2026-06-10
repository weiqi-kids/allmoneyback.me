// engine/route/index.ts
//
// E10 風險分流（route）：規格的「風險閘門」（§4.2／§10.6）。
// 拿 critique（E9）的決策結果，決定一份草稿往哪去：
//   - routedToReview === false（低立場風險、過關）→ publishArticle：寫進 src/content/
//     （成為上線文章）。
//   - routedToReview === true（高立場風險）→ quarantineDraft：寫進 _review/（不 build、不上線），
//     並開一個 GitHub issue 待人工審查，同時把 review-queue 計數 +1。
//
// ⚠️ 安全性質（最重要）：高風險草稿「絕不」寫進 src/content/——
//   分流是二選一，quarantine 與 publish 互斥，高風險只走 quarantine 那條路。
//
// 開 issue 的真實副作用（gh CLI）刻意「可注入」（opts.openIssue），
//   預設 openReviewIssue 在「沒有 token」時 short-circuit 成 STUB（不 shell out），
//   測試因而永遠不會真的開 issue 或 shell out。

import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';

import { createLogger } from '../lib/log.js';
import { readJson, writeJson } from '../lib/store.js';
import type { DraftArticle } from '../write/index.js';
import {
  publishArticle,
  quarantineDraft,
  DEFAULT_REVIEW_DIR,
  type PublishResult,
} from '../publish/index.js';
import type { CritiqueResult } from '../critique/index.js';

const log = createLogger('route');

/** 待審計數在 store 裡的記錄名。 */
const DEFAULT_STORE_NAME = 'review-queue';

interface ReviewQueueRecord {
  /** 累計被隔離的草稿數。 */
  count: number;
  /** 被隔離的 slug 清單（去重，方便除錯與 E15 報告）。 */
  slugs: string[];
}

/** issue opener 的回傳契約。 */
export interface IssueResult {
  created: boolean;
  ref?: string;
  stub: boolean;
}

/** route 函式可注入的選項。 */
export interface RouteOpts {
  /** 發布目標目錄（測試用；預設 src/content/articles）。 */
  contentDir?: string;
  /** 隔離目標目錄（測試用；預設 _review）。 */
  reviewDir?: string;
  /** 開 issue 的實作（測試可注入 stub）；預設真實的 openReviewIssue。 */
  openIssue?: (draft: DraftArticle, slug: string) => Promise<IssueResult>;
  /** review-queue 計數在 store 的記錄名（測試可改名隔離）。 */
  storeName?: string;
}

// ── 主分流函式 ────────────────────────────────────────────────────────────────

/**
 * 依 critique 結果分流並落地：
 *   - routedToReview=true（高風險）→ quarantineDraft + 開 issue + 待審計數 +1，
 *     回傳 action='quarantined'（帶 issue 資訊）。
 *   - 否則（低風險、過關）→ publishArticle，回傳 action='published'。
 *
 * 安全性質：高風險只走 quarantine 分支，永不呼叫 publishArticle，
 *   因此永不寫進 contentDir（src/content）。
 */
export async function routeAndPublish(
  critiqueResult: CritiqueResult,
  opts?: RouteOpts,
): Promise<PublishResult> {
  const { draft, routedToReview } = critiqueResult;

  if (routedToReview) {
    // ── 高風險：隔離（絕不碰 contentDir）──
    const result = quarantineDraft(draft, { reviewDir: opts?.reviewDir });
    const slug = result.slug;

    // ── 開 issue（可注入；預設真實 opener，無 token 時 stub）──
    const opener = opts?.openIssue ?? openReviewIssue;
    const issue = await opener(draft, slug);

    // ── 待審計數 +1（push slug，去重）──
    bumpReviewQueue(slug, opts?.storeName);

    log.warn('routed to review（高立場風險）', {
      slug,
      path: result.path,
      issueCreated: issue.created,
      issueStub: issue.stub,
    });

    return { ...result, issue };
  }

  // ── 低風險：發布上線 ──
  const result = publishArticle(draft, { contentDir: opts?.contentDir });
  log.info('published（低立場風險，已過關）', { slug: result.slug, path: result.path });
  return result;
}

// ── 待審計數 ──────────────────────────────────────────────────────────────────

/** 把一個被隔離的 slug 記進 store 的 review-queue 計數（slug 去重）。 */
function bumpReviewQueue(slug: string, storeName?: string): void {
  const name = storeName ?? DEFAULT_STORE_NAME;
  const rec = readJson<ReviewQueueRecord>(name, { count: 0, slugs: [] });
  if (!rec.slugs.includes(slug)) {
    rec.slugs.push(slug);
  }
  // count = 不重複 slug 數，與 slugs 同步（避免重跑同一草稿灌水）。
  rec.count = rec.slugs.length;
  writeJson(name, rec);
}

// ── 開 GitHub issue（真實 / STUB）──────────────────────────────────────────────

/**
 * 是否具備真的開 issue 的條件：需要 GITHUB_TOKEN（gh CLI 在 CI 用它認證）。
 * 沒有 token → 一律走 STUB，不 shell out。
 */
function canOpenIssue(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

/**
 * 開一個「待審」GitHub issue（高立場風險草稿）。
 *
 * 有 GITHUB_TOKEN → 用 gh CLI 真的開 issue，回傳 { created:true, ref:<url>, stub:false }。
 * 沒有（含測試／本機無 token）→ STUB：log.stub 記下 TODO，回傳 { created:false, stub:true }，
 *   「不」shell out。預設分支因此在測試中永遠 short-circuit 成 stub。
 */
export async function openReviewIssue(
  draft: DraftArticle,
  slug: string,
): Promise<IssueResult> {
  const title = `待審：${draft.frontmatter.title}（立場事故風險高）`;
  const body = buildIssueBody(draft, slug);

  if (!canOpenIssue()) {
    log.stub('開 issue 略過（無 GITHUB_TOKEN）——TODO：補開待審 issue', {
      slug,
      title,
    });
    return { created: false, stub: true };
  }

  // 真實分支：只有在有 token 時才 shell out gh。
  try {
    const out = execFileSync(
      'gh',
      ['issue', 'create', '--title', title, '--body', body, '--label', 'review'],
      { encoding: 'utf8' },
    ).trim();
    // gh 通常把新 issue 的 URL 印在最後一行。
    const ref = out.split('\n').filter(Boolean).pop();
    log.info('待審 issue 已開立', { slug, ref });
    return { created: true, ref, stub: false };
  } catch (err) {
    // 開 issue 失敗不該讓整條 pipeline 崩——草稿已安全隔離，issue 可事後補。
    log.error('開 issue 失敗（草稿已隔離，可事後補開）', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return { created: false, stub: false };
  }
}

/** 組 issue 內文：草稿摘要 + slug + 隔離原因。 */
function buildIssueBody(draft: DraftArticle, slug: string): string {
  const fm = draft.frontmatter;
  const reviewPath = `${DEFAULT_REVIEW_DIR}/${slug}.md`;
  return [
    `這份草稿被批判 AI（E9）判定立場事故風險為 **${fm.stanceRiskLevel}**，已自動隔離待人工審查。`,
    '',
    `- **標題**：${fm.title}`,
    `- **slug**：\`${slug}\``,
    `- **子題領域**：${fm.domainTopic}`,
    `- **定錨文化**：${fm.anchorCulture}`,
    `- **對照文化**：${fm.comparedCultures.join('、')}`,
    `- **隔離檔案**：\`${reviewPath}\`（在 src 之外，不會被 build／上線）`,
    '',
    '## 摘要',
    fm.tldr,
    '',
    '## 處理方式',
    '人工檢視 `_review/` 內的草稿，修掉立場事故後再決定是否手動發布到 `src/content/articles/`。',
  ].join('\n');
}

// ── 待審計數查詢（E15 流量報告用）─────────────────────────────────────────────

/**
 * 回傳目前待審（被隔離）的草稿數。
 * 優先以「審查目錄裡的 .md 檔數」為準（檔案系統是真相）；
 * 目錄不存在時退回 store 的計數器。
 */
export function getReviewQueueCount(opts?: {
  reviewDir?: string;
  storeName?: string;
}): number {
  const dir = opts?.reviewDir ?? DEFAULT_REVIEW_DIR;
  if (fs.existsSync(dir)) {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .length;
  }
  const rec = readJson<ReviewQueueRecord>(opts?.storeName ?? DEFAULT_STORE_NAME, {
    count: 0,
    slugs: [],
  });
  return rec.count;
}
