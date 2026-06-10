// 路由：把 method + path 對到 handler。所有路徑在 /api/ 下。
// 未知路徑/方法 → 404 JSON。錯誤 → JSON，不洩漏內部。

import type { Env } from './env';
import { parseAllowedOrigins, corsHeaders, handlePreflight } from './cors';
import { errorJson } from './response';
import { listComments, createComment } from './comments';
import { createCommission, exportCommissions } from './commissions';

type Handler = (
  request: Request,
  env: Env,
  cors: Record<string, string>,
) => Promise<Response>;

/** 依 method + pathname 選擇 handler；無對應回 null。 */
export function matchRoute(method: string, pathname: string): Handler | null {
  if (method === 'GET' && pathname === '/api/comments') return listComments;
  if (method === 'POST' && pathname === '/api/comments') return createComment;
  if (method === 'POST' && pathname === '/api/commissions') return createCommission;
  if (method === 'GET' && pathname === '/api/commissions/export') return exportCommissions;
  return null;
}

export async function route(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);

  // 預檢。
  if (request.method === 'OPTIONS') {
    return handlePreflight(origin, allowed);
  }

  const cors = corsHeaders(origin, allowed);
  const url = new URL(request.url);
  const handler = matchRoute(request.method, url.pathname);

  if (!handler) {
    return errorJson('not_found', 404, cors);
  }

  try {
    return await handler(request, env, cors);
  } catch (err) {
    // 結構化日誌（observability），但對外只回通用錯誤碼。
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'handler_error',
        path: url.pathname,
        method: request.method,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return errorJson('internal_error', 500, cors);
  }
}
