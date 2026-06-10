// engine/evidence/index.ts
//
// E6 撈證據層：依「選題」的文化集合，從 store 撈取態度證據，
// 但只接受 SOURCE_WHITELIST 上的來源。若證據不夠多元／不夠充分，
// 一律退回「資料不足」，絕不杜撰來源。
//
// 設計誠信原則（spec §10.5 延伸）：
//   1. 只用白名單來源。store 裡若混入非白名單來源（理論上 fetch 已擋，
//      但此處做縱深防禦再擋一次），一律排除並記錄，不進證據。
//   2. 引擎永遠不會「新增」store 裡沒有的來源來湊數
//      （evidence.sources ⊆ 已存且在白名單內的來源）。
//   3. 充分度閘門未過 → status:'insufficient' + note 說明缺什麼，
//      不會為了過關而捏造或灌水來源。
//
// 輸出兩部分：
//   - evidence: EvidenceResult（status / sources / note），符合 EvidenceResultSchema。
//   - cultureEvidence: CultureEvidence[]，餵給 E5 computeAnchor。

import { EvidenceResultSchema, type EvidenceResult } from '../schemas.js';
import type { Selection } from '../schemas.js';
import type { SourceRecord } from '../schemas.js';
import { SOURCE_WHITELIST, type SourceWhitelistEntry } from '../config/sources.js';
import { getStoredSources } from '../fetch/index.js';
import type { CultureEvidence, SourceEvidence } from '../anchor/index.js';
import { createLogger } from '../lib/log.js';

const log = createLogger('evidence');

// ── 文化 → 地區 對應（best-effort，有文件說明）────────────────────────────────
//
// 選題的文化字串可能帶中文標籤（例如 'Nordic（北歐）'、'East Asia（東亞）'），
// 所以這裡用「關鍵字包含」比對：只要 culture 字串含某個 key，就採用對應地區。
// 這是刻意保守的最佳努力對應，不求窮舉；對應不到的文化會被視為「無相關地區」，
// 進而在充分度閘門被擋（寧可退回資料不足，也不亂湊）。
//
// 地區代碼對齊 SOURCE_WHITELIST 各 entry 的 regions（'TW','JP','US','EU','KR',
// 'OECD','global' 等），這樣才能跟 store 來源的 region 對得上。

interface CultureRegionRule {
  /** culture 字串需包含的關鍵字（小寫比對）。 */
  keywords: string[];
  /** 對應到的來源地區集合。 */
  regions: string[];
}

const CULTURE_REGION_RULES: CultureRegionRule[] = [
  {
    keywords: ['nordic', '北歐', 'scandinav', '北欧'],
    // 北歐國家 + OECD（北歐多屬 OECD，視為跨文化背景，見下方 CROSS_CULTURAL_REGIONS）。
    regions: ['Nordic', 'Sweden', 'Denmark', 'Norway', 'Finland', 'EU', 'OECD'],
  },
  {
    keywords: ['east asia', '東亞', '东亚'],
    regions: ['East Asia', 'JP', 'TW', 'KR', 'CN', 'Japan', 'Taiwan', 'South Korea', 'China'],
  },
  { keywords: ['japan', '日本'], regions: ['JP', 'Japan', 'East Asia'] },
  { keywords: ['taiwan', '台灣', '臺灣', '台湾'], regions: ['TW', 'Taiwan', 'East Asia'] },
  { keywords: ['korea', '韓國', '韩国', '南韓'], regions: ['KR', 'South Korea', 'East Asia'] },
  { keywords: ['china', '中國', '中国', '大陸'], regions: ['CN', 'China', 'East Asia'] },
  {
    keywords: ['united states', 'america', '美國', '美国', 'usa', ' us ', '(us)'],
    regions: ['US', 'United States', 'OECD'],
  },
  { keywords: ['europe', '歐洲', '欧洲', 'eu '], regions: ['EU', 'Europe', 'OECD'] },
];

/**
 * 跨文化／全球性地區：這些地區的來源（OECD、global）對所有具名文化都「相關」，
 * 但不算「文化專屬證據」——它們不能單獨支撐某個文化的證據需求
 * （見 cultureEvidence 建構：culture-specific 的判定排除這些地區）。
 */
const CROSS_CULTURAL_REGIONS = new Set(['OECD', 'global', 'Global', 'GLOBAL']);

/**
 * 把一個文化字串映射到一組來源地區（best-effort）。
 * 對應不到任何規則時回空陣列（該文化將難以取得相關來源 → 充分度閘門會擋）。
 *
 * 匯出供測試。
 */
export function culturesToRegions(culture: string): string[] {
  const lower = ` ${culture.toLowerCase()} `; // 前後補空白，讓 ' us ' 這類含邊界的 key 可比對
  const out = new Set<string>();
  for (const rule of CULTURE_REGION_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      for (const r of rule.regions) out.add(r);
    }
  }
  return [...out];
}

// ── 白名單比對 ────────────────────────────────────────────────────────────────

/**
 * 找出某 sourceName 對應的白名單 entry（以 name 或 id 比對，大小寫不敏感）。
 * 找不到 → 該來源不在白名單，回 undefined（呼叫端須排除之）。
 */
function matchWhitelistEntry(sourceName: string): SourceWhitelistEntry | undefined {
  const target = sourceName.trim().toLowerCase();
  return SOURCE_WHITELIST.find(
    (e) => e.name.toLowerCase() === target || e.id.toLowerCase() === target,
  );
}

/**
 * 由白名單 entry 的 kind 推導是否為一手資料。
 * 'stats-office' / 'survey' → 一手（統計局／原始問卷調查）。
 * 'academic' / 'discourse' → 非一手（二手引用／語料）。
 *
 * 匯出供測試。
 */
export function isFirstHandKind(kind: SourceWhitelistEntry['kind']): boolean {
  return kind === 'stats-office' || kind === 'survey';
}

// ── 內部型別 ──────────────────────────────────────────────────────────────────

/** 通過白名單且與某具名文化相關的來源（含其白名單 entry 與相關性資訊）。 */
interface RelevantSource {
  record: SourceRecord;
  entry: SourceWhitelistEntry;
  /** 此來源相關的具名文化（可能多個；跨文化來源相關於全部）。 */
  cultures: string[];
  /** 是否為跨文化／全球來源（OECD/global）——不算任何文化的「專屬」證據。 */
  crossCultural: boolean;
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export interface GatherEvidenceOpts {
  /** 充分度門檻：相關白名單來源總數下限。預設 3。 */
  minSources?: number;
  /** 充分度門檻：相關來源涵蓋的相異地區數下限。預設 2。 */
  minRegions?: number;
  /** store 名稱覆寫（測試用）。預設 'sources'。 */
  storeName?: string;
}

export interface GatherEvidenceResult {
  evidence: EvidenceResult;
  cultureEvidence: CultureEvidence[];
}

/**
 * 撈證據。
 *
 * 流程：
 *   1. 讀 store 來源（getStoredSources，可覆寫 storeName）。
 *   2. 白名單強制：只留 sourceName 命中 SOURCE_WHITELIST（name 或 id）的來源；
 *      其餘排除並記錄（縱深防禦）。
 *   3. 相關性：把選題文化（anchorSuggestion + comparedSuggestions）映射到地區，
 *      來源 region 落在任一文化的地區集合 → 相關。
 *      OECD/global 來源視為對所有具名文化相關，但標記為非文化專屬。
 *   4. 建 cultureEvidence：每個文化收集其相關白名單來源為 {credibility,access,firstHand}。
 *   5. 充分度閘門（全過才 ok）：
 *        - 相關白名單來源總數 ≥ minSources
 *        - 相異地區數 ≥ minRegions
 *        - 錨點文化至少 1 筆（文化專屬）來源
 *        - 至少 2 個文化各有 ≥1 筆（文化專屬）來源
 *      任一未過 → insufficient + note 說明缺什麼。絕不灌水。
 *   6. evidence.sources = 相關白名單來源映射為 {title,url,region,language,credibility}。
 *      整體以 EvidenceResultSchema 驗證（parse，fail loud）。
 */
export async function gatherEvidence(
  selection: Selection,
  opts?: GatherEvidenceOpts,
): Promise<GatherEvidenceResult> {
  const minSources = opts?.minSources ?? 3;
  const minRegions = opts?.minRegions ?? 2;
  const storeName = opts?.storeName ?? 'sources';

  const anchorCulture = selection.anchorSuggestion;
  const cultures = [anchorCulture, ...selection.comparedSuggestions];

  log.info('gather evidence started', {
    storeName,
    anchor: anchorCulture,
    compared: selection.comparedSuggestions,
    minSources,
    minRegions,
  });

  // Step 1：讀 store
  const stored = getStoredSources(storeName);

  // 預先算好每個文化的地區集合
  const cultureRegions = new Map<string, Set<string>>();
  for (const c of cultures) {
    cultureRegions.set(c, new Set(culturesToRegions(c)));
  }

  // Step 2 + 3：白名單強制 + 相關性
  const relevant: RelevantSource[] = [];
  for (const rec of stored) {
    const entry = matchWhitelistEntry(rec.sourceName);
    if (!entry) {
      // 縱深防禦：非白名單來源一律排除（即使 fetch 已擋）。
      log.warn('excluding off-whitelist source', { id: rec.id, sourceName: rec.sourceName });
      continue;
    }

    const crossCultural = CROSS_CULTURAL_REGIONS.has(rec.region);

    // 找出此來源相關的具名文化
    let matchedCultures: string[];
    if (crossCultural) {
      // 跨文化來源：對所有具名文化相關，但非文化專屬
      matchedCultures = [...cultures];
    } else {
      matchedCultures = cultures.filter((c) => cultureRegions.get(c)!.has(rec.region));
    }

    if (matchedCultures.length === 0) {
      // 在白名單內，但其 region 對不上任何具名文化 → 與本選題無關，排除
      log.info('whitelist source not relevant to any selection culture', {
        id: rec.id,
        region: rec.region,
      });
      continue;
    }

    relevant.push({ record: rec, entry, cultures: matchedCultures, crossCultural });
  }

  // Step 4：建 cultureEvidence（餵給 computeAnchor）。
  // 注意：跨文化來源（OECD/global）會出現在每個文化的 sources，
  // 但在充分度判定「文化專屬證據」時不計（見 cultureSpecificCount）。
  const cultureEvidence: CultureEvidence[] = cultures.map((culture) => {
    const sources: SourceEvidence[] = relevant
      .filter((r) => r.cultures.includes(culture))
      .map((r) => ({
        credibility: r.record.credibility,
        access: r.record.access,
        firstHand: isFirstHandKind(r.entry.kind),
      }));
    return { culture, sources };
  });

  // 每個文化「文化專屬」來源數（排除跨文化來源）——用於充分度閘門。
  const cultureSpecificCount = new Map<string, number>();
  for (const culture of cultures) {
    const n = relevant.filter((r) => !r.crossCultural && r.cultures.includes(culture)).length;
    cultureSpecificCount.set(culture, n);
  }

  // Step 5：充分度閘門
  const totalRelevant = relevant.length;
  const distinctRegions = new Set(relevant.map((r) => r.record.region));
  const anchorHasSource = (cultureSpecificCount.get(anchorCulture) ?? 0) >= 1;
  const culturesWithEvidence = cultures.filter(
    (c) => (cultureSpecificCount.get(c) ?? 0) >= 1,
  ).length;

  const missing: string[] = [];
  if (totalRelevant < minSources) {
    missing.push(`相關白名單來源僅 ${totalRelevant} 筆（需 ≥ ${minSources}）`);
  }
  if (distinctRegions.size < minRegions) {
    missing.push(`涵蓋地區僅 ${distinctRegions.size} 個（需 ≥ ${minRegions}）`);
  }
  if (!anchorHasSource) {
    missing.push(`錨點文化「${anchorCulture}」無文化專屬證據`);
  }
  if (culturesWithEvidence < 2) {
    missing.push(`僅 ${culturesWithEvidence} 個文化具備證據（需 ≥ 2 個文化各有來源）`);
  }

  const sufficient = missing.length === 0;

  // Step 6：組裝 evidence.sources（白名單相關來源）
  const evidenceSources = relevant.map((r) => ({
    title: r.record.title,
    url: r.record.url,
    region: r.record.region,
    language: r.record.language,
    credibility: r.record.credibility,
  }));

  const evidence: EvidenceResult = EvidenceResultSchema.parse({
    status: sufficient ? 'ok' : 'insufficient',
    sources: evidenceSources,
    ...(sufficient ? {} : { note: `資料不足：${missing.join('；')}` }),
  });

  log.info('gather evidence done', {
    status: evidence.status,
    relevant: totalRelevant,
    regions: distinctRegions.size,
    anchorHasSource,
    culturesWithEvidence,
    ...(sufficient ? {} : { note: evidence.note }),
  });

  return { evidence, cultureEvidence };
}
