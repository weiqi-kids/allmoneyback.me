// engine/analytics/ga4.ts
//
// E15 流量讀取（GA4 Data API）+ 異常訊號（站長報告用）。規格 §10.8-(2)。
//
// 兩種模式（與 engine 其他 provider 一致）：
//   STUB（無 GA4 憑證）：回一份確定性的離線替身報告（log.stub 標記），「絕不」發網路請求。
//   真實：用 @google-analytics/data 的 BetaAnalyticsDataClient（service account 認證）跑 runReport。
//
// ── GA4 vs 舊版 GA 的關鍵差異 ───────────────────────────────────────────────
// GA4「沒有」跳出率（bounce rate）這個一級指標，改用「互動率」engagementRate
// （= 有互動的工作階段 / 總工作階段）。規格的「跳出率異常」在 GA4 語境＝
// 「互動率異常偏低」（engagement rate abnormally LOW）—— 互動率越低代表越像跳出。
// 因此 detectAnomalies 偵測的是「互動率遠低於中位數」的文章。
//
// ── 流量驟降 = 降權早期警訊（不是準確訊號）────────────────────────────────
// GA4 的工作階段數驟降只能當「可能被降權」的早期警訊。降權的「準確」來源是
// Google Search Console（曝光/點擊/排名）。GSC 在本專案列為 OPERATIONS 手動項，
// 「不」在此實作；traffic-drop 訊號的 detail 會明確指向 GSC 作為準確查證來源。
//
// ── runReport SDK 形狀（已對 node_modules/@google-analytics/data v6.1.0 型別確認）──
//   new BetaAnalyticsDataClient(opts?: ClientOptions)
//     ClientOptions.credentials?: { client_email, private_key }
//     不傳 credentials → SDK 走 ADC，自動讀環境變數 GOOGLE_APPLICATION_CREDENTIALS。
//   client.runReport(request) → Promise<[IRunReportResponse, ...]>（destructure 取第一個）。
//   request: { property: 'properties/<id>', dateRanges:[{startDate,endDate}],
//              dimensions:[{name}], metrics:[{name}],
//              dimensionFilter:{ filter:{ fieldName, stringFilter:{ value, matchType } } } }
//   response: rows[]：{ dimensionValues:[{value:string}], metricValues:[{value:string}] }
//             totals[]：IRow[]（metricValues 為字串，需 Number() 解析）

import { createLogger } from '../lib/log.js';
import { getReviewQueueCount } from '../route/index.js';

const log = createLogger('ga4');

// ── 型別 ──────────────────────────────────────────────────────────────────────

/** 單篇文章的流量指標（一個 pagePath / slug 一筆）。 */
export interface ArticleMetric {
  /** 文章 slug（由 pagePath 去掉 /zh/articles/ 與尾斜線得到）。 */
  slug: string;
  /** 原始 pagePath（GA4 維度 pagePath 的值）。 */
  path: string;
  /** 工作階段數。 */
  sessions: number;
  /** 互動率（0..1）。GA4 取代舊版跳出率的一級指標。 */
  engagementRate: number;
  /** 平均單一工作階段互動秒數（userEngagementDuration / sessions）。 */
  avgEngagementTimeSec: number;
  /** 自然搜尋（Organic Search）帶來的工作階段數。 */
  organicSessions: number;
}

/** 一份站長流量報告（涵蓋 rangeDays 天 + 前一個等長視窗的對照）。 */
export interface TrafficReport {
  /** 報告涵蓋天數。 */
  rangeDays: number;
  /** 本期站台合計。 */
  totals: { sessions: number; engagementRate: number };
  /** 前一個等長視窗的站台合計（供流量驟降比較）。 */
  prevTotals: { sessions: number };
  /** 各文章指標。 */
  articles: ArticleMetric[];
  /** 是否為 STUB（離線替身）報告。 */
  stub: boolean;
}

/** 異常訊號。 */
export interface AnomalySignal {
  /** 訊號種類：互動率偏低／流量驟降。 */
  kind: 'engagement-low' | 'traffic-drop';
  /** 嚴重度：warn（提醒）／alert（警報）。 */
  severity: 'warn' | 'alert';
  /** 人類可讀說明（含落差數字與建議查證來源）。 */
  detail: string;
  /** engagement-low 為單篇文章訊號時帶 slug；traffic-drop 為站台層級不帶。 */
  slug?: string;
}

// ── STUB 憑證判定 ─────────────────────────────────────────────────────────────

/**
 * STUB 模式：除非「同時」具備 GA4_PROPERTY_ID 與一個憑證來源
 * （GOOGLE_APPLICATION_CREDENTIALS 檔案路徑 或 GA4_SA_KEY 內聯 JSON），否則一律 STUB。
 * 缺任一 → true（走離線替身，不發請求）。
 */
export function isGa4StubMode(): boolean {
  const hasProperty = Boolean(process.env.GA4_PROPERTY_ID);
  const hasCredential =
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) || Boolean(process.env.GA4_SA_KEY);
  return !(hasProperty && hasCredential);
}

// ── 常數 ──────────────────────────────────────────────────────────────────────

const DEFAULT_RANGE_DAYS = 28;
/** pagePath → slug 的文章路徑前綴（與站台路由一致）。 */
const ARTICLE_PATH_PREFIX = '/zh/articles/';

// ── 公開 API：fetchTrafficReport ──────────────────────────────────────────────

/**
 * 讀取流量報告。
 * STUB（無憑證）：回確定性離線替身（stub:true），不發任何請求。
 * 真實：用 BetaAnalyticsDataClient 跑 runReport（本期 + 前一等長視窗 + 自然搜尋）。
 */
export async function fetchTrafficReport(opts?: {
  rangeDays?: number;
}): Promise<TrafficReport> {
  const rangeDays = opts?.rangeDays ?? DEFAULT_RANGE_DAYS;

  if (isGa4StubMode()) {
    return stubReport(rangeDays);
  }

  return realReport(rangeDays);
}

/** 確定性 STUB 報告：幾篇文章 + 本期/前期合計，數字寫死方便測試與離線開發。 */
function stubReport(rangeDays: number): TrafficReport {
  const articles: ArticleMetric[] = [
    {
      slug: 'overtime-attitudes',
      path: `${ARTICLE_PATH_PREFIX}overtime-attitudes/`,
      sessions: 420,
      engagementRate: 0.62,
      avgEngagementTimeSec: 95,
      organicSessions: 310,
    },
    {
      slug: 'tipping-culture',
      path: `${ARTICLE_PATH_PREFIX}tipping-culture/`,
      sessions: 280,
      engagementRate: 0.58,
      avgEngagementTimeSec: 88,
      organicSessions: 190,
    },
    {
      slug: 'queueing-norms',
      path: `${ARTICLE_PATH_PREFIX}queueing-norms/`,
      sessions: 150,
      engagementRate: 0.55,
      avgEngagementTimeSec: 72,
      organicSessions: 96,
    },
  ];

  const totalSessions = articles.reduce((s, a) => s + a.sessions, 0);
  // 站台互動率以工作階段加權平均。
  const weightedEngagement =
    articles.reduce((s, a) => s + a.engagementRate * a.sessions, 0) / totalSessions;

  const report: TrafficReport = {
    rangeDays,
    totals: { sessions: totalSessions, engagementRate: round4(weightedEngagement) },
    // 前期略低（+ 約 10% 的本期成長），是「正常」沒有驟降的對照。
    prevTotals: { sessions: Math.round(totalSessions / 1.1) },
    articles,
    stub: true,
  };

  log.stub(`fetchTrafficReport（STUB 模式，未發 GA4 請求）`, {
    rangeDays,
    articles: articles.length,
    sessions: totalSessions,
  });
  return report;
}

/**
 * 真實 GA4 讀取。延遲 import SDK（只在真實分支載入），lazy client。
 * 跑三組 runReport：本期（pagePath × sessions/engagementRate/userEngagementDuration）、
 * 前一等長視窗（站台合計用）、以及自然搜尋（pagePath × sessions，filter Organic Search）。
 */
async function realReport(rangeDays: number): Promise<TrafficReport> {
  // 延遲載入：避免 import 此模組就把 SDK（含 protobuf）拉進來。
  const { BetaAnalyticsDataClient } = await import('@google-analytics/data');

  const propertyId = process.env.GA4_PROPERTY_ID as string;
  const property = `properties/${propertyId}`;

  // 認證：有內聯 GA4_SA_KEY → 顯式傳 credentials；否則靠 ADC 讀 GOOGLE_APPLICATION_CREDENTIALS。
  const inlineKey = process.env.GA4_SA_KEY;
  const client = inlineKey
    ? new BetaAnalyticsDataClient({ credentials: parseSaKey(inlineKey) })
    : new BetaAnalyticsDataClient();

  // 兩個等長視窗：本期 [rangeDays-1 .. 0]，前期 [2*rangeDays-1 .. rangeDays]。
  const curRange = { startDate: `${rangeDays}daysAgo`, endDate: 'today' };
  const prevRange = { startDate: `${2 * rangeDays}daysAgo`, endDate: `${rangeDays + 1}daysAgo` };

  log.info('fetchTrafficReport（真實 GA4）', { property, rangeDays });

  // 1) 本期：每篇 pagePath 的 sessions / engagementRate / userEngagementDuration。
  const [curResp] = await client.runReport({
    property,
    dateRanges: [curRange],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'sessions' },
      { name: 'engagementRate' },
      { name: 'userEngagementDuration' },
    ],
  });

  // 2) 前期站台合計（只要 sessions 合計）。
  const [prevResp] = await client.runReport({
    property,
    dateRanges: [prevRange],
    metrics: [{ name: 'sessions' }],
  });

  // 3) 本期自然搜尋（Organic Search）每篇 pagePath 的 sessions。
  const [organicResp] = await client.runReport({
    property,
    dateRanges: [curRange],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: {
      filter: {
        fieldName: 'sessionDefaultChannelGroup',
        stringFilter: { value: 'Organic Search', matchType: 'EXACT' },
      },
    },
  });

  // organic：pagePath → organic sessions 對照表。
  const organicByPath = new Map<string, number>();
  for (const row of organicResp.rows ?? []) {
    const path = row.dimensionValues?.[0]?.value ?? '';
    const sessions = num(row.metricValues?.[0]?.value);
    if (path) organicByPath.set(path, sessions);
  }

  // 只保留文章路徑（/zh/articles/...），組 ArticleMetric。
  const articles: ArticleMetric[] = [];
  for (const row of curResp.rows ?? []) {
    const path = row.dimensionValues?.[0]?.value ?? '';
    if (!path.startsWith(ARTICLE_PATH_PREFIX)) continue;
    const sessions = num(row.metricValues?.[0]?.value);
    const engagementRate = num(row.metricValues?.[1]?.value);
    const userEngagementDuration = num(row.metricValues?.[2]?.value);
    articles.push({
      slug: pathToSlug(path),
      path,
      sessions,
      engagementRate: round4(engagementRate),
      // 平均互動秒數 = 總互動秒數 / 工作階段數（避免除以 0）。
      avgEngagementTimeSec: sessions > 0 ? Math.round(userEngagementDuration / sessions) : 0,
      organicSessions: organicByPath.get(path) ?? 0,
    });
  }

  // 站台本期合計：優先用 response.totals，否則由 articles 推算。
  const totalSessions = totalFromRow(curResp, 0, () =>
    articles.reduce((s, a) => s + a.sessions, 0),
  );
  const totalEngagement = totalFromRow(curResp, 1, () => {
    const s = articles.reduce((x, a) => x + a.sessions, 0);
    return s > 0 ? articles.reduce((x, a) => x + a.engagementRate * a.sessions, 0) / s : 0;
  });
  const prevSessions = totalFromRow(prevResp, 0, () => 0);

  return {
    rangeDays,
    totals: { sessions: totalSessions, engagementRate: round4(totalEngagement) },
    prevTotals: { sessions: prevSessions },
    articles,
    stub: false,
  };
}

// ── 異常偵測（PURE）───────────────────────────────────────────────────────────

/**
 * 從報告偵測異常訊號（純函式，無副作用、不發請求）。
 *
 * 規則 A — 互動率偏低（engagement-low，warn，單篇）：
 *   取所有文章 engagementRate 的「中位數」當基準；
 *   任何文章 engagementRate < 中位數 × engagementFloorRatio（預設 0.5）
 *   且 sessions ≥ 20（雜訊地板：流量太小的文章互動率不可靠，不報）→ 標記為 engagement-low。
 *   （GA4 用互動率取代跳出率；互動率偏低＝越像跳出，故報「互動率異常偏低」。）
 *
 * 規則 B — 流量驟降（traffic-drop，alert，站台層級）：
 *   若 totals.sessions < prevTotals.sessions × trafficDropRatio（預設 0.6）
 *   → 站台層級 traffic-drop。這是「可能被降權」的早期警訊；
 *   降權的準確來源是 Google Search Console（曝光/點擊/排名），detail 會指向 GSC 查證。
 *
 * 邊界：articles 為空 → 無中位數可比 → 不產生 engagement-low（也不崩）。
 */
export function detectAnomalies(
  report: TrafficReport,
  opts?: { engagementFloorRatio?: number; trafficDropRatio?: number },
): AnomalySignal[] {
  const engagementFloorRatio = opts?.engagementFloorRatio ?? 0.5;
  const trafficDropRatio = opts?.trafficDropRatio ?? 0.6;
  const signals: AnomalySignal[] = [];

  // ── 規則 A：互動率偏低 ──
  if (report.articles.length > 0) {
    const median = medianOf(report.articles.map((a) => a.engagementRate));
    const floor = median * engagementFloorRatio;
    for (const a of report.articles) {
      if (a.sessions >= 20 && a.engagementRate < floor) {
        signals.push({
          kind: 'engagement-low',
          severity: 'warn',
          slug: a.slug,
          detail:
            `互動率異常偏低：${a.slug} 互動率 ${pct(a.engagementRate)}，` +
            `遠低於全站中位數 ${pct(median)} 的 ${Math.round(engagementFloorRatio * 100)}% 門檻` +
            `（門檻 ${pct(floor)}，工作階段 ${a.sessions}）。` +
            `GA4 以互動率取代跳出率，互動率偏低代表讀者多半未深入閱讀。`,
        });
      }
    }
  }

  // ── 規則 B：流量驟降 ──
  if (report.prevTotals.sessions > 0 &&
      report.totals.sessions < report.prevTotals.sessions * trafficDropRatio) {
    signals.push({
      kind: 'traffic-drop',
      severity: 'alert',
      detail:
        `流量驟降：本期 ${report.totals.sessions} 工作階段，` +
        `較前一等長視窗 ${report.prevTotals.sessions} 下降逾 ` +
        `${Math.round((1 - trafficDropRatio) * 100)}%。` +
        `此為「可能被降權」的早期警訊，非準確訊號；` +
        `請以 Google Search Console（曝光/點擊/平均排名）為準查證降權。`,
    });
  }

  return signals;
}

// ── 站長報告（fetch + detect + 待審件數）─────────────────────────────────────

/**
 * 組站長報告：流量報告 + 異常訊號 + 待審件數（規格要求報告固定附待審件數）。
 */
export async function buildOwnerReport(opts?: {
  rangeDays?: number;
  engagementFloorRatio?: number;
  trafficDropRatio?: number;
  reviewDir?: string;
  storeName?: string;
}): Promise<{
  report: TrafficReport;
  anomalies: AnomalySignal[];
  reviewQueueCount: number;
  stub: boolean;
}> {
  const report = await fetchTrafficReport({ rangeDays: opts?.rangeDays });
  const anomalies = detectAnomalies(report, {
    engagementFloorRatio: opts?.engagementFloorRatio,
    trafficDropRatio: opts?.trafficDropRatio,
  });
  const reviewQueueCount = getReviewQueueCount({
    reviewDir: opts?.reviewDir,
    storeName: opts?.storeName,
  });
  return { report, anomalies, reviewQueueCount, stub: report.stub };
}

// ── 小工具 ────────────────────────────────────────────────────────────────────

/** pagePath → slug：去掉 /zh/articles/ 前綴與尾斜線。 */
function pathToSlug(path: string): string {
  let s = path;
  if (s.startsWith(ARTICLE_PATH_PREFIX)) s = s.slice(ARTICLE_PATH_PREFIX.length);
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** GA4 metricValue 字串 → number（缺值或非數字回 0）。 */
function num(v: string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 取 runReport response.totals 第一列指定 index 的指標；缺則用 fallback 推算。 */
function totalFromRow(
  resp: { totals?: { metricValues?: ({ value?: string | null } | null)[] | null }[] | null },
  index: number,
  fallback: () => number,
): number {
  const row = resp.totals?.[0];
  const v = row?.metricValues?.[index]?.value;
  if (v === null || v === undefined) return fallback();
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback();
}

/** 解析內聯 service account JSON，取 client_email / private_key。 */
function parseSaKey(raw: string): { client_email: string; private_key: string } {
  const obj = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!obj.client_email || !obj.private_key) {
    throw new Error('GA4_SA_KEY 缺少 client_email 或 private_key');
  }
  return { client_email: obj.client_email, private_key: obj.private_key };
}

/** 中位數（複本排序，不改原陣列）。空陣列回 0（呼叫端已先排除空 articles）。 */
function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 四捨五入到 4 位小數（互動率等比率欄位用）。 */
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** 0..1 比率 → 百分比字串（一位小數）。 */
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
