import { getCollection, type CollectionEntry } from 'astro:content';

export function stripExt(id: string): string {
  return id.replace(/\.[^.]+$/, '');
}

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN((d as Date).getTime());
}

export const isPublishedArticle = (entry: CollectionEntry<'articles'>) => !entry.data.draft;

export async function getPublishedArticles() {
  return (await getCollection('articles', isPublishedArticle))
    .sort((a, b) => b.data.generatedDate.getTime() - a.data.generatedDate.getTime());
}
