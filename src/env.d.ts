/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** GA4 Measurement ID（留空不注入 GA4）。 */
  readonly PUBLIC_GA4_MEASUREMENT_ID?: string;
  /**
   * 互動後端（C3 Cloudflare Worker）的 API base URL。
   * 留空/未設定 → 前台留言與委託投題一律優雅降級（不發請求、不報錯）。
   */
  readonly PUBLIC_INTERACTION_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
