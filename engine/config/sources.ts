// 來源白名單設定。
//
// access 欄位說明：
//   'real'  = 有穩定的公開 API 或可程式化下載的資料集（E3 fetch 可接）。
//   'stub'  = 目前無程式化存取路徑，E3 會以 stub 替代；TODO 標示待補。
//
// 重要：一般性論壇（Reddit、PTT、Dcard、微博⋯⋯）因 ToS／著作權疑慮一律排除（spec §10.5）。
// 本白名單只收錄調查機構、統計局、學術資料庫、或已授權的多語語料庫。

export interface SourceWhitelistEntry {
  /** 唯一識別碼，英文 kebab-case。 */
  id: string;
  /** 顯示名稱。 */
  name: string;
  /** 資料性質。 */
  kind: 'survey' | 'stats-office' | 'academic' | 'discourse';
  /** 覆蓋地區代碼或名稱（例如 'TW', 'JP', 'global', 'OECD'）。 */
  regions: string[];
  /** 資料語言（ISO 639-1 或 'multi'）。 */
  languages: string[];
  /** 來源可信度。 */
  credibility: 'high' | 'medium' | 'low';
  /**
   * 程式化存取成熟度：
   *   'real'  = 有穩定 API / 資料集下載，E3 可直接對接。
   *   'stub'  = 尚無程式化路徑，E3 以 stub 替代。
   */
  access: 'real' | 'stub';
  /** 官方入口網址（供人工查閱）。 */
  url?: string;
  /** 補充說明或 TODO。 */
  notes?: string;
}

export const SOURCE_WHITELIST: SourceWhitelistEntry[] = [
  // ── 調查機構 ────────────────────────────────────────────────────────────────
  {
    id: 'pew-research',
    name: 'Pew Research Center',
    kind: 'survey',
    regions: ['global'],
    languages: ['en'],
    credibility: 'high',
    access: 'real',
    url: 'https://www.pewresearch.org/datasets/',
    notes:
      '提供公開可下載的調查微資料（需免費註冊）；涵蓋全球態度調查，金錢觀與工作態度均有覆蓋。',
  },
  {
    id: 'world-values-survey',
    name: 'World Values Survey (WVS)',
    kind: 'survey',
    regions: ['global'],
    languages: ['multi'],
    credibility: 'high',
    access: 'real',
    url: 'https://www.worldvaluessurvey.org/WVSDocumentationWV7.jsp',
    notes:
      'Wave 7 資料集可直接下載（CSV/SPSS/R）；涵蓋工作價值觀、儲蓄、退休等題組，跨文化分析核心來源。',
  },

  // ── 統計局 ──────────────────────────────────────────────────────────────────
  {
    id: 'oecd-stats',
    name: 'OECD Social & Labour Statistics',
    kind: 'stats-office',
    regions: ['OECD'],
    languages: ['en'],
    credibility: 'high',
    access: 'real',
    url: 'https://stats.oecd.org/',
    notes:
      'OECD.Stat 提供 SDMX/JSON API，工時（HOURS）、薪資、退休率等指標可程式化查詢。',
  },
  {
    id: 'tw-dgbas',
    name: '中華民國主計總處（DGBAS）',
    kind: 'stats-office',
    regions: ['TW'],
    languages: ['zh'],
    credibility: 'high',
    access: 'stub',
    url: 'https://www.dgbas.gov.tw/mp.asp?mp=1',
    notes:
      'TODO: 開放資料平台（data.gov.tw）有部分統計 CSV，但缺乏穩定機器可讀 API；E3 暫以 stub 替代。',
  },
  {
    id: 'jp-estat',
    name: '日本統計局 e-Stat',
    kind: 'stats-office',
    regions: ['JP'],
    languages: ['ja', 'en'],
    credibility: 'high',
    access: 'real',
    url: 'https://api.e-stat.go.jp/',
    notes: 'e-Stat 提供 REST API（需申請免費 appId）；勞働力調查、家計調查均可查詢。',
  },
  {
    id: 'us-bls',
    name: 'U.S. Bureau of Labor Statistics (BLS)',
    kind: 'stats-office',
    regions: ['US'],
    languages: ['en'],
    credibility: 'high',
    access: 'real',
    url: 'https://www.bls.gov/developers/',
    notes: 'BLS Public Data API v2；工時、薪資、消費者支出調查（CEX）均可免費查詢。',
  },
  {
    id: 'eurostat',
    name: 'Eurostat',
    kind: 'stats-office',
    regions: ['EU'],
    languages: ['en', 'multi'],
    credibility: 'high',
    access: 'real',
    url: 'https://ec.europa.eu/eurostat/web/json-and-unicode-web-services',
    notes: 'Eurostat JSON-API；勞動市場、消費、退休相關指標覆蓋 EU27 成員國。',
  },
  {
    id: 'kr-kostat',
    name: '韓國統計廳（KOSTAT）',
    kind: 'stats-office',
    regions: ['KR'],
    languages: ['ko', 'en'],
    credibility: 'high',
    access: 'stub',
    url: 'https://kosis.kr/eng/',
    notes:
      'TODO: KOSIS 有英文介面，但 API 文件不完整；E3 暫以 stub 替代，待 API key 申請後啟用。',
  },

  // ── 學術資料庫 ──────────────────────────────────────────────────────────────
  {
    id: 'issp',
    name: 'International Social Survey Programme (ISSP)',
    kind: 'academic',
    regions: ['global'],
    languages: ['multi'],
    credibility: 'high',
    access: 'stub',
    url: 'https://issp.org/data-download/by-topic/',
    notes:
      'TODO: 資料集需在 GESIS 免費申請帳號後下載（ZA 編號）；Work Orientations 及 Social Inequality 模組直接相關。E3 暫 stub。',
  },
  {
    id: 'cross-cultural-academic',
    name: '跨文化學術研究（通用入口）',
    kind: 'academic',
    regions: ['global'],
    languages: ['multi'],
    credibility: 'high',
    access: 'stub',
    url: 'https://scholar.google.com/',
    notes:
      'TODO: 指向 Google Scholar / Semantic Scholar 的關鍵字查詢；E3 以 stub 產生示例引用，待整合 Semantic Scholar API。',
  },

  // ── 語料庫（discourse）────────────────────────────────────────────────────────
  {
    id: 'cc100-multilingual',
    name: 'CC-100 多語網頁語料庫',
    kind: 'discourse',
    regions: ['global'],
    languages: ['multi'],
    credibility: 'medium',
    access: 'stub',
    url: 'https://data.statmt.org/cc-100/',
    notes:
      '已授權的公開爬取語料（CommonCrawl 子集）；可供文化語言模式分析，但非原始民調數據，引用時需標明來源性質。' +
      '注意：一般性論壇（Reddit、PTT、Dcard、微博⋯⋯）因 ToS／著作權疑慮一律排除（spec §10.5）。E3 暫 stub。',
  },
];

/**
 * 回傳適用於當前領域的來源白名單。
 * 目前回傳全部（單領域站點）；未來可依 domain 參數過濾。
 */
export function sourcesForDomain(): SourceWhitelistEntry[] {
  return SOURCE_WHITELIST;
}
