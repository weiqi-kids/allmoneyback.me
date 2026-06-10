// engine/analytics/feedback.ts
//
// E16 好題回饋循環。規格 §10.8-(3)。
//
// 構想：把「表現好的已發文章」的 frontmatter 特徵（子題 / 定錨文化 / 文化對組）
// 萃取出來，回灌成選題引擎的「軟偏好」訊號，讓 AI 的「觀察品味」隨流量回饋
// 慢慢往讀者真的有共鳴的方向校準——但「只是軟偏好」，不得凌駕中立與 B/A 判準。
//
// 資料流：
//   GA4 流量報告（ga4.buildOwnerReport）→ scoreArticle 每篇打分 →
//   取 topN（含 session 雜訊地板）→ 讀各篇 frontmatter →
//   聚合 domainTopic / anchorCulture / anchor::compared 對組 →
//   SelectionPreferences（存進 store）→ select.buildSystemPrompt 取讀為軟偏好。
//
// 確定性：STUB 報告本身是確定性的；本模組不發任何網路請求（GA4 由 ga4.ts 在
//   STUB 模式下回離線替身）。report 為 stub 或全部低於地板時，仍「確定性地」
//   產出一份盡力而為（可能為空）的偏好，不崩。

import * as fs from 'node:fs';
import * as path from 'node:path';

import yaml from 'js-yaml';

import { GOOD_TOPIC_CRITERIA } from '../config/criteria.js';
import { buildOwnerReport, type ArticleMetric, type TrafficReport } from './ga4.js';
import { readJson, writeJson } from '../lib/store.js';
import { createLogger } from '../lib/log.js';

const log = createLogger('feedback');

// ── 常數 ──────────────────────────────────────────────────────────────────────

/** 預設取分數最高的前幾篇當「好題範本」。 */
const DEFAULT_TOP_N = 5;

/** 雜訊地板：工作階段太少（< 此值）的文章流量訊號不可靠，不納入好題範本。 */
const SESSION_FLOOR = 10;

/** 文章 frontmatter 預設目錄（相對 cwd，與站台一致）。 */
const DEFAULT_CONTENT_DIR = 'src/content/articles';

/** 偏好 store 名稱（engine/data/select-preferences.json）。 */
const PREFERENCES_STORE = 'select-preferences';

/** sampleTitles 最多收幾筆（保持有界）。 */
const SAMPLE_TITLES_LIMIT = 5;

// ── 型別 ──────────────────────────────────────────────────────────────────────

/**
 * 回灌給選題引擎的偏好訊號（來自流量回饋）。
 * 三個 Array 都依 weight 由高到低排序。weight 是「好題分數」的累加（非機率，僅供排序與相對比較）。
 */
export interface SelectionPreferences {
  /** 產生時間（ISO）。 */
  updatedAt: string;
  /** 表現好的子題（domainTopic）。 */
  topSubtopics: Array<{ domainTopic: string; weight: number }>;
  /** 表現好的定錨文化（anchorCulture）。 */
  topAnchors: Array<{ culture: string; weight: number }>;
  /** 表現好的文化對組（anchor::compared-sorted）。 */
  topPairs: Array<{ key: string; weight: number }>;
  /** 幾篇好題範本標題（供 prompt 舉例，純參考）。 */
  sampleTitles: string[];
}

/** 一篇文章 frontmatter 中本模組關心的欄位（其餘忽略）。 */
interface ArticleFrontmatter {
  title?: string;
  domainTopic?: string;
  anchorCulture?: string;
  comparedCultures?: string[];
}

// ── 評分（PURE）───────────────────────────────────────────────────────────────

/**
 * 把一篇文章的流量指標打成 0..1 ish 的「好題分數」，依 GOOD_TOPIC_CRITERIA.signalWeights
 * 加權三個正規化後的訊號：
 *
 *   engagementRate — GA4 互動率本身就是 0..1，直接用（clamp 到 [0,1]）。
 *   dwell          — avgEngagementTimeSec / 120，capped 於 1。
 *                    （取 120 秒為「充分閱讀」的代理上限：到 2 分鐘即視為滿分停留。）
 *   organicSearch  — organicSessions / sessions（自然搜尋占比），sessions=0 時記 0（防除零）。
 *
 * 回傳值 = Σ(weight_i × signal_i)。因三個 signal 都已正規化到 [0,1]、權重總和為 1，
 * 結果落在 [0,1]。權重越偏向某訊號，該訊號就越主導排序（故高互動文章分數高於低互動文章）。
 */
export function scoreArticle(
  m: ArticleMetric,
  weights: { engagementRate: number; dwell: number; organicSearch: number } =
    GOOD_TOPIC_CRITERIA.signalWeights,
): number {
  const engagement = clamp01(m.engagementRate);
  const dwell = clamp01(m.avgEngagementTimeSec / 120);
  const organic = m.sessions > 0 ? clamp01(m.organicSessions / m.sessions) : 0;

  return (
    weights.engagementRate * engagement +
    weights.dwell * dwell +
    weights.organicSearch * organic
  );
}

// ── 萃取好題訊號 ──────────────────────────────────────────────────────────────

/**
 * 從流量報告萃取好題偏好：
 *   1. 取流量報告（buildOwnerReport，除非 opts.report 注入）。
 *   2. 每篇 scoreArticle，套 session 地板（sessions ≥ SESSION_FLOOR）過濾雜訊，
 *      依分數由高到低取 topN。若全部低於地板或 report 為 stub 仍盡力而為（可能為空）。
 *   3. 各 top 文章讀其 frontmatter（<contentDir>/<slug>.md，js-yaml 解析 --- 之間），
 *      檔案不存在則略過。
 *   4. 依 domainTopic / anchorCulture / anchor::compared 對組聚合（以好題分數累加為 weight）。
 *   5. 回 SelectionPreferences（updatedAt = opts.now ?? 現在）。
 */
export async function extractGoodTopicSignals(opts?: {
  contentDir?: string;
  topN?: number;
  now?: string;
  report?: TrafficReport;
}): Promise<SelectionPreferences> {
  const contentDir = opts?.contentDir ?? DEFAULT_CONTENT_DIR;
  const topN = opts?.topN ?? DEFAULT_TOP_N;
  const now = opts?.now ?? new Date().toISOString();

  // 1) 報告來源：注入優先；否則 buildOwnerReport（STUB 時為離線替身，不發請求）。
  const report = opts?.report ?? (await buildOwnerReport()).report;

  // 2) 打分 + session 地板 + 取 topN（分數高到低；同分以 sessions 多者優先，確定性）。
  const scored = report.articles
    .filter((a) => a.sessions >= SESSION_FLOOR)
    .map((a) => ({ a, score: scoreArticle(a) }))
    .sort((x, y) => y.score - x.score || y.a.sessions - x.a.sessions);

  const top = scored.slice(0, topN);

  // 3+4) 讀 frontmatter、聚合。
  const subtopicWeights = new Map<string, number>();
  const anchorWeights = new Map<string, number>();
  const pairWeights = new Map<string, number>();
  const sampleTitles: string[] = [];

  for (const { a, score } of top) {
    const fm = readFrontmatter(contentDir, a.slug);
    if (!fm) continue; // 檔案缺失 → 略過（GA4 可能有非本站或已下架的路徑）。

    if (fm.domainTopic) addWeight(subtopicWeights, fm.domainTopic, score);
    if (fm.anchorCulture) addWeight(anchorWeights, fm.anchorCulture, score);

    const pairKey = makePairKey(fm.anchorCulture, fm.comparedCultures);
    if (pairKey) addWeight(pairWeights, pairKey, score);

    if (fm.title && sampleTitles.length < SAMPLE_TITLES_LIMIT) {
      sampleTitles.push(fm.title);
    }
  }

  const prefs: SelectionPreferences = {
    updatedAt: now,
    topSubtopics: toSortedList(subtopicWeights).map(([domainTopic, weight]) => ({
      domainTopic,
      weight,
    })),
    topAnchors: toSortedList(anchorWeights).map(([culture, weight]) => ({ culture, weight })),
    topPairs: toSortedList(pairWeights).map(([key, weight]) => ({ key, weight })),
    sampleTitles,
  };

  log.info('extractGoodTopicSignals', {
    stub: report.stub,
    consideredArticles: scored.length,
    topN,
    subtopics: prefs.topSubtopics.length,
    anchors: prefs.topAnchors.length,
    pairs: prefs.topPairs.length,
  });

  return prefs;
}

// ── 偏好存取 ──────────────────────────────────────────────────────────────────

/** 把偏好寫進 store（engine/data/<storeName>.json，預設 select-preferences）。 */
export function writeSelectionPreferences(
  prefs: SelectionPreferences,
  opts?: { storeName?: string },
): void {
  const storeName = opts?.storeName ?? PREFERENCES_STORE;
  writeJson(storeName, prefs);
  log.info('writeSelectionPreferences', { storeName, subtopics: prefs.topSubtopics.length });
}

/** 讀偏好；store 不存在時回 null（select 在 null 時不附偏好區段）。 */
export function getSelectionPreferences(opts?: {
  storeName?: string;
}): SelectionPreferences | null {
  const storeName = opts?.storeName ?? PREFERENCES_STORE;
  // readJson 在檔案不存在時回 fallback；用一個哨兵物件分辨「無檔」。
  const sentinel = Symbol('absent');
  const got = readJson<SelectionPreferences | typeof sentinel>(
    storeName,
    sentinel as unknown as SelectionPreferences,
  );
  if (got === (sentinel as unknown)) return null;
  return got as SelectionPreferences;
}

// ── 小工具 ────────────────────────────────────────────────────────────────────

/** 讀並解析一篇文章的 frontmatter；檔案不存在或無 --- fence 回 null。 */
function readFrontmatter(contentDir: string, slug: string): ArticleFrontmatter | null {
  const filePath = path.join(contentDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf8');
  // 取開頭 --- 與下一個 --- 之間的 yaml 區塊。
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  try {
    const parsed = yaml.load(match[1]) as ArticleFrontmatter | undefined;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    log.warn('frontmatter parse failed', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** 對組 key：<anchor>::<compared 排序後以 + 連接>。anchor 或 compared 缺則回 null。 */
function makePairKey(
  anchor: string | undefined,
  compared: string[] | undefined,
): string | null {
  if (!anchor || !Array.isArray(compared) || compared.length === 0) return null;
  const sorted = [...compared].sort((a, b) => a.localeCompare(b));
  return `${anchor}::${sorted.join('+')}`;
}

/** 累加權重到 map。 */
function addWeight(map: Map<string, number>, key: string, w: number): void {
  map.set(key, (map.get(key) ?? 0) + w);
}

/**
 * map → 依 weight 由高到低排序的 [key, weight] 陣列。
 * 同 weight 以 key 字典序確保確定性。weight 四捨五入到 4 位小數。
 */
function toSortedList(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()]
    .map(([k, w]) => [k, round4(w)] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** clamp 到 [0,1]（含 NaN 防護）。 */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** 四捨五入到 4 位小數。 */
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
