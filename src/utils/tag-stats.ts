import { getCollection } from 'astro:content';

export interface TagCount {
  tag: string;
  count: number;
}

export async function getTopTags(limit = 20): Promise<TagCount[]> {
  const entries = (await getCollection('articles')).filter((e) => !e.data.draft);

  const tagCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.data.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}
