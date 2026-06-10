// CORS：鎖定 allowlist，嚴禁 "*"（總規格 §9.3「CORS 鎖本站網域」）。
//
// allowlist 來自 env.ALLOWED_ORIGINS（逗號分隔）。只有當 Request 的 Origin 落在
// allowlist 時才回 Access-Control-Allow-Origin: <該 origin>；否則完全不回該標頭，
// 瀏覽器即會擋下跨域回應。

/** 解析逗號分隔的 allowlist 字串為去空白、去空項的陣列。 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/** 判斷某 Origin 是否在 allowlist 內。null/undefined（同源或非瀏覽器）視為不放行跨域標頭。 */
export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  return allowed.includes(origin);
}

/**
 * 依請求 Origin 與 allowlist 產生 CORS 回應標頭。
 * 只有放行的 origin 才會得到 Allow-Origin / Vary；不放行則回空物件（無 CORS 標頭）。
 */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!isOriginAllowed(origin, allowed)) {
    // 仍回 Vary 讓快取依 Origin 分流，但不放行任何來源。
    return { Vary: 'Origin' };
  }
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** 處理 OPTIONS 預檢：放行則 204 + CORS 標頭，否則 403（無 CORS 標頭）。 */
export function handlePreflight(origin: string | null, allowed: string[]): Response {
  if (!isOriginAllowed(origin, allowed)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
}
