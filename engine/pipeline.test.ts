// engine/pipeline.test.ts
//
// E8 端到端整合測試（STUB 模式，不發任何真實 API）。
//
// 兩條主路徑：
//   1. happy path：在 test store 餵入「足以讓 evidence 充分、anchor 可解」的白名單來源後，
//      runPipeline 應抵達 status:'published-draft'，且草稿 frontmatter 過 articlesSchema、
//      markdown 含 frontmatter fence、model.write==='stub'、stub:true。
//   2. rejection path：store 空（或稀疏），evidence 無法充分 → status:'rejected'。
//
// STUB 選題固定（select/index.ts stubSelection）：
//   anchor = Nordic（北歐）、compared = East Asia（東亞）、United States（美國）。
// 因此 seed 需提供：
//   - Nordic（錨點）：Eurostat（region 'EU'，high/real/stats-office=一手）→ 穩定一手可信，可當 anchor。
//   - East Asia（對照）：日本 e-Stat（region 'JP'，high/real/stats-office）。
//   - United States（對照）：US BLS（region 'US'，high/real/stats-office）。
// → 3 筆來源、3 個地區（EU/JP/US）、錨點與兩對照各有文化專屬一手來源。

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPipeline } from './pipeline.js';
import { SourceRecordSchema, type SourceRecord } from './schemas.js';
import { articlesSchema } from '../src/schemas/articles';

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(ENGINE_DIR, 'data');
/** 真正會被 build 上線的內容目錄（相對 repo root = engine 的上一層）。 */
const REAL_CONTENT_DIR = path.resolve(ENGINE_DIR, '..', 'src', 'content', 'articles');

const HAPPY_STORE = 'sources-pipeline-test';
const EMPTY_STORE = 'sources-pipeline-empty-test';

const NOW = '2026-06-10T00:00:00.000Z';

function storePath(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

function cleanStore(name: string): void {
  const p = storePath(name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** 把手工 SourceRecord[] 寫入指定 test store（全部先過 schema，fail loud）。 */
function seedStore(name: string, records: SourceRecord[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const r of records) SourceRecordSchema.parse(r);
  fs.writeFileSync(storePath(name), JSON.stringify(records, null, 2) + '\n', 'utf8');
}

// 白名單來源名稱（取自 SOURCE_WHITELIST）。
const EUROSTAT = 'Eurostat'; // stats-office, region EU（對應 Nordic）
const JP_ESTAT = '日本統計局 e-Stat'; // stats-office, region JP（對應 East Asia）
const US_BLS = 'U.S. Bureau of Labor Statistics (BLS)'; // stats-office, region US（對應 United States）

function rec(
  over: Partial<SourceRecord> & Pick<SourceRecord, 'id' | 'sourceName' | 'region'>,
): SourceRecord {
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

/** 為 STUB 選題（Nordic / East Asia / United States）seed 足夠且充分的白名單來源。 */
function seedHappyStore(): void {
  seedStore(HAPPY_STORE, [
    rec({ id: 'p-eu', sourceName: EUROSTAT, region: 'EU' }), // Nordic 錨點：high/real/一手
    rec({ id: 'p-jp', sourceName: JP_ESTAT, region: 'JP' }), // East Asia 對照
    rec({ id: 'p-us', sourceName: US_BLS, region: 'US' }), // United States 對照
  ]);
}

afterEach(() => {
  cleanStore(HAPPY_STORE);
  cleanStore(EMPTY_STORE);
});

describe('runPipeline — happy path（STUB 端到端）', () => {
  it('seed 充分來源後抵達 published-draft，草稿過 articlesSchema', async () => {
    seedHappyStore();

    const result = await runPipeline({ now: NOW, storeName: HAPPY_STORE });

    expect(result.status).toBe('published-draft');
    expect(result.stub).toBe(true);
    expect(result.model?.write).toBe('stub');

    const draft = result.draft!;
    expect(draft).toBeDefined();

    // frontmatter 必須過生產用 articlesSchema（不丟錯即通過）。
    const parsed = articlesSchema.parse(draft.frontmatter);
    expect(parsed.factCategory).toBe('B');
    expect(parsed.anchorCulture.length).toBeGreaterThan(0);
    expect(parsed.comparedCultures.length).toBeGreaterThanOrEqual(2);

    // markdown 為非空字串，且含 --- frontmatter fence。
    expect(typeof draft.markdown).toBe('string');
    expect(draft.markdown.length).toBeGreaterThan(0);
    expect(draft.markdown.startsWith('---\n')).toBe(true);
    // 第一個 fence 之後應有第二個 fence 收束 frontmatter。
    expect(draft.markdown.indexOf('---', 4)).toBeGreaterThan(0);
  });
});

describe('runPipeline — critique 接線（E11）', () => {
  it('DRY-RUN（publish:false）：critique 有值、publishResult undefined、不寫任何檔', async () => {
    seedHappyStore();

    // 隔離的暫存目錄：即使（不該）發生寫檔，也只會落在這裡而非真實目錄。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-dryrun-'));
    const contentDir = path.join(tmp, 'content');
    const reviewDir = path.join(tmp, 'review');

    try {
      const result = await runPipeline({
        now: NOW,
        storeName: HAPPY_STORE,
        publish: false,
        contentDir,
        reviewDir,
      });

      expect(result.status).toBe('published-draft');

      // critique 摘要必須有值；happy stub → 第 1 輪過關、low、不分流待審。
      expect(result.critique).toBeDefined();
      expect(result.critique!.routedToReview).toBe(false);
      expect(result.critique!.verdictPass).toBe(true);
      expect(result.critique!.stanceRiskLevel).toBe('low');
      expect(result.critique!.rounds).toBeGreaterThanOrEqual(1);
      expect(result.critique!.critiqueModel).toBe('stub');

      // DRY-RUN：publishResult 必須 undefined，且沒有任何檔被寫出。
      expect(result.publishResult).toBeUndefined();
      expect(fs.existsSync(contentDir)).toBe(false);
      expect(fs.existsSync(reviewDir)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('withCover（STUB）：掛上佔位封面、coverImage 設定、coverC2paVerified=false、frontmatter 仍過 schema', async () => {
    seedHappyStore();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-cover-'));
    const coverOutDir = path.join(tmp, 'covers');
    try {
      const result = await runPipeline({
        now: NOW,
        storeName: HAPPY_STORE,
        withCover: true,
        coverOutDir,
      });
      expect(result.status).toBe('published-draft');
      const fm = result.draft!.frontmatter;
      expect(fm.coverImage).toBeDefined();
      // STUB 佔位圖不帶 C2PA → 未驗證。
      expect(fm.coverC2paVerified).toBe(false);
      // 封面圖實際寫出。
      const files = fs.readdirSync(coverOutDir).filter((f) => f.endsWith('.png'));
      expect(files.length).toBe(1);
      // frontmatter 仍過生產 schema。
      expect(() => articlesSchema.parse(result.draft!.frontmatter)).not.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('PUBLISH 到暫存目錄（publish:true）：published、檔案落在暫存 content 目錄；真實 src/content 未被碰', async () => {
    seedHappyStore();

    // 落地前先記下真實內容目錄的檔案清單，事後比對未被新增。
    const before = fs.readdirSync(REAL_CONTENT_DIR).sort();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-publish-'));
    const contentDir = path.join(tmp, 'content');
    const reviewDir = path.join(tmp, 'review');

    try {
      const result = await runPipeline({
        now: NOW,
        storeName: HAPPY_STORE,
        publish: true,
        contentDir,
        reviewDir,
      });

      expect(result.status).toBe('published-draft');
      expect(result.publishResult).toBeDefined();
      expect(result.publishResult!.action).toBe('published');

      // 檔案必須真的寫進「暫存」content 目錄。
      const writtenPath = result.publishResult!.path;
      expect(fs.existsSync(writtenPath)).toBe(true);
      expect(path.resolve(writtenPath).startsWith(path.resolve(contentDir))).toBe(true);
      const mds = fs.readdirSync(contentDir).filter((f) => f.endsWith('.md'));
      expect(mds.length).toBe(1);

      // 低風險草稿不走隔離：review 目錄不應被建立。
      expect(fs.existsSync(reviewDir)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // 安全性質：真實 src/content/articles 未被新增任何檔（仍只有 demo 文章）。
    const after = fs.readdirSync(REAL_CONTENT_DIR).sort();
    expect(after).toEqual(before);
  });
});

describe('runPipeline — rejection path（證據不足）', () => {
  it('空 store（skipFetch）→ rejected，stage evidence', async () => {
    // 空 store + skipFetch：select 的 STUB 選題仍 accepted（B 類、2 對照），
    // 但 evidence 在空 store 下必然 insufficient → 在 evidence 階段被擋。
    seedStore(EMPTY_STORE, []);

    const result = await runPipeline({
      now: NOW,
      storeName: EMPTY_STORE,
      skipFetch: true,
    });

    expect(result.status).toBe('rejected');
    expect(result.stage).toBe('evidence');
    expect(result.rejectReason).toBeDefined();
    expect(result.rejectReason).toContain('資料不足');
  });
});
