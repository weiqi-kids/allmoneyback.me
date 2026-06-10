// 委託投題端點：免登入投案（pending）+ token-guarded 匯出給選題引擎（C4）。
//
// POST /api/commissions          → 驗證 + 內容過濾 + 速率限制 + 雜湊 IP + pending 入庫。
// GET  /api/commissions/export   → Bearer ADMIN_TOKEN 守門，供 C4 選題引擎拉取待處理委託案。
//                                  非公開、絕不無認證開放。

import type { Env } from './env';
import { errorJson, json } from './response';
import { validateCommission } from './validate';
import { clientIp, hashIp } from './identity';
import { checkRateLimit, DEFAULT_LIMITS } from './ratelimit';

/** 單次匯出最多回傳的委託案數。 */
export const MAX_EXPORT = 500;

/** POST /api/commissions — 讀者「帶一樁賺錢的事來」，預設 pending。 */
export async function createCommission(
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

  const v = validateCommission(raw);
  if (!v.ok || !v.value) return errorJson(v.error ?? 'invalid', 400, corsHeaders);

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);

  const rl = await checkRateLimit(
    env.RATE_LIMIT,
    'commissions',
    ipHash,
    DEFAULT_LIMITS.commissions,
  );
  if (!rl.allowed) {
    return errorJson('rate_limited', 429, {
      ...corsHeaders,
      'Retry-After': String(rl.retryAfter),
    });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { methodDesc, regionHint, sourceHint, nickname } = v.value;

  await env.DB.prepare(
    `INSERT INTO commissions
       (id, method_desc, region_hint, source_hint, nickname, created_at, status, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(id, methodDesc, regionHint ?? null, sourceHint ?? null, nickname ?? null, createdAt, ipHash)
    .run();

  return json({ id, status: 'pending' }, 201, corsHeaders);
}

interface CommissionExportRow {
  id: string;
  method_desc: string;
  region_hint: string | null;
  source_hint: string | null;
  nickname: string | null;
  created_at: string;
  status: string;
}

/**
 * 時序安全的位元組比較。
 * Workers runtime 提供 `crypto.subtle.timingSafeEqual`（best-practices 建議用於秘密比較）；
 * 若不可用（如 Node 測試環境）則退回等長迴圈式常數時間比較。
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * 比對 Authorization: Bearer <token> 與 env.ADMIN_TOKEN，使用時序安全比較。
 * token 缺漏/格式錯/長度不符 → false（不洩漏哪一步失敗）。
 */
export function isAuthorizedExport(authHeader: string | null, adminToken: string | undefined): boolean {
  if (!adminToken) return false; // 未設定 secret 時一律拒絕，不開天窗。
  if (!authHeader) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  const presented = authHeader.slice(prefix.length);

  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(adminToken);
  return timingSafeEqual(a, b);
}

/** GET /api/commissions/export — token 守門，回 pending 委託案供 C4 ingest。 */
export async function exportCommissions(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const auth = request.headers.get('Authorization');
  if (!isAuthorizedExport(auth, env.ADMIN_TOKEN)) {
    return errorJson('unauthorized', 401, corsHeaders);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, method_desc, region_hint, source_hint, nickname, created_at, status
       FROM commissions
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?`,
  )
    .bind(MAX_EXPORT)
    .all<CommissionExportRow>();

  // 以引擎友善的 camelCase 形狀輸出；不含 ip_hash。
  const commissions = (results ?? []).map((r) => ({
    id: r.id,
    methodDesc: r.method_desc,
    regionHint: r.region_hint ?? undefined,
    sourceHint: r.source_hint ?? undefined,
    nickname: r.nickname ?? undefined,
    createdAt: r.created_at,
    status: r.status,
  }));

  return json({ commissions }, 200, corsHeaders);
}
