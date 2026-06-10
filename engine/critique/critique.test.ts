// engine/critique/critique.test.ts
//
// E9 挑刺 AI 測試（STUB 模式，不發任何真實 API）。
//
// 重點驗證：
//   - happy path：預設 stub（pass / low）→ 第 1 輪收斂，routedToReview=false，
//     critiqueModel 從 'pending' 覆寫為 'stub'，frontmatter 仍過 articlesSchema。
//   - critiqueModel 覆寫 'pending'：輸入草稿是 'pending'，輸出是 'stub'。
//   - 高風險分流：注入恆 fail / high 的 critic stub + revise stub →
//     過 maxRounds 仍 fail → routedToReview=true，且迴圈跑滿 maxRounds 輪。
//   - revise-then-pass：狀態化 stub（第 1 輪 fail、第 2 輪 pass）→
//     rounds=2，routedToReview=false，updatedDate 前進。
//   - critic prompt 與 writer prompt「不同」（含對抗關鍵字，不含 writer 的生成框架）。

import { describe, it, expect } from 'vitest';

import { critiqueDraft, buildCriticSystemPrompt } from './index.js';
import { writeArticle, type DraftArticle } from '../write/index.js';
import { articlesSchema } from '../../src/schemas/articles';
import type { Selection, AnchorResult, EvidenceResult, CritiqueVerdict } from '../schemas.js';

// 確保跑測試時為 STUB 模式（無 key）。
delete process.env.ANTHROPIC_API_KEY;

const NOW = '2026-06-10T08:30:00.000Z';

function makeSelection(over?: Partial<Selection>): Selection {
  return {
    title: '加班是責任還是異常？東亞與北歐的工時態度分歧',
    description:
      '同樣面對長工時這個有統計數據的事實，東亞傾向把加班理解為盡責，北歐傾向視之為制度失靈。',
    domainTopic: 'overtime',
    factCategory: 'B',
    stanceRiskLevel: 'low',
    anchorSuggestion: 'Nordic（北歐）',
    comparedSuggestions: ['East Asia（東亞）', 'United States（美國）'],
    reason: '工時長短有 OECD 統計支撐，差異源於勞動制度與歷史處境。',
    ...over,
  };
}

function makeAnchor(): AnchorResult {
  return {
    status: 'ok',
    anchorCulture: 'Nordic（北歐）',
    comparedCultures: ['East Asia（東亞）', 'United States（美國）'],
    suspectCultures: [],
  };
}

function makeEvidence(): EvidenceResult {
  return {
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
}

/** 產出一份「待批判」草稿（critiqueModel='pending'），透過 writeArticle 製作。 */
async function makeDraft(now = NOW): Promise<DraftArticle> {
  const { draft } = await writeArticle({
    selection: makeSelection(),
    anchor: makeAnchor(),
    evidence: makeEvidence(),
    now,
  });
  return draft;
}

const FAIL_HIGH: CritiqueVerdict = {
  pass: false,
  stanceRiskLevel: 'high',
  issues: [
    {
      kind: 'essentializing',
      quote: '東亞人天生就比較能忍耐長工時',
      why: '把態度歸因於民族天性，而非處境／制度／歷史，屬本質化。',
    },
  ],
};

describe('critiqueDraft（E9 挑刺 AI，STUB）', () => {
  it('happy path：預設 stub（pass/low）→ 第 1 輪收斂，未分流', async () => {
    const draft = await makeDraft();
    expect(draft.frontmatter.critiqueModel).toBe('pending'); // 前置：write 寫的佔位

    const res = await critiqueDraft(draft);

    expect(res.verdict.pass).toBe(true);
    expect(res.routedToReview).toBe(false);
    expect(res.rounds).toBe(1);
    expect(res.draft.frontmatter.critiqueModel).toBe('stub'); // 已覆寫，非 'pending'
    expect(res.draft.frontmatter.critiqueModel).not.toBe('pending');
    // frontmatter 仍過生產 schema。
    expect(() => articlesSchema.parse(res.draft.frontmatter)).not.toThrow();
  });

  it('critiqueModel 覆寫 pending：輸入 pending → 輸出 stub', async () => {
    const draft = await makeDraft();
    expect(draft.frontmatter.critiqueModel).toBe('pending');

    const res = await critiqueDraft(draft);

    expect(res.critiqueModel).toBe('stub');
    expect(res.draft.frontmatter.critiqueModel).toBe('stub');
    // markdown 內也應為 stub（不再有 pending）。
    expect(res.draft.markdown).toContain('critiqueModel: stub');
    expect(res.draft.markdown).not.toContain('critiqueModel: pending');
  });

  it('高風險分流：恆 fail/high → 過 maxRounds 仍 fail → routedToReview=true，跑滿輪數', async () => {
    const draft = await makeDraft();

    let criticCalls = 0;
    const res = await critiqueDraft(draft, {
      maxRounds: 2,
      stub: () => {
        criticCalls++;
        return FAIL_HIGH;
      },
      reviseStub: (body) => `${body}\n（已嘗試修訂但 stub 不改字）`,
    });

    expect(res.verdict.pass).toBe(false);
    expect(res.verdict.stanceRiskLevel).toBe('high');
    expect(res.routedToReview).toBe(true);
    expect(res.rounds).toBe(2); // 跑滿 maxRounds
    expect(criticCalls).toBe(2); // critic 被呼叫 maxRounds 次
    // 草稿仍回傳（帶最佳修訂版），讓 E10 能擺放它。
    expect(res.draft).toBeDefined();
    expect(res.draft.frontmatter.stanceRiskLevel).toBe('high'); // critic 判定覆寫
    expect(() => articlesSchema.parse(res.draft.frontmatter)).not.toThrow();
  });

  it('revise-then-pass：第 1 輪 fail、第 2 輪 pass → rounds=2，未分流，updatedDate 前進', async () => {
    // 用較早的 now 製作草稿，讓修訂後的 updatedDate（當下）明顯較新。
    const draft = await makeDraft('2020-01-01T00:00:00.000Z');
    const originalUpdated = draft.frontmatter.updatedDate.getTime();

    let reviseCalled = false;
    const res = await critiqueDraft(draft, {
      maxRounds: 2,
      // 狀態化 stub：round 1 fail/high，round 2 pass/low。
      stub: (round) =>
        round === 1
          ? FAIL_HIGH
          : { pass: true, stanceRiskLevel: 'low', issues: [] },
      reviseStub: (body) => {
        reviseCalled = true;
        return `${body}\n（已修訂）`;
      },
    });

    expect(res.rounds).toBe(2);
    expect(res.verdict.pass).toBe(true);
    expect(res.verdict.stanceRiskLevel).toBe('low');
    expect(res.routedToReview).toBe(false);
    expect(reviseCalled).toBe(true);
    // 發生過修訂 → updatedDate 前進到當下（明顯新於 2020）。
    expect(res.draft.frontmatter.updatedDate.getTime()).toBeGreaterThan(originalUpdated);
    // 修訂後的 body 應出現在草稿與 markdown。
    expect(res.draft.body).toContain('（已修訂）');
    expect(res.draft.markdown).toContain('（已修訂）');
    expect(() => articlesSchema.parse(res.draft.frontmatter)).not.toThrow();
  });

  it('critic prompt 與 writer 不同：含對抗關鍵字，不含 writer 的生成框架', async () => {
    const critic = buildCriticSystemPrompt();
    // 含對抗／挑刺／本質化關鍵字。
    expect(critic).toMatch(/攻擊|挑刺|對抗/);
    expect(critic).toContain('本質化');
    // 不含 writer 的「我作為一個觀察者」生成框架。
    expect(critic).not.toContain('我作為一個觀察者');
  });
});
