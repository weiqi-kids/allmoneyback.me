/**
 * Base-aware internal link helper.
 *
 * `import.meta.env.BASE_URL` is `/` in production and `/<repo>/` in the
 * GitHub Pages preview build (set via `base` in astro.config.mjs). Hardcoded
 * root-absolute hrefs like `/zh/` would 404 under a project-page base, so all
 * internal navigation strings must be passed through `withBase()`.
 *
 * Join rules:
 * - Never produce a double slash (`//`) at the boundary.
 * - Always keep exactly one slash between base and path.
 * - External URLs (http/https/mailto/protocol-relative) are returned as-is.
 */
export function withBase(path: string): string {
  // Leave external / non-internal URLs untouched.
  if (/^([a-z]+:)?\/\//i.test(path) || /^[a-z]+:/i.test(path)) {
    return path;
  }

  const base = import.meta.env.BASE_URL; // '/' or '/<repo>/'
  const baseNoTrailing = base.endsWith('/') ? base.slice(0, -1) : base; // '' or '/<repo>'
  const pathWithLeading = path.startsWith('/') ? path : `/${path}`;

  return `${baseNoTrailing}${pathWithLeading}`;
}
