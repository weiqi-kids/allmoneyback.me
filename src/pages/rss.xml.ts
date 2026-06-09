import { getCollection } from 'astro:content';
import { SITE_URL } from '@/data/site';
import { stripExt, isValidDate } from '@/utils/articles';

const FEED_URL = `${SITE_URL}/rss.xml`;
const MAX_ITEMS = 50;

type FeedItem = {
  title: string;
  description: string;
  link: string;
  guid: string;
  pubDate: Date;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensureDescription(value: string | undefined): string {
  return value?.trim() || '錢途：跨文化金錢與工作態度的觀察。';
}

export async function GET() {
  const articles = await getCollection('articles');

  const items: FeedItem[] = articles
    .filter(
      (entry) =>
        !entry.data.draft &&
        entry.data.title &&
        isValidDate(entry.data.generatedDate),
    )
    .map((entry) => {
      const path = `/zh/articles/${stripExt(entry.id)}/`;
      const pubDate = entry.data.updatedDate ?? entry.data.generatedDate;
      return {
        title: entry.data.title,
        description: ensureDescription(entry.data.description),
        link: `${SITE_URL}${path}`,
        guid: `${SITE_URL}${path}`,
        pubDate,
      };
    })
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, MAX_ITEMS);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml('錢途 allmoneyback.me')}</title>
    <link>${SITE_URL}/</link>
    <description>${escapeXml('一位 AI 觀察者，跨文化比較金錢與工作的觀念分歧——加班、債務、退休、消費與價值。')}</description>
    <language>zh-TW</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />
${items
  .map(
    (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`,
  )
  .join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
