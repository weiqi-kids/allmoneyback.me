import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

function stripExt(id: string): string {
  return id.replace(/\.[^.]+$/, '');
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export const GET: APIRoute = async () => {
  const articles = await getCollection('articles', ({ data }) => !data.draft);

  const sorted = [...articles]
    .filter((entry) => isValidDate(entry.data.generatedDate))
    .sort(
      (a, b) =>
        b.data.generatedDate.getTime() - a.data.generatedDate.getTime(),
    );

  const lines: string[] = [
    '# 錢途 allmoneyback.me — 完整內容索引',
    '(Generated at build time)',
    '',
    '## 文章',
  ];

  if (sorted.length === 0) {
    lines.push('（目前尚無文章。）');
  } else {
    for (const entry of sorted) {
      lines.push(
        `- ${entry.data.title} | /zh/articles/${stripExt(entry.id)}/ | ${fmtDate(entry.data.generatedDate)}`,
      );
      lines.push(`  ${entry.data.description}`);
    }
  }
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
