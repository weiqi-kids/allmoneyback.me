// 速率限制：KV-based 固定視窗，per (ip_hash + route)（總規格 §9.3「速率限制（KV）」）。
//
// 策略：固定視窗計數。key = `rl:<route>:<ip_hash>:<windowStart>`，TTL = windowSeconds。
// 視窗內計數 > limit 即拒（429），並回 retryAfter 秒提示。
//
// 與 D1 解耦、無 floating promise：所有 KV 讀寫皆 await。

export interface RateLimitConfig {
  /** 視窗長度（秒）。 */
  windowSeconds: number;
  /** 視窗內允許的請求數。 */
  limit: number;
}

/** 預設：每 10 分鐘 5 次發文（留言/委託共用同等級）。 */
export const DEFAULT_LIMITS = {
  comments: { windowSeconds: 600, limit: 5 } as RateLimitConfig,
  commissions: { windowSeconds: 600, limit: 5 } as RateLimitConfig,
};

export interface RateLimitResult {
  allowed: boolean;
  /** 被拒時的建議重試秒數。 */
  retryAfter: number;
  /** 目前視窗內計數（含本次）。 */
  count: number;
}

/** KV 介面的最小子集，方便測試以假物件替換。 */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/**
 * 純決策 + KV 持久化。傳入固定的 now（毫秒）以利測試決定視窗。
 * 注意：固定視窗在邊界附近有輕微突發容忍，對防濫用足夠且實作簡單可靠。
 */
export async function checkRateLimit(
  kv: KVLike,
  route: string,
  ipHash: string,
  cfg: RateLimitConfig,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowMs = cfg.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `rl:${route}:${ipHash}:${windowStart}`;

  const raw = await kv.get(key);
  const prev = raw ? parseInt(raw, 10) : 0;
  const count = (Number.isFinite(prev) ? prev : 0) + 1;

  // 視窗剩餘秒數，作為 retryAfter 與 KV TTL。
  const elapsed = now - windowStart;
  const remainingMs = windowMs - elapsed;
  const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));

  if (count > cfg.limit) {
    // 超限：不再增寫（避免無限延長），直接拒絕。
    return { allowed: false, retryAfter, count: count - 1 };
  }

  // 未超限：寫回計數，TTL 設為視窗剩餘時間，視窗結束自動清零。
  await kv.put(key, String(count), { expirationTtl: retryAfter });
  return { allowed: true, retryAfter: 0, count };
}
