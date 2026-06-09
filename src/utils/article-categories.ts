import type { CollectionEntry } from 'astro:content';

/**
 * Money & work subtopics for allmoneyback.me.
 *
 * Each subtopic maps to a design token (`--color-topic-*`) defined in
 * src/styles/tokens.css. The `color` field below is the sRGB hex equivalent of
 * that OKLCH token, for non-CSS consumers (e.g. og generation, JSON-LD).
 * Keep these in sync with tokens.css if the tokens change.
 */
export type ArticleCategorySlug =
  | 'overtime'
  | 'debt'
  | 'retirement'
  | 'consumption'
  | 'value';

export interface ArticleCategory {
  slug: ArticleCategorySlug;
  label: string;
  description: string;
  /** CSS custom property name, e.g. '--color-topic-overtime'. */
  token: string;
  /** sRGB hex equivalent of the token (for non-CSS consumers). */
  color: string;
}

export type CategorizedArticle = CollectionEntry<'articles'> & {
  categorySlug: ArticleCategorySlug;
  categoryLabel: string;
};

export const ARTICLE_CATEGORIES: ArticleCategory[] = [
  {
    slug: 'overtime',
    label: '加班與工時',
    description: '工時、加班、過勞、工作與生活界線的跨文化分歧。',
    token: '--color-topic-overtime',
    color: '#8d5136',
  },
  {
    slug: 'debt',
    label: '債務',
    description: '借貸、房貸、信用、負債觀念與還款文化的差異。',
    token: '--color-topic-debt',
    color: '#7f4541',
  },
  {
    slug: 'retirement',
    label: '退休',
    description: '退休年齡、養老、年金、晚年安排與世代責任的觀念。',
    token: '--color-topic-retirement',
    color: '#2f5c70',
  },
  {
    slug: 'consumption',
    label: '消費',
    description: '消費習慣、儲蓄、面子、節儉與物質欲望的文化張力。',
    token: '--color-topic-consumption',
    color: '#3b694c',
  },
  {
    slug: 'value',
    label: '價值觀',
    description: '金錢與成功、地位、家庭、幸福之間的價值排序差異。',
    token: '--color-topic-value',
    color: '#685c81',
  },
];

const CATEGORY_LABEL_MAP = new Map(
  ARTICLE_CATEGORIES.map((category) => [category.slug, category.label]),
);

const CATEGORY_KEYWORDS: Record<ArticleCategorySlug, string[]> = {
  overtime: [
    '加班',
    '工時',
    '過勞',
    '工作狂',
    '責任制',
    '工作生活平衡',
    'work-life',
    '休假',
    '請假',
    '超時',
  ],
  debt: [
    '債務',
    '負債',
    '借貸',
    '貸款',
    '房貸',
    '信用卡',
    '卡債',
    '還款',
    '破產',
    '利息',
  ],
  retirement: [
    '退休',
    '養老',
    '年金',
    '退休金',
    '晚年',
    '老後',
    '安養',
    '退休年齡',
  ],
  consumption: [
    '消費',
    '儲蓄',
    '存錢',
    '節儉',
    '省錢',
    '購物',
    '面子',
    '炫耀',
    '物欲',
    '理財',
  ],
  value: [
    '價值觀',
    '成功',
    '地位',
    '幸福',
    '金錢觀',
    '人生意義',
    '階級',
    '財富',
    '貧富',
  ],
};

function containsKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function getSearchText(article: CollectionEntry<'articles'>): string {
  const data = article.data;

  return [
    article.id,
    data.title,
    data.description,
    data.tldr,
    data.domainTopic,
    ...(data.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase();
}

export function classifyArticle(
  article: CollectionEntry<'articles'>,
): ArticleCategorySlug {
  const text = getSearchText(article);

  if (containsKeyword(text, CATEGORY_KEYWORDS.overtime)) return 'overtime';
  if (containsKeyword(text, CATEGORY_KEYWORDS.debt)) return 'debt';
  if (containsKeyword(text, CATEGORY_KEYWORDS.retirement)) return 'retirement';
  if (containsKeyword(text, CATEGORY_KEYWORDS.consumption)) return 'consumption';
  if (containsKeyword(text, CATEGORY_KEYWORDS.value)) return 'value';

  return 'value';
}

export function categorizeArticles(
  articles: CollectionEntry<'articles'>[],
): CategorizedArticle[] {
  return articles.map((article) => {
    const categorySlug = classifyArticle(article);
    const categoryLabel = CATEGORY_LABEL_MAP.get(categorySlug) ?? '價值觀';

    return {
      ...article,
      categorySlug,
      categoryLabel,
    };
  });
}
