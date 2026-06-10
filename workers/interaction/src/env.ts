// 環境 binding 型別。
//
// 部署時 binding 由 wrangler.jsonc 定義；理想上以 `wrangler types` 產生 worker-configuration.d.ts。
// 因本專案 worker 與 Astro 站解耦、且 CI/測試不安裝 wrangler，這裡手動宣告最小可用型別，
// 並以 @cloudflare/workers-types 提供 D1Database / KVNamespace 介面。
//
// 秘密（IP_HASH_SALT / ADMIN_TOKEN）只在執行期由 `wrangler secret put` 注入，
// 不落 wrangler.jsonc、不落原始碼（見 wrangler.jsonc 註解與 OPERATIONS.md）。

export interface Env {
  /** D1：留言 + 委託案。 */
  DB: D1Database;
  /** KV：速率限制計數器（per ip_hash + route）。 */
  RATE_LIMIT: KVNamespace;
  /** CORS allowlist，逗號分隔；vars，非秘密。 */
  ALLOWED_ORIGINS: string;
  /** 雜湊來訪者 IP 的鹽；secret，不外露。 */
  IP_HASH_SALT: string;
  /** 委託案匯出端點的 Bearer token；secret，給選題引擎 C4 用。 */
  ADMIN_TOKEN: string;
}
