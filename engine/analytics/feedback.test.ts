// engine/analytics/feedback.test.ts
//
// E16 好題回饋測試。全程 STUB / 注入，不發任何真實 GA4 請求。
//   - scoreArticle：高互動／停留／自然搜尋 → 較高分；權重生效。
//   - extractGoodTopicSignals：注入 report + 暫存 contentDir（2-3 篇 md）→ 取 top、
//     聚合 frontmatter（topSubtopics / topAnchors）、sampleTitles 有值；session 地板生效。
//   - writeSelectionPreferences + getSelectionPreferences round-trip（test store）；無檔回 null。

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scoreArticle,
  extractGoodTopicSignals,
  writeSelectionPreferences,
  getSelectionPreferences,
  type SelectionPreferences,
} from './feedback.js';
import type { ArticleMetric, TrafficReport } from './ga4.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TEST_STORE = 'select-preferences-test';
const testStoreFile = path.join(DATA_DIR, `${TEST_STORE}.json`);

function cleanStore(): void {
  if (fs.existsSync(testStoreFile)) fs.unlinkSync(testStoreFile);
}

const tempDirs: string[] = [];
function makeTempContentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-content-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  cleanStore();
  for (const d of tempDirs.splice(0)) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

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
    prevTotals: { sessions: 900 },
    articles: [],
    stub: false,
    ...over,
  };
}

/** 寫一篇最小 frontmatter md 到 dir/<slug>.md。 */
function seedArticle(
  dir: string,
  slug: string,
  fm: { title: string; domainTopic: string; anchorCulture: string; comparedCultures: string[] },
): void {
  const yamlBlock = [
    `title: "${fm.title}"`,
    `domainTopic: "${fm.domainTopic}"`,
    `anchorCulture: "${fm.anchorCulture}"`,
    `comparedCultures: [${fm.comparedCultures.map((c) => `"${c}"`).join(', ')}]`,
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${slug}.md`), `---\n${yamlBlock}\n---\n\n本文。\n`, 'utf8');
}

// ── scoreArticle ──
describe('scoreArticle', () => {
  it('高互動 / 停留 / 自然搜尋 → 高於低訊號文章', () => {
    const high = makeArticle({
      slug: 'high',
      engagementRate: 0.9,
      avgEngagementTimeSec: 150,
      organicSessions: 90,
      sessions: 100,
    });
    const low = makeArticle({
      slug: 'low',
      engagementRate: 0.2,
      avgEngagementTimeSec: 15,
      organicSessions: 5,
      sessions: 100,
    });
    expect(scoreArticle(high)).toBeGreaterThan(scoreArticle(low));
  });

  it('分數落在 [0,1]；全滿訊號接近 1', () => {
    const max = makeArticle({
      slug: 'max',
      engagementRate: 1,
      avgEngagementTimeSec: 240, // /120 capped → 1
      organicSessions: 100,
      sessions: 100,
    });
    const s = scoreArticle(max);
    expect(s).toBeGreaterThan(0.99);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('權重生效：把全部權重放在 engagementRate → 高互動文章主導', () => {
    const onlyEngagement = { engagementRate: 1, dwell: 0, organicSearch: 0 };
    const a = makeArticle({ slug: 'a', engagementRate: 0.8, avgEngagementTimeSec: 0, organicSessions: 0 });
    const b = makeArticle({ slug: 'b', engagementRate: 0.3, avgEngagementTimeSec: 240, organicSessions: 100 });
    // 只看互動率：a(0.8) > b(0.3)，即使 b 停留/自然搜尋滿分。
    expect(scoreArticle(a, onlyEngagement)).toBeGreaterThan(scoreArticle(b, onlyEngagement));
    expect(scoreArticle(a, onlyEngagement)).toBeCloseTo(0.8, 5);
  });

  it('sessions=0 → organic 比例記 0，不崩（無除零）', () => {
    const a = makeArticle({ slug: 'z', sessions: 0, organicSessions: 0 });
    expect(Number.isFinite(scoreArticle(a))).toBe(true);
  });
});

// ── extractGoodTopicSignals（注入 report + 暫存 contentDir）──
describe('extractGoodTopicSignals', () => {
  it('取 top、聚合 frontmatter（topSubtopics/topAnchors）、sampleTitles 有值', async () => {
    const dir = makeTempContentDir();
    // 兩篇好題（高互動）、一篇低題。
    seedArticle(dir, 'good-overtime', {
      title: '加班的兩種讀法',
      domainTopic: 'overtime',
      anchorCulture: 'Nordic',
      comparedCultures: ['East Asia', 'United States'],
    });
    seedArticle(dir, 'good-saving', {
      title: '儲蓄是美德嗎',
      domainTopic: 'saving',
      anchorCulture: 'East Asia',
      comparedCultures: ['United States', 'Nordic'],
    });
    seedArticle(dir, 'meh-debt', {
      title: '欠債可恥嗎',
      domainTopic: 'debt',
      anchorCulture: 'United States',
      comparedCultures: ['East Asia', 'Nordic'],
    });

    const report = makeReport({
      stub: false,
      articles: [
        makeArticle({ slug: 'good-overtime', engagementRate: 0.9, avgEngagementTimeSec: 150, organicSessions: 90, sessions: 200 }),
        makeArticle({ slug: 'good-saving', engagementRate: 0.85, avgEngagementTimeSec: 140, organicSessions: 80, sessions: 180 }),
        makeArticle({ slug: 'meh-debt', engagementRate: 0.2, avgEngagementTimeSec: 20, organicSessions: 5, sessions: 150 }),
      ],
    });

    const prefs = await extractGoodTopicSignals({
      contentDir: dir,
      topN: 2,
      now: '2026-06-10T00:00:00.000Z',
      report,
    });

    expect(prefs.updatedAt).toBe('2026-06-10T00:00:00.000Z');

    // topN=2 → 只有兩篇高題入選；meh-debt 不在。
    const subtopics = prefs.topSubtopics.map((s) => s.domainTopic);
    expect(subtopics).toContain('overtime');
    expect(subtopics).toContain('saving');
    expect(subtopics).not.toContain('debt');

    const anchors = prefs.topAnchors.map((a) => a.culture);
    expect(anchors).toContain('Nordic');
    expect(anchors).toContain('East Asia');
    expect(anchors).not.toContain('United States');

    // 對組 key 排序：Nordic::East Asia+United States。
    const pairKeys = prefs.topPairs.map((p) => p.key);
    expect(pairKeys).toContain('Nordic::East Asia+United States');

    expect(prefs.sampleTitles).toContain('加班的兩種讀法');
    expect(prefs.sampleTitles.length).toBeGreaterThan(0);

    // 排序：overtime 分數最高 → topSubtopics[0]。
    expect(prefs.topSubtopics[0].domainTopic).toBe('overtime');
    expect(prefs.topSubtopics[0].weight).toBeGreaterThan(0);
  });

  it('session 地板：低於地板的文章不納入（即使分數高）', async () => {
    const dir = makeTempContentDir();
    seedArticle(dir, 'tiny-but-hot', {
      title: '小流量爆文',
      domainTopic: 'overtime',
      anchorCulture: 'Nordic',
      comparedCultures: ['East Asia', 'United States'],
    });
    const report = makeReport({
      articles: [
        // sessions 5 < 地板 10 → 即使互動率滿分也被濾掉。
        makeArticle({ slug: 'tiny-but-hot', engagementRate: 1, avgEngagementTimeSec: 240, organicSessions: 5, sessions: 5 }),
      ],
    });
    const prefs = await extractGoodTopicSignals({ contentDir: dir, report });
    expect(prefs.topSubtopics).toHaveLength(0);
    expect(prefs.topAnchors).toHaveLength(0);
    expect(prefs.sampleTitles).toHaveLength(0);
  });

  it('frontmatter 檔案缺失 → 略過該篇，不崩', async () => {
    const dir = makeTempContentDir(); // 空目錄，沒有任何 md
    const report = makeReport({
      articles: [makeArticle({ slug: 'no-such-file', sessions: 100 })],
    });
    const prefs = await extractGoodTopicSignals({ contentDir: dir, report });
    expect(prefs.topSubtopics).toHaveLength(0);
    expect(prefs.sampleTitles).toHaveLength(0);
  });
});

// ── round-trip ──
describe('writeSelectionPreferences / getSelectionPreferences', () => {
  it('無檔 → null', () => {
    cleanStore();
    expect(getSelectionPreferences({ storeName: TEST_STORE })).toBeNull();
  });

  it('write 後 read 回相同內容（round-trip）', () => {
    cleanStore();
    const prefs: SelectionPreferences = {
      updatedAt: '2026-06-10T00:00:00.000Z',
      topSubtopics: [{ domainTopic: 'overtime', weight: 0.8 }],
      topAnchors: [{ culture: 'Nordic', weight: 0.8 }],
      topPairs: [{ key: 'Nordic::East Asia+United States', weight: 0.8 }],
      sampleTitles: ['加班的兩種讀法'],
    };
    writeSelectionPreferences(prefs, { storeName: TEST_STORE });
    const got = getSelectionPreferences({ storeName: TEST_STORE });
    expect(got).toEqual(prefs);
  });
});
