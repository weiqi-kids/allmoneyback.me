// 留言端點：公開讀（approved）+ 免登入發（pending，待審不裸奔）。
//
// GET  /api/comments?slug=<slug>  → 列出該文已核准留言，時間序，上限 200（§9.1 顯示克制、時間序）。
// POST /api/comments              → 驗證 + 內容過濾 + 速率限制 + 雜湊 IP + pending 入庫。

import type { Env } from './env';
import { errorJson, json } from './response';
import { validateComment, isValidSlug } from './validate';
import { clientIp, hashIp } from './identity';
import { checkRateLimit, DEFAULT_LIMITS } from './ratelimit';

/** 單篇文章最多回傳的留言數。 */
export const MAX_COMMENTS = 200;

interface CommentRow {
  id: string;
  nickname: string;
  body: string;
  created_at: string;
}

/** GET /api/comments?slug=... — 公開讀，只回 approved。 */
export async function listComments(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug')?.trim();
  if (!slug) return errorJson('slug_required', 400, corsHeaders);
  if (!isValidSlug(slug)) return errorJson('slug_invalid', 400, corsHeaders);

  const { results } = await env.DB.prepare(
    `SELECT id, nickname, body, created_at
       FROM comments
      WHERE article_slug = ? AND status = 'approved'
      ORDER BY created_at ASC
      LIMIT ?`,
  )
    .bind(slug, MAX_COMMENTS)
    .all<CommentRow>();

  return json({ comments: results ?? [] }, 200, corsHeaders);
}

/** POST /api/comments — 免登入發文，預設 pending。 */
export async function createComment(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorJson('invalid_json', 400, corsHeaders);
  }

  const v = validateComment(raw);
  if (!v.ok || !v.value) return errorJson(v.error ?? 'invalid', 400, corsHeaders);

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);

  const rl = await checkRateLimit(env.RATE_LIMIT, 'comments', ipHash, DEFAULT_LIMITS.comments);
  if (!rl.allowed) {
    return errorJson('rate_limited', 429, {
      ...corsHeaders,
      'Retry-After': String(rl.retryAfter),
    });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { slug, nickname, body } = v.value;

  await env.DB.prepare(
    `INSERT INTO comments (id, article_slug, nickname, body, created_at, status, ip_hash)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(id, slug, nickname, body, createdAt, ipHash)
    .run();

  // 回傳 id + status；status 一律 pending（待審不裸奔）。不回傳 ip_hash。
  return json({ id, status: 'pending' }, 201, corsHeaders);
}
