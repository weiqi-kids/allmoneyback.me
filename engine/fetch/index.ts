// engine/fetch/index.ts
//
// E3 抓取層：依 SOURCE_WHITELIST 產生 SourceRecord，存入 store。
//
// 設計誠信原則（spec §10.5）：
//   1. 論壇／ToS 可疑來源一律拒絕（isDisallowedSource）。
//   2. access==='stub'：以 [STUB 樣品] 清楚標記，絕不偽裝成真實抓取。
//   3. access==='real'：目前尚未實作個別 API 整合，
//      以 [樣品 real-pending] 標記、記錄為 realPending，
//      並留 TODO 說明真抓待接。不會偽裝成已抓取的真實資料。
//   4. 所有記錄的 `access` 欄位如實反映原白名單的設定。

import { SOURCE_WHITELIST, type SourceWhitelistEntry } from '../config/sources.js';
import { SourceRecordSchema, type SourceRecord } from '../schemas.js';
import { readJson, writeJson } from '../lib/store.js';
import { createLogger } from '../lib/log.js';

const log = createLogger('fetch');

// ── 守衛：偵測不應存取的來源 ─────────────────────────────────────────────────

/**
 * 若來源屬論壇或 ToS 可疑性質，回傳 true（應跳過）。
 * 這是縱深防禦：即使 SOURCE_WHITELIST 設定誤入論壇來源，此處也會攔截。
 */
export function isDisallowedSource(entry: SourceWhitelistEntry): boolean {
  const DISALLOWED_KINDS = new Set<string>(); // 白名單僅有 survey/stats-office/academic/discourse
  // 'discourse' 是已授權語料庫（CC-100），不等同論壇，但要檢查 notes 有無論壇跡象
  if (DISALLOWED_KINDS.has(entry.kind)) return true;

  // 若 notes 明確提到已排除的論壇清單，說明此條目混入了警告文字，應視為需要額外審查
  const forumKeywords = ['reddit', 'ptt', 'dcard', '微博', '論壇', 'forum'];
  const notesLower = (entry.notes ?? '').toLowerCase();
  // 只有 notes 是在「說這個來源本身是論壇」才拒絕；
  // 若只是提醒「其他論壇排除」則不拒絕
  const selfIsForumPattern = /^(?:todo|注意)[:：].*(?:reddit|ptt|dcard|微博)/i;
  if (selfIsForumPattern.test(entry.notes ?? '')) {
    // 如果 id 也直接是論壇相關，才真正拒絕（保守判斷）
    if (forumKeywords.some((kw) => entry.id.toLowerCase().includes(kw))) {
      return true;
    }
  }

  // 確定性拒絕：id 直接包含已知論壇名稱
  if (forumKeywords.some((kw) => entry.id.toLowerCase().includes(kw))) {
    return true;
  }

  return false;
}

// ── 樣品記錄產生器 ────────────────────────────────────────────────────────────

/**
 * 為 stub 或 real-pending 來源產生 1–2 筆固定樣品記錄。
 * `prefix` 控制摘要前綴與 id 前綴，以便在 log 與記錄中清楚區分。
 * `access` 如實帶入 entry 的原始設定（'stub' 或 'real'），
 * 確保記錄的 access 欄位永遠誠實反映白名單的設定。
 */
function buildSampleRecords(
  entry: SourceWhitelistEntry,
  now: string,
  opts: { prefix: string; idPrefix: string; recordCount?: number },
): SourceRecord[] {
  const count = opts.recordCount ?? 2;
  const records: SourceRecord[] = [];

  const sampleTitles = [
    `${entry.name} — 跨文化金錢態度概覽（樣品）`,
    `${entry.name} — 工作價值觀與退休規劃（樣品）`,
  ];

  for (let n = 1; n <= count; n++) {
    const record = SourceRecordSchema.parse({
      id: `${opts.idPrefix}-${entry.id}-${n}`,
      title: sampleTitles[(n - 1) % sampleTitles.length],
      url: entry.url ?? `https://example.com/${entry.id}/${n}`,
      region: entry.regions[0] ?? 'global',
      language: entry.languages[0] ?? 'en',
      credibility: entry.credibility,
      sourceName: entry.name,
      fetchedAt: now,
      summary: `${opts.prefix} 此為來源「${entry.name}」的示範樣品，非真實抓取資料。`,
      raw: undefined,
      access: entry.access,
    } satisfies SourceRecord);
    records.push(record);
  }

  return records;
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export interface RunFetchResult {
  added: number;
  records: SourceRecord[];
  stubbed: string[];
  realPending: string[];
}

/**
 * 執行 E3 抓取層。
 *
 * - access==='stub'：產生 [STUB 樣品] 記錄，加入 stubbed[]。
 * - access==='real'：TODO 待接真實 API。目前產生 [樣品 real-pending] 記錄，
 *   加入 realPending[]，絕不偽裝成真實抓取資料。
 * - 所有記錄均通過 SourceRecordSchema 驗證後才存入 store。
 * - 以 id 去重（不覆蓋已存在的記錄）。
 *
 * @param opts.now        - 可注入的 fetchedAt 時間戳（供測試用），預設為 new Date().toISOString()
 * @param opts.storeName  - store 名稱，預設 'sources'（測試時傳 'sources-test' 避免污染）
 */
export async function runFetch(opts?: {
  now?: string;
  storeName?: string;
}): Promise<RunFetchResult> {
  const now = opts?.now ?? new Date().toISOString();
  const storeName = opts?.storeName ?? 'sources';

  log.info('fetch layer started', { now, storeName });

  const produced: SourceRecord[] = [];
  const stubbed: string[] = [];
  const realPending: string[] = [];

  for (const entry of SOURCE_WHITELIST) {
    // ── 守衛：拒絕論壇或 ToS 可疑來源 ────────────────────────────────────────
    if (isDisallowedSource(entry)) {
      log.warn('skipping disallowed source', { id: entry.id, kind: entry.kind });
      continue;
    }

    if (entry.access === 'stub') {
      // stub：以 [STUB 樣品] 清楚標記，誠實表明非真實資料
      const records = buildSampleRecords(entry, now, {
        prefix: '[STUB 樣品]',
        idPrefix: 'stub',
        recordCount: 2,
      });
      log.stub('stub records produced', { sourceId: entry.id, count: records.length });
      produced.push(...records);
      stubbed.push(entry.id);
    } else {
      // access === 'real'
      // TODO: 未來每個 real 來源需實作個別 API 整合（per-source integration work）：
      //   - pew-research: 下載 CSV 後解析（需免費帳號）
      //   - world-values-survey: WVS Wave 7 資料集下載
      //   - oecd-stats: OECD.Stat SDMX/JSON API
      //   - jp-estat: e-Stat REST API（需 appId）
      //   - us-bls: BLS Public Data API v2
      //   - eurostat: Eurostat JSON-API
      // 目前以 [樣品 real-pending] 標記，誠實告知尚未對接，絕不偽裝為真實抓取。
      const records = buildSampleRecords(entry, now, {
        prefix: '[樣品 real-pending]',
        idPrefix: 'real-pending',
        recordCount: 2,
      });
      log.stub('real-pending records produced (live API not yet integrated)', {
        sourceId: entry.id,
        apiHint: entry.url,
        notes: entry.notes,
        count: records.length,
      });
      produced.push(...records);
      realPending.push(entry.id);
    }
  }

  // ── 驗證所有記錄（fail loud）────────────────────────────────────────────────
  // buildSampleRecords 內已用 SourceRecordSchema.parse()；此處再做一次整批驗證以保險
  for (const rec of produced) {
    SourceRecordSchema.parse(rec); // throws ZodError if invalid
  }

  // ── 與 store 去重後寫入 ────────────────────────────────────────────────────
  const existing = readJson<SourceRecord[]>(storeName, []);
  const existingIds = new Set(existing.map((r) => r.id));
  const newRecords = produced.filter((r) => !existingIds.has(r.id));
  const merged = [...existing, ...newRecords];
  writeJson(storeName, merged);

  log.info('fetch layer done', {
    produced: produced.length,
    added: newRecords.length,
    stubbed: stubbed.length,
    realPending: realPending.length,
  });

  return {
    added: newRecords.length,
    records: produced,
    stubbed,
    realPending,
  };
}

// ── 讀取已存記錄 ──────────────────────────────────────────────────────────────

/**
 * 從 store 讀取已存的 SourceRecord[]。
 * @param storeName 預設 'sources'
 */
export function getStoredSources(storeName = 'sources'): SourceRecord[] {
  return readJson<SourceRecord[]>(storeName, []);
}
