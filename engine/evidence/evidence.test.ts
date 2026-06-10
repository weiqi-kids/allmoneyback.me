// engine/evidence/evidence.test.ts
//
// E6 撈證據測試（不發任何真實 API；以 test store 餵入手工 SourceRecord）。
// 重點驗證：
//   - 充分案例 → status ok、sources 非空、cultureEvidence 有對應文化條目。
//   - 不足（來源太少 / 只有一個地區）→ insufficient，note 提到「資料不足」。
//   - 白名單強制：非白名單 sourceName（RandomBlog）被排除於 evidence.sources。
//   - 不杜撰：evidence.sources 數量 ≤ 餵入的白名單來源數。
//   - firstHand 由 stats-office 來源正確推導。

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gatherEvidence, culturesToRegions, isFirstHandKind } from './index.js';
import { SourceRecordSchema, type SourceRecord, type Selection } from '../schemas.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TEST_STORE = 'sources-evidence-test';
const testFilePath = path.join(DATA_DIR, `${TEST_STORE}.json`);

function seedStore(records: SourceRecord[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // 全部先過 schema，確保餵入的 fixture 合法（fail loud）。
  for (const r of records) SourceRecordSchema.parse(r);
  fs.writeFileSync(testFilePath, JSON.stringify(records, null, 2) + '\n', 'utf8');
}

function cleanTestStore() {
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
}

afterEach(() => {
  cleanTestStore();
});

const NOW = '2026-06-10T00:00:00.000Z';

// 選題：錨點＝東亞，對照＝美國。
// 東亞地區（TW/JP）來源支撐錨點，美國（US）來源支撐對照。
const SELECTION: Selection = {
  title: '加班是責任還是異常？東亞與美國的工時態度分歧',
  description: '觀察到同一個長工時事實，東亞與美國的詮釋落差很有意思。',
  domainTopic: 'overtime',
  method: '靠延長工時換取收入與職涯位置',
  outcome: '在不同制度下分別走向責任感的肯定、或過勞與管理檢討',
  factCategory: 'B',
  stanceRiskLevel: 'low',
  anchorSuggestion: 'East Asia（東亞）',
  comparedSuggestions: ['United States（美國）'],
  reason: '工時有統計支撐，但態度因制度而異。',
};

// fixture 工廠：以白名單 sourceName 為主，覆寫個別欄位。
function rec(over: Partial<SourceRecord> & Pick<SourceRecord, 'id' | 'sourceName' | 'region'>): SourceRecord {
  return SourceRecordSchema.parse({
    id: over.id,
    title: over.title ?? `${over.sourceName} — 工時態度（樣品）`,
    url: over.url ?? `https://example.com/${over.id}`,
    region: over.region,
    language: over.language ?? 'en',
    credibility: over.credibility ?? 'high',
    sourceName: over.sourceName,
    fetchedAt: over.fetchedAt ?? NOW,
    summary: over.summary ?? '[樣品] 工時態度概覽。',
    access: over.access ?? 'real',
  });
}

// 白名單來源（name 取自 SOURCE_WHITELIST）。
const TW_DGBAS = '中華民國主計總處（DGBAS）'; // stats-office, region TW
const JP_ESTAT = '日本統計局 e-Stat'; // stats-office, region JP
const US_BLS = 'U.S. Bureau of Labor Statistics (BLS)'; // stats-office, region US
const OECD = 'OECD Social & Labour Statistics'; // stats-office, region OECD（跨文化）

describe('culturesToRegions（best-effort 對應）', () => {
  it('East Asia 含 TW/JP/KR', () => {
    const regions = culturesToRegions('East Asia（東亞）');
    expect(regions).toContain('TW');
    expect(regions).toContain('JP');
    expect(regions).toContain('KR');
  });

  it('United States 含 US', () => {
    expect(culturesToRegions('United States（美國）')).toContain('US');
  });

  it('對應不到的文化回空陣列', () => {
    expect(culturesToRegions('Atlantis（虛構）')).toEqual([]);
  });
});

describe('isFirstHandKind（kind → firstHand）', () => {
  it('stats-office / survey → true', () => {
    expect(isFirstHandKind('stats-office')).toBe(true);
    expect(isFirstHandKind('survey')).toBe(true);
  });
  it('academic / discourse → false', () => {
    expect(isFirstHandKind('academic')).toBe(false);
    expect(isFirstHandKind('discourse')).toBe(false);
  });
});

describe('gatherEvidence — 充分案例', () => {
  it('≥3 來源跨 ≥2 地區、涵蓋錨點+對照 → status ok', async () => {
    seedStore([
      rec({ id: 's-tw', sourceName: TW_DGBAS, region: 'TW' }),
      rec({ id: 's-jp', sourceName: JP_ESTAT, region: 'JP' }),
      rec({ id: 's-us', sourceName: US_BLS, region: 'US' }),
    ]);

    const { evidence, cultureEvidence } = await gatherEvidence(SELECTION, {
      storeName: TEST_STORE,
    });

    expect(evidence.status).toBe('ok');
    expect(evidence.sources.length).toBeGreaterThan(0);
    expect(evidence.note).toBeUndefined();

    // cultureEvidence 應有錨點與對照兩個文化的條目
    const cultures = cultureEvidence.map((c) => c.culture);
    expect(cultures).toContain('East Asia（東亞）');
    expect(cultures).toContain('United States（美國）');

    // 錨點文化（東亞）應有來源（TW + JP）
    const anchor = cultureEvidence.find((c) => c.culture === 'East Asia（東亞）')!;
    expect(anchor.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('firstHand：stats-office 來源在 cultureEvidence 中標記為一手', async () => {
    seedStore([
      rec({ id: 's-tw', sourceName: TW_DGBAS, region: 'TW' }),
      rec({ id: 's-jp', sourceName: JP_ESTAT, region: 'JP' }),
      rec({ id: 's-us', sourceName: US_BLS, region: 'US' }),
    ]);

    const { cultureEvidence } = await gatherEvidence(SELECTION, { storeName: TEST_STORE });
    const anchor = cultureEvidence.find((c) => c.culture === 'East Asia（東亞）')!;
    // DGBAS / e-Stat 都是 stats-office → 一手
    expect(anchor.sources.every((s) => s.firstHand === true)).toBe(true);
  });
});

describe('gatherEvidence — 不足（資料不足）', () => {
  it('來源太少（1 筆）→ insufficient，note 提到資料不足', async () => {
    seedStore([rec({ id: 's-tw', sourceName: TW_DGBAS, region: 'TW' })]);

    const { evidence } = await gatherEvidence(SELECTION, { storeName: TEST_STORE });
    expect(evidence.status).toBe('insufficient');
    expect(evidence.note).toContain('資料不足');
  });

  it('只有一個地區（3 筆同 region）→ insufficient（regions < 2）', async () => {
    // 三筆全部 TW（東亞）；無對照文化來源，地區也只有一個。
    seedStore([
      rec({ id: 's-tw1', sourceName: TW_DGBAS, region: 'TW' }),
      rec({ id: 's-tw2', sourceName: JP_ESTAT, region: 'TW' }),
      rec({ id: 's-tw3', sourceName: US_BLS, region: 'TW' }),
    ]);

    const { evidence } = await gatherEvidence(SELECTION, { storeName: TEST_STORE });
    expect(evidence.status).toBe('insufficient');
    expect(evidence.note).toContain('資料不足');
    // 應明確點出地區不足
    expect(evidence.note).toContain('地區');
  });
});

describe('gatherEvidence — 白名單強制 + 不杜撰', () => {
  it('非白名單 sourceName（RandomBlog）被排除於 evidence.sources', async () => {
    seedStore([
      rec({ id: 's-tw', sourceName: TW_DGBAS, region: 'TW' }),
      rec({ id: 's-jp', sourceName: JP_ESTAT, region: 'JP' }),
      rec({ id: 's-us', sourceName: US_BLS, region: 'US' }),
      // 非白名單來源 —— 必須被排除
      rec({ id: 's-blog', sourceName: 'RandomBlog', region: 'TW', title: 'RandomBlog 工時雜談' }),
    ]);

    const { evidence } = await gatherEvidence(SELECTION, { storeName: TEST_STORE });

    // RandomBlog 不應出現在 evidence.sources（用 title 比對）
    const titles = evidence.sources.map((s) => s.title);
    expect(titles.some((t) => t.includes('RandomBlog'))).toBe(false);
  });

  it('不杜撰：evidence.sources 數量 ≤ 餵入的白名單來源數', async () => {
    const whitelistSeed: SourceRecord[] = [
      rec({ id: 's-tw', sourceName: TW_DGBAS, region: 'TW' }),
      rec({ id: 's-jp', sourceName: JP_ESTAT, region: 'JP' }),
      rec({ id: 's-us', sourceName: US_BLS, region: 'US' }),
      rec({ id: 's-oecd', sourceName: OECD, region: 'OECD' }),
    ];
    // 額外混入一個非白名單來源，確認引擎不會把它算進去，也不會新增來源。
    seedStore([
      ...whitelistSeed,
      rec({ id: 's-blog', sourceName: 'RandomBlog', region: 'US' }),
    ]);

    const { evidence } = await gatherEvidence(SELECTION, { storeName: TEST_STORE });

    // 引擎只會用 store 裡、且在白名單內的來源，不會憑空新增。
    expect(evidence.sources.length).toBeLessThanOrEqual(whitelistSeed.length);
  });
});
