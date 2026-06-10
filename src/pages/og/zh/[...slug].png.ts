import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import sharp from 'sharp';
import { generateOgSvg } from '@/utils/og-template';

/**
 * Per-article Open Graph image, generated at build time.
 *
 * Satori renders the title (Noto Sans TC) to a self-contained, path-based SVG
 * (vector glyph outlines — no font lookup needed to rasterize), which sharp then
 * turns into a 1200x630 PNG. Because the glyphs are already outlined, sharp does
 * not need any CJK font installed to produce correct output.
 *
 * Routes: /og/zh/<post.id>.png — one per published zh article.
 */
export async function getStaticPaths() {
  const posts = await getCollection(
    'articles',
    (e) => e.data.lang === 'zh' && !e.data.draft,
  );
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { title: post.data.title },
  }));
}

export const GET: APIRoute = async ({ props }) => {
  const { title } = props as { title: string };

  const svg = await generateOgSvg(title);
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

  // Wrap in Uint8Array so the body is a valid BodyInit under the DOM lib types
  // (Node Buffer isn't recognized as BodyInit by @astrojs/check's tsconfig).
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
