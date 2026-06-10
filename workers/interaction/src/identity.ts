// 來訪者辨識：以 SHA-256(IP + salt) 雜湊，僅供防濫用/速率限制，不外露、不存原始 IP
//（總規格 §9.3「身分以後端側 IP/裝置指紋雜湊辨識（防濫用用途，不外露）」）。

/** 從請求標頭取得客戶端 IP；Cloudflare 以 CF-Connecting-IP 提供。 */
export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * 以 Web Crypto 計算 SHA-256(ip + ':' + salt) 的十六進位字串。
 * 永不回傳/儲存原始 IP。salt 來自 env.IP_HASH_SALT（secret）。
 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
