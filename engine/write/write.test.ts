// engine/write/write.test.ts
//
// E7 撰寫 AI 測試（STUB 模式，不發任何真實 API）。
// selection / anchor / evidence 全部在測試內手工構造。
//
// 重點驗證：
//   - 合法 B + ok anchor + ok evidence → frontmatter 過 articlesSchema（不丟）。
//   - 生成資訊「生成當下」寫入、不寫死：
//       * writeModel === 'stub'（STUB 模式的實際 model）。
//       * critiqueModel === 'pending'（佔位，待 E9 覆寫）。
//       * pipelineVersion / specVersion === 常數。
//       * generatedDate 來自注入的 now；兩個不同 now → 不同 generatedDate。
//   - guard 會丟：anchor insufficient / factCategory A。
//   - markdown round-trip：yaml.load frontmatter 區塊 → 關鍵欄位相符。
//   - body 含「我」（觀察者口吻）。

import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';

import { writeArticle } from './index.js';
import { articlesSchema } from '../../src/schemas/articles';
import { PIPELINE_VERSION, SPEC_VERSION } from '../version.js';
import type { Selection, AnchorResult, EvidenceResult } from '../schemas.js';

// 確保跑測試時為 STUB 模式（無 key）。
delete process.env.ANTHROPIC_API_KEY;

const NOW = '2026-06-10T08:30:00.000Z';

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

function makeAnchor(over?: Partial<AnchorResult>): AnchorResult {
  return {
    status: 'ok',
    anchorCulture: 'Nordic（北歐）',
    comparedCultures: ['East Asia（東亞）', 'United States（美國）'],
    suspectCultures: [],
    ...over,
  };
}

function makeEvidence(over?: Partial<EvidenceResult>): EvidenceResult {
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
      {
        title: '日本 厚生労働省 労働時間統計',
        url: 'https://www.mhlw.go.jp/toukei/',
        region: 'JP',
        language: 'ja',
        credibility: 'high',
      },
    ],
    ...over,
  };
}

describe('writeArticle（E7 撰寫 AI，STUB）', () => {
  it('合法輸入 → frontmatter 過 articlesSchema，關鍵欄位正確', async () => {
    const { draft, model, stub } = await writeArticle(
      { selection: makeSelection(), anchor: makeAnchor(), evidence: makeEvidence(), now: NOW },
    );

    // 不丟 → 已過 articlesSchema（writeArticle 內部已 parse，這裡再 parse 一次確認）。
    expect(() => articlesSchema.parse(draft.frontmatter)).not.toThrow();

    expect(stub).toBe(true);
    expect(model).toBe('stub');

    const fm = draft.frontmatter;
    expect(fm.writeModel).toBe('stub'); // 生成資訊：實際 model，非寫死
    expect(fm.critiqueModel).toBe('pending'); // 佔位，待 E9 覆寫
    expect(fm.factCategory).toBe('B');
    expect(fm.comparedCultures.length).toBeGreaterThanOrEqual(2);
    expect(fm.comparedCultures.length).toBeLessThanOrEqual(4);
    expect(fm.sources.length).toBeGreaterThanOrEqual(1);
    expect(fm.tldr.length).toBeGreaterThan(0);
  });

  it('pipelineVersion / specVersion 等於常數；generatedDate 來自注入的 now', async () => {
    const { draft } = await writeArticle(
      { selection: makeSelection(), anchor: makeAnchor(), evidence: makeEvidence(), now: NOW },
    );
    expect(draft.frontmatter.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(draft.frontmatter.specVersion).toBe(SPEC_VERSION);
    // articlesSchema z.coerce.date() → Date；ISO 開頭應為注入 now 的日期。
    expect(draft.frontmatter.generatedDate.toISOString().slice(0, 10)).toBe('2026-06-10');
    expect(draft.frontmatter.updatedDate.toISOString().slice(0, 10)).toBe('2026-06-10');
  });

  it('不寫死：兩個不同 now → 不同 generatedDate', async () => {
    const a = await writeArticle(
      { selection: makeSelection(), anchor: makeAnchor(), evidence: makeEvidence(), now: '2026-06-10T00:00:00.000Z' },
    );
    const b = await writeArticle(
      { selection: makeSelection(), anchor: makeAnchor(), evidence: makeEvidence(), now: '2025-01-02T00:00:00.000Z' },
    );
    expect(a.draft.frontmatter.generatedDate.toISOString().slice(0, 10)).toBe('2026-06-10');
    expect(b.draft.frontmatter.generatedDate.toISOString().slice(0, 10)).toBe('2025-01-02');
    expect(a.draft.frontmatter.generatedDate.getTime()).not.toBe(
      b.draft.frontmatter.generatedDate.getTime(),
    );
  });

  it('guard：anchor.status=insufficient → 丟', async () => {
    await expect(
      writeArticle({
        selection: makeSelection(),
        anchor: makeAnchor({ status: 'insufficient', anchorCulture: undefined, comparedCultures: undefined }),
        evidence: makeEvidence(),
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  it('guard：selection.factCategory=A → 丟', async () => {
    await expect(
      writeArticle({
        selection: makeSelection({ factCategory: 'A' }),
        anchor: makeAnchor(),
        evidence: makeEvidence(),
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  it('guard：evidence.status=insufficient → 丟', async () => {
    await expect(
      writeArticle({
        selection: makeSelection(),
        anchor: makeAnchor(),
        evidence: makeEvidence({ status: 'insufficient' }),
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  it('markdown round-trip：yaml.load frontmatter 區塊 → 關鍵欄位相符', async () => {
    const { draft } = await writeArticle(
      { selection: makeSelection(), anchor: makeAnchor(), evidence: makeEvidence(), now: NOW },
    );

    // 抽出 --- ... --- 之間的 YAML。
    const match = draft.markdown.match(/^---\n([\s\S]*?)\n---\n/);
    expect(match).not.toBeNull();
    const loaded = yaml.load(match![1]) as Record<string, unknown>;

    expect(loaded.title).toBe(draft.frontmatter.title);
    expect(loaded.writeModel).toBe('stub');
    expect(loaded.critiqueModel).toBe('pending');
    expect(loaded.factCategory).toBe('B');
    expect(loaded.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(loaded.specVersion).toBe(SPEC_VERSION);
    // YAML 內保留為 'YYYY-MM-DD' 字串（或 js-yaml 解析的 Date——統一轉字串比對日期）。
    const loadedDate =
      loaded.generatedDate instanceof Date
        ? loaded.generatedDate.toISOString().slice(0, 10)
        : String(loaded.generatedDate).slice(0, 10);
    expect(loadedDate).toBe('2026-06-10');
    expect(Array.isArray(loaded.comparedCultures)).toBe(true);
  });

  it('body 含「我」（觀察者口吻）', async () => {
    const { draft } = await writeArticle(
      { selection: makeSelection(), anchor: makeAnchor(), evidence: makeEvidence(), now: NOW },
    );
    expect(draft.body).toContain('我');
    // 模板節：定錨節 + 收束節。
    expect(draft.body).toContain('## 站在');
    expect(draft.body).toContain('## 站在這個分歧之上');
  });

  it('opts.stubBody 可注入自訂 body', async () => {
    const { draft } = await writeArticle(
      { selection: makeSelection(), anchor: makeAnchor(), evidence: makeEvidence(), now: NOW },
      { stubBody: () => '我注入的測試本文' },
    );
    expect(draft.body).toBe('我注入的測試本文');
    expect(draft.markdown).toContain('我注入的測試本文');
  });
});
