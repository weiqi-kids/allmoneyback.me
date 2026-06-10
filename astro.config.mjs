import { defineConfig } from 'astro/config';
import { writeFile } from 'node:fs/promises';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

/**
 * One-switch deploy target.
 *
 *   DEPLOY_TARGET=production (default) → custom domain allmoneyback.me, base '/',
 *     emits dist/CNAME so GitHub Pages serves the apex domain.
 *   DEPLOY_TARGET=preview → GitHub Pages project page (https://<owner>.github.io/<repo>/),
 *     base '/<repo>/', NO CNAME (so the github.io preview works before the
 *     custom domain is purchased).
 *
 * In GitHub Actions the github.io URL is derived automatically from the runner
 * env; locally you can override via PREVIEW_SITE / PREVIEW_BASE.
 */
const DEPLOY_TARGET = process.env.DEPLOY_TARGET ?? 'production';
const isPreview = DEPLOY_TARGET === 'preview';

const PROD_SITE = 'https://allmoneyback.me';
const CNAME_DOMAIN = 'allmoneyback.me';

// Derive github.io project-page URL from the Actions env when available.
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? 'OWNER';
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'REPO';

const previewSite = process.env.PREVIEW_SITE ?? `https://${owner}.github.io`;
// base must have a leading AND trailing slash.
const rawPreviewBase = process.env.PREVIEW_BASE ?? `/${repo}/`;
const previewBase = `/${rawPreviewBase.replace(/^\/+|\/+$/g, '')}/`;

const site = isPreview ? previewSite : PROD_SITE;
const base = isPreview ? previewBase : '/';

/**
 * Emit dist/CNAME ONLY in production. public/CNAME is intentionally NOT used,
 * because Astro copies public/ on every build (including preview), which would
 * force the custom domain and break the github.io preview.
 */
function cnameIntegration() {
  return {
    name: 'conditional-cname',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        if (isPreview) return;
        await writeFile(new URL('CNAME', dir), `${CNAME_DOMAIN}\n`, 'utf-8');
      },
    },
  };
}

export default defineConfig({
  site,
  base,
  integrations: [
    svelte(),
    sitemap({ filter: (page) => !page.includes('/admin') }),
    mdx(),
    cnameIntegration(),
  ],
  output: 'static',
});
