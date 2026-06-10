// engine/route/route.test.ts
//
// E10 風險分流測試。核心驗證規格的風險閘門（§4.2／§10.6）：
//   - 低風險 → 寫進 contentDir（且「沒有」東西寫進 reviewDir）。
//   - 高風險 → 寫進 reviewDir（且「沒有」東西寫進 contentDir）——安全性質。
//   - 開 issue 用注入的 stub（不 shell out、不真的開 issue）。
//   - 待審計數反映被隔離的檔案。
//
// 全部用 engine/data 底下 TEMP 目錄（gitignore），afterEach 清除——絕不碰真實 src/content。

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeAndPublish, getReviewQueueCount, openReviewIssue } from './index.js';
import { writeArticle, type DraftArticle } from '../write/index.js';
import type {
  Selection,
  AnchorResult,
  EvidenceResult,
  CritiqueVerdict,
} from '../schemas.js';
import type { CritiqueResult } from '../critique/index.js';

delete process.env.ANTHROPIC_API_KEY; // write 走 STUB
delete process.env.GITHUB_TOKEN; // 預設 issue opener 走 STUB（不 shell out）

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TEST_CONTENT = path.join(DATA_DIR, 'test-content-route');
const TEST_REVIEW = path.join(DATA_DIR, 'test-review-route');
const TEST_STORE = '__route_test_queue__';
const TEST_STORE_FILE = path.join(DATA_DIR, `${TEST_STORE}.json`);

beforeEach(() => {
  for (const d of [TEST_CONTENT, TEST_REVIEW]) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
  if (fs.existsSync(TEST_STORE_FILE)) fs.rmSync(TEST_STORE_FILE);
});

afterEach(() => {
  for (const d of [TEST_CONTENT, TEST_REVIEW]) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
  if (fs.existsSync(TEST_STORE_FILE)) fs.rmSync(TEST_STORE_FILE);
});

function makeSelection(over?: Partial<Selection>): Selection {
  return {
    title: '加班是責任還是異常？東亞與北歐的工時態度分歧',
    description:
      '同樣面對長工時這個有統計數據的事實，東亞傾向把加班理解為盡責，北歐傾向視之為制度失靈。',
    domainTopic: 'overtime',
    method: '靠延長工時換取收入與職涯位置',
    outcome: '在不同制度下分別走向責任感的肯定、或過勞與管理檢討',
    factCategory: 'B',
    stanceRiskLevel: 'low',
    anchorSuggestion: 'Nordic（北歐）',
    comparedSuggestions: ['East Asia（東亞）', 'United States（美國）'],
    reason: '工時長短有 OECD 統計支撐，差異源於勞動制度與歷史處境。',
    ...over,
  };
}

async function makeDraft(over?: Partial<Selection>): Promise<DraftArticle> {
  const anchor: AnchorResult = {
    status: 'ok',
    anchorCulture: 'Nordic（北歐）',
    comparedCultures: ['East Asia（東亞）', 'United States（美國）'],
    suspectCultures: [],
  };
  const evidence: EvidenceResult = {
    status: 'ok',
    sources: [
      {
        title: 'OECD Hours Worked',
        url: 'https://data.oecd.org/emp/hours-worked.htm',
        region: 'OECD',
        language: 'en',
        credibility: 'high',
      },
    ],
  };
  const { draft } = await writeArticle({
    selection: makeSelection(over),
    anchor,
    evidence,
    now: '2026-06-10T08:30:00.000Z',
  });
  return draft;
}

const PASS_LOW: CritiqueVerdict = { pass: true, stanceRiskLevel: 'low', issues: [] };
const FAIL_HIGH: CritiqueVerdict = {
  pass: false,
  stanceRiskLevel: 'high',
  issues: [
    {
      kind: 'essentializing',
      quote: '東亞人天生就比較能忍耐長工時',
      why: '把態度歸因於民族天性，屬本質化。',
    },
  ],
};

/** 內聯組一個 CritiqueResult-like 物件。 */
function makeCritiqueResult(
  draft: DraftArticle,
  routedToReview: boolean,
): CritiqueResult {
  return {
    draft,
    verdict: routedToReview ? FAIL_HIGH : PASS_LOW,
    critiqueModel: 'stub',
    rounds: 1,
    routedToReview,
  };
}

describe('routeAndPublish（E10 風險分流）', () => {
  it('低風險 → 發布到 contentDir；reviewDir 完全沒被寫', async () => {
    const draft = await makeDraft();
    const res = await routeAndPublish(makeCritiqueResult(draft, false), {
      contentDir: TEST_CONTENT,
      reviewDir: TEST_REVIEW,
      storeName: TEST_STORE,
    });

    expect(res.action).toBe('published');
    expect(fs.existsSync(res.path)).toBe(true);
    expect(fs.readFileSync(res.path, 'utf8')).toBe(draft.markdown);

    // reviewDir 不該有任何檔（甚至目錄可不存在）。
    const reviewFiles = fs.existsSync(TEST_REVIEW)
      ? fs.readdirSync(TEST_REVIEW)
      : [];
    expect(reviewFiles).toEqual([]);
  });

  it('高風險 → 隔離到 reviewDir；contentDir「絕不」被寫（安全性質）', async () => {
    const draft = await makeDraft();

    let openerCalled = false;
    const res = await routeAndPublish(makeCritiqueResult(draft, true), {
      contentDir: TEST_CONTENT,
      reviewDir: TEST_REVIEW,
      storeName: TEST_STORE,
      openIssue: async () => {
        openerCalled = true;
        return { created: false, stub: true };
      },
    });

    expect(res.action).toBe('quarantined');
    expect(fs.existsSync(res.path)).toBe(true);
    expect(fs.readFileSync(res.path, 'utf8')).toBe(draft.markdown);

    // 安全性質：高風險草稿「絕不」落進 contentDir。
    const contentFiles = fs.existsSync(TEST_CONTENT)
      ? fs.readdirSync(TEST_CONTENT)
      : [];
    expect(contentFiles).toEqual([]);

    // issue opener 被呼叫，PublishResult 帶 issue 資訊（stub）。
    expect(openerCalled).toBe(true);
    expect(res.issue).toBeDefined();
    expect(res.issue?.stub).toBe(true);
    expect(res.issue?.created).toBe(false);
  });

  it('預設 issue opener 在無 GITHUB_TOKEN 時 short-circuit 成 stub（不 shell out）', async () => {
    const draft = await makeDraft();
    // 不注入 openIssue → 用預設 openReviewIssue；無 token 應回 stub。
    const res = await routeAndPublish(makeCritiqueResult(draft, true), {
      contentDir: TEST_CONTENT,
      reviewDir: TEST_REVIEW,
      storeName: TEST_STORE,
    });
    expect(res.issue?.stub).toBe(true);
    expect(res.issue?.created).toBe(false);
  });

  it('openReviewIssue 直接呼叫：無 token → stub', async () => {
    const draft = await makeDraft();
    const issue = await openReviewIssue(draft, 'overtime-deadbeef');
    expect(issue.stub).toBe(true);
    expect(issue.created).toBe(false);
  });

  it('getReviewQueueCount 反映被隔離的檔案數', async () => {
    expect(getReviewQueueCount({ reviewDir: TEST_REVIEW, storeName: TEST_STORE })).toBe(0);

    const a = await makeDraft();
    const b = await makeDraft({ title: '另一個標題以產生不同 slug' });

    await routeAndPublish(makeCritiqueResult(a, true), {
      reviewDir: TEST_REVIEW,
      storeName: TEST_STORE,
      openIssue: async () => ({ created: false, stub: true }),
    });
    expect(getReviewQueueCount({ reviewDir: TEST_REVIEW, storeName: TEST_STORE })).toBe(1);

    await routeAndPublish(makeCritiqueResult(b, true), {
      reviewDir: TEST_REVIEW,
      storeName: TEST_STORE,
      openIssue: async () => ({ created: false, stub: true }),
    });
    expect(getReviewQueueCount({ reviewDir: TEST_REVIEW, storeName: TEST_STORE })).toBe(2);
  });

  it('待審計數在 store 也累計（slug 去重）', async () => {
    const draft = await makeDraft();
    // 同一份草稿跑兩次：檔案 idempotent、store slug 也去重 → count=1。
    for (let i = 0; i < 2; i++) {
      await routeAndPublish(makeCritiqueResult(draft, true), {
        reviewDir: TEST_REVIEW,
        storeName: TEST_STORE,
        openIssue: async () => ({ created: false, stub: true }),
      });
    }
    const rec = JSON.parse(fs.readFileSync(TEST_STORE_FILE, 'utf8'));
    expect(rec.count).toBe(1);
    expect(rec.slugs.length).toBe(1);
  });
});
