import { describe, it, expect } from 'vitest';
import { SUBTOPICS } from './domain';
import { SOURCE_WHITELIST, sourcesForDomain } from './sources';
import { SCORING_WEIGHTS, BA_CRITERIA } from './criteria';

// ── SUBTOPICS ────────────────────────────────────────────────────────────────

describe('SUBTOPICS', () => {
  const CANONICAL_SLUGS = ['overtime', 'debt', 'retirement', 'consumption', 'value'] as const;

  it('包含全部 5 個正典 slug', () => {
    const slugs = SUBTOPICS.map((t) => t.slug);
    for (const canonical of CANONICAL_SLUGS) {
      expect(slugs, `缺少正典 slug: ${canonical}`).toContain(canonical);
    }
  });

  it('每個子題都有 slug、label、scope', () => {
    for (const t of SUBTOPICS) {
      expect(t.slug, 'slug 不可為空').toBeTruthy();
      expect(t.label, `${t.slug} 的 label 不可為空`).toBeTruthy();
      expect(t.scope, `${t.slug} 的 scope 不可為空`).toBeTruthy();
    }
  });
});

// ── SOURCE_WHITELIST ─────────────────────────────────────────────────────────

describe('SOURCE_WHITELIST', () => {
  const VALID_KINDS = ['survey', 'stats-office', 'academic', 'discourse'] as const;
  const VALID_CREDIBILITY = ['high', 'medium', 'low'] as const;
  const VALID_ACCESS = ['real', 'stub'] as const;

  it('每個來源都有必要欄位且 enum 值合法', () => {
    for (const entry of SOURCE_WHITELIST) {
      expect(entry.id, 'id 不可為空').toBeTruthy();
      expect(entry.name, `${entry.id} 的 name 不可為空`).toBeTruthy();
      expect(VALID_KINDS as readonly string[], `${entry.id} 的 kind 不合法`).toContain(entry.kind);
      expect(entry.regions.length, `${entry.id} 的 regions 不可為空陣列`).toBeGreaterThan(0);
      expect(entry.languages.length, `${entry.id} 的 languages 不可為空陣列`).toBeGreaterThan(0);
      expect(
        VALID_CREDIBILITY as readonly string[],
        `${entry.id} 的 credibility 不合法`,
      ).toContain(entry.credibility);
      expect(VALID_ACCESS as readonly string[], `${entry.id} 的 access 不合法`).toContain(
        entry.access,
      );
    }
  });

  it('白名單中必須有 Pew Research', () => {
    const found = SOURCE_WHITELIST.some((e) => e.name.toLowerCase().includes('pew'));
    expect(found, '未找到 Pew Research').toBe(true);
  });

  it('白名單中必須有 World Values Survey', () => {
    const found = SOURCE_WHITELIST.some(
      (e) => e.name.toLowerCase().includes('world values') || e.id.includes('wvs'),
    );
    expect(found, '未找到 World Values Survey').toBe(true);
  });

  it('白名單中必須有 OECD', () => {
    const found = SOURCE_WHITELIST.some((e) => e.name.toLowerCase().includes('oecd'));
    expect(found, '未找到 OECD').toBe(true);
  });

  it('不得有一般論壇作為真實（real）來源', () => {
    const forumRealSources = SOURCE_WHITELIST.filter((e) => {
      const isForumLike =
        (e.name.toLowerCase().includes('forum') ||
          (e.notes ?? '').toLowerCase().includes('forum')) &&
        e.access === 'real';
      return isForumLike;
    });
    expect(
      forumRealSources,
      '不得有 access=real 的論壇來源：' + forumRealSources.map((e) => e.id).join(', '),
    ).toHaveLength(0);
  });

  it('sourcesForDomain() 回傳與 SOURCE_WHITELIST 相同內容', () => {
    expect(sourcesForDomain()).toEqual(SOURCE_WHITELIST);
  });
});

// ── SCORING_WEIGHTS ──────────────────────────────────────────────────────────

describe('SCORING_WEIGHTS', () => {
  it('五個維度的權重合計在 [0.99, 1.01] 之間', () => {
    const sum =
      SCORING_WEIGHTS.tension +
      SCORING_WEIGHTS.factClarity +
      SCORING_WEIGHTS.dataAvailability +
      SCORING_WEIGHTS.novelty +
      SCORING_WEIGHTS.relevance;
    expect(sum).toBeGreaterThanOrEqual(0.99);
    expect(sum).toBeLessThanOrEqual(1.01);
  });
});

// ── BA_CRITERIA ──────────────────────────────────────────────────────────────

describe('BA_CRITERIA', () => {
  it('A 類範例非空（確保 A 類拒絕規則有錨點）', () => {
    expect(BA_CRITERIA.examples.A.length).toBeGreaterThan(0);
  });

  it('B 類範例非空', () => {
    expect(BA_CRITERIA.examples.B.length).toBeGreaterThan(0);
  });

  it('guidance 非空字串', () => {
    expect(BA_CRITERIA.guidance).toBeTruthy();
  });
});
