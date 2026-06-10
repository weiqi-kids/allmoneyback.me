// engine/analytics/ga4.test.ts
//
// E15 測試。只跑 STUB 模式（清掉 GA4 憑證環境變數），絕不發任何真實 GA4 請求。
// detectAnomalies 為純函式，直接餵手造報告驗證兩條規則（互動率偏低／流量驟降）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isGa4StubMode,
  fetchTrafficReport,
  detectAnomalies,
  buildOwnerReport,
  type TrafficReport,
  type ArticleMetric,
} from './ga4.js';

// ── 環境隔離：所有 GA4 憑證一律清掉 → 強制 STUB ──
const GA4_ENV_KEYS = ['GA4_PROPERTY_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GA4_SA_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of GA4_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of GA4_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── isGa4StubMode ──
describe('isGa4StubMode', () => {
  it('憑證全缺 → true', () => {
    expect(isGa4StubMode()).toBe(true);
  });

  it('只有 property、無憑證 → 仍 true', () => {
    process.env.GA4_PROPERTY_ID = '123456789';
    expect(isGa4StubMode()).toBe(true);
  });

  it('property + 憑證俱全 → false', () => {
    process.env.GA4_PROPERTY_ID = '123456789';
    process.env.GA4_SA_KEY = '{"client_email":"a@b","private_key":"x"}';
    expect(isGa4StubMode()).toBe(false);
  });
});

// ── fetchTrafficReport STUB ──
describe('fetchTrafficReport（STUB）', () => {
  it('回 stub:true 報告，含 articles[]/totals/prevTotals（不發真實 GA4 請求）', async () => {
    // 憑證已被 beforeEach 清掉 → isGa4StubMode 為 true → 不會走真實分支（不 import SDK、不發請求）。
    expect(isGa4StubMode()).toBe(true);

    const report = await fetchTrafficReport();
    expect(report.stub).toBe(true);
    expect(Array.isArray(report.articles)).toBe(true);
    expect(report.articles.length).toBeGreaterThan(0);
    expect(typeof report.totals.sessions).toBe('number');
    expect(typeof report.totals.engagementRate).toBe('number');
    expect(typeof report.prevTotals.sessions).toBe('number');
    // 每篇文章欄位齊全。
    for (const a of report.articles) {
      expect(typeof a.slug).toBe('string');
      expect(a.path.startsWith('/zh/articles/')).toBe(true);
      expect(typeof a.sessions).toBe('number');
      expect(typeof a.engagementRate).toBe('number');
      expect(typeof a.avgEngagementTimeSec).toBe('number');
      expect(typeof a.organicSessions).toBe('number');
    }
  });

  it('rangeDays 可覆寫並回傳於報告', async () => {
    const report = await fetchTrafficReport({ rangeDays: 7 });
    expect(report.rangeDays).toBe(7);
    expect(report.stub).toBe(true);
  });
});

// ── detectAnomalies（純函式，兩條規則）──
function makeArticle(over: Partial<ArticleMetric> & { slug: string }): ArticleMetric {
  return {
    path: `/zh/articles/${over.slug}/`,
    sessions: 100,
    engagementRate: 0.6,
    avgEngagementTimeSec: 90,
    organicSessions: 50,
    ...over,
  };
}

function makeReport(over: Partial<TrafficReport>): TrafficReport {
  return {
    rangeDays: 28,
    totals: { sessions: 1000, engagementRate: 0.6 },
    prevTotals: { sessions: 1000 },
    articles: [],
    stub: true,
    ...over,
  };
}

describe('detectAnomalies — engagement-low（互動率偏低）', () => {
  it('一篇遠低於中位數且 sessions≥20 → 標記為 engagement-low warn', () => {
    // 中位數 = 0.6；floor = 0.6 * 0.5 = 0.3。bad 0.2 < 0.3 且 sessions 50 ≥ 20 → 標記。
    const report = makeReport({
      articles: [
        makeArticle({ slug: 'a', engagementRate: 0.6, sessions: 100 }),
        makeArticle({ slug: 'b', engagementRate: 0.6, sessions: 100 }),
        makeArticle({ slug: 'bad', engagementRate: 0.2, sessions: 50 }),
      ],
    });
    const signals = detectAnomalies(report);
    const eng = signals.filter((s) => s.kind === 'engagement-low');
    expect(eng).toHaveLength(1);
    expect(eng[0].slug).toBe('bad');
    expect(eng[0].severity).toBe('warn');
    expect(eng[0].detail).toContain('互動率');
  });

  it('低於門檻但 sessions<20（雜訊地板）→ 不標記', () => {
    // bad 0.2 < floor 0.3，但 sessions 10 < 20 → 不可靠，不報。
    const report = makeReport({
      articles: [
        makeArticle({ slug: 'a', engagementRate: 0.6, sessions: 100 }),
        makeArticle({ slug: 'b', engagementRate: 0.6, sessions: 100 }),
        makeArticle({ slug: 'bad', engagementRate: 0.2, sessions: 10 }),
      ],
    });
    const signals = detectAnomalies(report);
    expect(signals.filter((s) => s.kind === 'engagement-low')).toHaveLength(0);
  });

  it('低於中位數但「未」低於門檻 → 不標記', () => {
    // 中位數 0.6、floor 0.3；0.45 低於中位數但 > floor → 不算異常。
    const report = makeReport({
      articles: [
        makeArticle({ slug: 'a', engagementRate: 0.6, sessions: 100 }),
        makeArticle({ slug: 'b', engagementRate: 0.6, sessions: 100 }),
        makeArticle({ slug: 'mid', engagementRate: 0.45, sessions: 100 }),
      ],
    });
    const signals = detectAnomalies(report);
    expect(signals.filter((s) => s.kind === 'engagement-low')).toHaveLength(0);
  });

  it('全部正常（互動率相近）→ 無 engagement-low', () => {
    const report = makeReport({
      articles: [
        makeArticle({ slug: 'a', engagementRate: 0.6, sessions: 100 }),
        makeArticle({ slug: 'b', engagementRate: 0.58, sessions: 100 }),
        makeArticle({ slug: 'c', engagementRate: 0.62, sessions: 100 }),
      ],
    });
    expect(detectAnomalies(report).filter((s) => s.kind === 'engagement-low')).toHaveLength(0);
  });
});

describe('detectAnomalies — traffic-drop（流量驟降）', () => {
  it('40 vs 100（< 0.6 門檻）→ alert', () => {
    const report = makeReport({
      totals: { sessions: 40, engagementRate: 0.6 },
      prevTotals: { sessions: 100 },
    });
    const drop = detectAnomalies(report).filter((s) => s.kind === 'traffic-drop');
    expect(drop).toHaveLength(1);
    expect(drop[0].severity).toBe('alert');
    expect(drop[0].slug).toBeUndefined();
    expect(drop[0].detail).toContain('Search Console');
  });

  it('80 vs 100（未過門檻）→ 無 traffic-drop', () => {
    const report = makeReport({
      totals: { sessions: 80, engagementRate: 0.6 },
      prevTotals: { sessions: 100 },
    });
    expect(detectAnomalies(report).filter((s) => s.kind === 'traffic-drop')).toHaveLength(0);
  });
});

describe('detectAnomalies — 邊界', () => {
  it('articles 為空 → 無訊號、不崩', () => {
    const report = makeReport({
      articles: [],
      totals: { sessions: 1000, engagementRate: 0.6 },
      prevTotals: { sessions: 1000 },
    });
    expect(detectAnomalies(report)).toEqual([]);
  });
});

// ── buildOwnerReport STUB ──
describe('buildOwnerReport（STUB）', () => {
  const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const TEST_REVIEW = path.join(DATA_DIR, 'test-review-ga4');
  const TEST_STORE = '__ga4_test_queue__';
  const TEST_STORE_FILE = path.join(DATA_DIR, `${TEST_STORE}.json`);

  function cleanup() {
    if (fs.existsSync(TEST_REVIEW)) fs.rmSync(TEST_REVIEW, { recursive: true, force: true });
    if (fs.existsSync(TEST_STORE_FILE)) fs.rmSync(TEST_STORE_FILE);
  }
  beforeEach(cleanup);
  afterEach(cleanup);

  it('回 report + anomalies + reviewQueueCount（無 _review 時為 0）', async () => {
    const res = await buildOwnerReport({ reviewDir: TEST_REVIEW, storeName: TEST_STORE });
    expect(res.stub).toBe(true);
    expect(res.report.stub).toBe(true);
    expect(Array.isArray(res.anomalies)).toBe(true);
    expect(typeof res.reviewQueueCount).toBe('number');
    expect(res.reviewQueueCount).toBe(0);
  });

  it('reviewDir 有 .md → reviewQueueCount 反映檔案數', async () => {
    fs.mkdirSync(TEST_REVIEW, { recursive: true });
    fs.writeFileSync(path.join(TEST_REVIEW, 'one.md'), '# x');
    fs.writeFileSync(path.join(TEST_REVIEW, 'two.md'), '# y');
    const res = await buildOwnerReport({ reviewDir: TEST_REVIEW, storeName: TEST_STORE });
    expect(res.reviewQueueCount).toBe(2);
  });
});
