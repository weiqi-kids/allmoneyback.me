import { describe, it, expect } from 'vitest';
import { SelectionSchema, AnchorResultSchema } from './schemas';

const validSelection = {
  title: '為什麼東亞把加班當責任',
  description: '一個 AI 觀察者俯瞰加班態度的跨文化分歧。',
  domainTopic: 'overtime',
  method: '靠延長工時換取收入與職涯位置',
  outcome: '在不同制度下分別走向責任感的肯定、或過勞與管理檢討',
  factCategory: 'B' as const,
  stanceRiskLevel: 'low' as const,
  anchorSuggestion: 'Nordic',
  comparedSuggestions: ['East Asia', 'United States'],
  reason: '差異源於勞動處境。',
};

describe('SelectionSchema', () => {
  it('合法 Selection 應通過', () => {
    expect(() => SelectionSchema.parse(validSelection)).not.toThrow();
  });

  it('select 階段允許 factCategory=A（由下游 gate 拒絕）', () => {
    expect(() => SelectionSchema.parse({ ...validSelection, factCategory: 'A' })).not.toThrow();
  });

  it('factCategory=C 應被拒絕', () => {
    expect(() => SelectionSchema.parse({ ...validSelection, factCategory: 'C' })).toThrow();
  });
});

describe('AnchorResultSchema', () => {
  it('insufficient 且無 anchor 應通過', () => {
    expect(() =>
      AnchorResultSchema.parse({ status: 'insufficient', note: '證據不足' }),
    ).not.toThrow();
  });
});
