/**
 * Social / SEO metadata helpers for allmoneyback.me.
 *
 * Single-collection site: only `articles`. No media collections.
 * Brand: 「錢途 allmoneyback.me · AI 跨文化觀察者（金錢與工作）」。
 */

import { SITE_NAME, SITE_SUFFIX } from '@/data/site';
export { SITE_NAME, SITE_SUFFIX };
export const DEFAULT_DESCRIPTION =
  '同一件事，換個地方就換種做法。我們俯瞰金錢與工作的跨文化分歧：加班、債務、退休、消費與價值，把每種做法擺回它的處境，怎麼看留給你。';

export const OG_IMAGE_VERSION = '20260609-static-og-v1';

export const STATIC_OG_IMAGES: Record<string, string> = {
  home: '/og-static/default.png',
  articles: '/og-static/default.png',
  default: '/og-static/default.png',
};

export interface SocialMeta {
  title: string;
  description: string;
  image: string;
  ogTitle?: string;
}

/** Subset of an article's frontmatter used for social metadata. */
export interface ArticleSocialInput {
  title?: string;
  description?: string;
  tldr?: string;
}

export function versionedOgImage(path: string = STATIC_OG_IMAGES.default): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}v=${OG_IMAGE_VERSION}`;
}

export const DEFAULT_OG_IMAGE = versionedOgImage(STATIC_OG_IMAGES.home);

export function ogImageFor(key: string = 'default'): string {
  return versionedOgImage(STATIC_OG_IMAGES[key] || STATIC_OG_IMAGES.default);
}

export function socialTitle(title: string, context: string = SITE_SUFFIX): string {
  return `${title}｜${context}`;
}

export function cleanText(value: string = ''): string {
  return String(value)
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shortTitle(title: string = '', maxLen: number = 24): string {
  const cleaned = cleanText(title);
  const split = cleaned
    .split(/[：:？?｜|—－-]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate =
    split.find((part) => part.length >= 4 && part.length <= maxLen + 4) ||
    split[0] ||
    cleaned;
  if (candidate.length <= maxLen) return candidate;
  return `${candidate.slice(0, Math.max(4, maxLen - 1))}…`;
}

export function normalizeDescription(
  ...candidates: Array<string | undefined>
): string {
  const cleaned = candidates.map((c) => cleanText(c ?? ''));
  const picked =
    cleaned.find((item) => item.length >= 20) ||
    cleaned.find(Boolean) ||
    DEFAULT_DESCRIPTION;
  if (picked.length <= 86) return picked;
  const hardStop = picked.slice(0, 86);
  const cutAt = Math.max(
    hardStop.lastIndexOf('。'),
    hardStop.lastIndexOf('；'),
    hardStop.lastIndexOf('，'),
  );
  return `${(cutAt >= 36 ? hardStop.slice(0, cutAt) : hardStop.slice(0, 78)).replace(/[，；、。\s]+$/, '')}。`;
}

/**
 * Build social metadata for a single article entry.
 * `data` is a subset of `CollectionEntry<'articles'>['data']`.
 */
export function articleSocial(data: ArticleSocialInput = {}): SocialMeta {
  const title = cleanText(data.title || SITE_NAME);
  const short = shortTitle(title);
  const description = normalizeDescription(data.description, data.tldr);

  return {
    title: socialTitle(short),
    description,
    image: DEFAULT_OG_IMAGE,
    ogTitle: title,
  };
}

export function listSocial(
  label: string,
  description?: string,
): Pick<SocialMeta, 'title' | 'description' | 'image'> {
  return {
    title: socialTitle(label),
    description: normalizeDescription(description),
    image: DEFAULT_OG_IMAGE,
  };
}

export function tagSocial(tag: string): SocialMeta {
  return {
    title: socialTitle(`${tag}｜主題標籤`),
    description: `所有與「${tag}」相關的跨文化觀察文章，集中在同一頁。`,
    image: DEFAULT_OG_IMAGE,
    ogTitle: tag.length > 20 ? `${tag.slice(0, 19)}…` : tag,
  };
}
