import { describe, it, expect } from 'vitest';
import { articlesSchema } from '../src/schemas/articles';

const valid = {
  title: '為什麼東亞把加班當責任、北歐當管理失敗',
  description: '一個 AI 觀察者俯瞰加班態度的跨文化分歧。',
  tldr: '加班在東亞被讀成責任感，在北歐被讀成管理失敗——兩者都源於各自的勞動處境。',
  domainTopic: 'overtime',
  method: '靠延長工時換取收入與職涯位置',
  outcome: '在不同制度下，分別走向責任感的肯定、或過勞與管理檢討',
  witnessVigil: '同樣是加班，有人把它過成責任，有人把它讀成警訊。',
  tags: ['加班', '勞動文化'],
  anchorCulture: 'Nordic',
  comparedCultures: ['East Asia', 'United States'],
  suspectCultures: [],
  factCategory: 'B',
  stanceRiskLevel: 'low',
  sources: [
    { title: 'OECD Hours Worked', url: 'https://oecd.org/x', region: 'OECD', language: 'en', credibility: 'high' },
  ],
  writeModel: 'claude-opus-4-8',
  critiqueModel: 'claude-sonnet-4-6',
  pipelineVersion: '0.1.0',
  specVersion: 'base-md-v1',
  generatedDate: new Date('2026-06-09'),
  updatedDate: new Date('2026-06-09'),
  coverImage: './cover.png',
  coverC2paVerified: true,
  faq: [{ q: '為什麼差異存在？', a: '因為勞動處境不同。' }],
  lang: 'zh',
};

describe('articlesSchema', () => {
  it('接受合法 frontmatter', () => {
    expect(() => articlesSchema.parse(valid)).not.toThrow();
  });
  it('factCategory 只接受 B（A 應被拒絕，禁止 A 類進生產）', () => {
    expect(() => articlesSchema.parse({ ...valid, factCategory: 'A' })).toThrow();
  });
  it('stanceRiskLevel 只接受 low/high', () => {
    expect(() => articlesSchema.parse({ ...valid, stanceRiskLevel: 'medium' })).toThrow();
  });
  it('缺 anchorCulture 應拒絕', () => {
    const { anchorCulture, ...rest } = valid;
    expect(() => articlesSchema.parse(rest)).toThrow();
  });
  it('comparedCultures 少於 2 應拒絕', () => {
    expect(() => articlesSchema.parse({ ...valid, comparedCultures: ['East Asia'] })).toThrow();
  });
  it('缺 outcome 應拒絕（沒有結果就只是態度比較，不是見證記錄）', () => {
    const { outcome, ...rest } = valid;
    expect(() => articlesSchema.parse(rest)).toThrow();
  });
  it('缺 method 應拒絕', () => {
    const { method, ...rest } = valid;
    expect(() => articlesSchema.parse(rest)).toThrow();
  });
  it('缺 witnessVigil 應拒絕', () => {
    const { witnessVigil, ...rest } = valid;
    expect(() => articlesSchema.parse(rest)).toThrow();
  });
});
