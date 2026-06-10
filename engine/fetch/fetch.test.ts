// engine/fetch/fetch.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFetch, getStoredSources, isDisallowedSource } from './index.js';
import { SourceRecordSchema } from '../schemas.js';
import { SOURCE_WHITELIST } from '../config/sources.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TEST_STORE = 'sources-test';
const testFilePath = path.join(DATA_DIR, `${TEST_STORE}.json`);

function cleanTestStore() {
  if (fs.existsSync(testFilePath)) {
    fs.unlinkSync(testFilePath);
  }
}

afterEach(() => {
  cleanTestStore();
});

const FIXED_NOW = '2026-06-10T00:00:00.000Z';

describe('runFetch', () => {
  it('produces records that all pass SourceRecordSchema', async () => {
    const result = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    expect(result.records.length).toBeGreaterThan(0);

    for (const rec of result.records) {
      // Throws ZodError if invalid — this is the loudest possible assertion
      expect(() => SourceRecordSchema.parse(rec)).not.toThrow();
    }
  });

  it('every record summary contains a stub/樣品 marker', async () => {
    const result = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    for (const rec of result.records) {
      const hasMarker =
        rec.summary.includes('[STUB 樣品]') ||
        rec.summary.includes('[樣品 real-pending]') ||
        rec.summary.includes('[STUB]') ||
        rec.summary.includes('[樣品]');
      expect(hasMarker, `record ${rec.id} summary missing marker: "${rec.summary}"`).toBe(true);
    }
  });

  it('every record fetchedAt equals injected now', async () => {
    const result = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    for (const rec of result.records) {
      expect(rec.fetchedAt).toBe(FIXED_NOW);
    }
  });

  it('records are stored and getStoredSources returns them', async () => {
    const result = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    const stored = getStoredSources(TEST_STORE);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBe(result.records.length);

    // Verify every produced record id appears in the store
    const storedIds = new Set(stored.map((r) => r.id));
    for (const rec of result.records) {
      expect(storedIds.has(rec.id)).toBe(true);
    }
  });

  it('running twice does not duplicate records (dedupe by id)', async () => {
    const first = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });
    const second = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    // Second run should add 0 new records
    expect(second.added).toBe(0);

    // Store should still only have the original count
    const stored = getStoredSources(TEST_STORE);
    expect(stored.length).toBe(first.records.length);
  });

  it('no record comes from a disallowed/forum source', async () => {
    const result = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    for (const rec of result.records) {
      const forumKeywords = ['reddit', 'ptt', 'dcard', '微博', '論壇', 'forum'];
      const idLower = rec.id.toLowerCase();
      const hasForumId = forumKeywords.some((kw) => idLower.includes(kw));
      expect(hasForumId, `record ${rec.id} appears to be from a forum source`).toBe(false);
    }
  });

  it('result includes stubbed[] and realPending[] lists with correct ids', async () => {
    const result = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    // Every stub entry should appear in stubbed or realPending
    const processedIds = new Set([...result.stubbed, ...result.realPending]);

    const expectedIds = SOURCE_WHITELIST.filter((e) => !isDisallowedSource(e)).map((e) => e.id);

    for (const id of expectedIds) {
      expect(processedIds.has(id), `source ${id} not accounted for in stubbed or realPending`).toBe(
        true,
      );
    }
  });

  it('record access field honestly reflects source whitelist access setting', async () => {
    const result = await runFetch({ now: FIXED_NOW, storeName: TEST_STORE });

    for (const rec of result.records) {
      // Extract the source id from the record id (format: `<prefix>-<sourceId>-<n>`)
      // We check that the record's access matches the whitelist entry's access
      const matchingEntry = SOURCE_WHITELIST.find((e) => rec.id.includes(e.id));
      if (matchingEntry) {
        expect(rec.access).toBe(matchingEntry.access);
      }
    }
  });
});

describe('isDisallowedSource', () => {
  it('allows all current whitelist entries (none are forums)', () => {
    for (const entry of SOURCE_WHITELIST) {
      // None of the current whitelist entries should be disallowed
      expect(isDisallowedSource(entry), `${entry.id} should be allowed`).toBe(false);
    }
  });

  it('rejects an entry whose id contains forum keywords', () => {
    const forumEntry = {
      id: 'reddit-finance',
      name: 'Reddit r/finance',
      kind: 'discourse' as const,
      regions: ['global'],
      languages: ['en'],
      credibility: 'low' as const,
      access: 'stub' as const,
    };
    expect(isDisallowedSource(forumEntry)).toBe(true);
  });

  it('rejects an entry whose id contains ptt', () => {
    const pttEntry = {
      id: 'ptt-gossiping',
      name: 'PTT 八卦板',
      kind: 'discourse' as const,
      regions: ['TW'],
      languages: ['zh'],
      credibility: 'low' as const,
      access: 'stub' as const,
    };
    expect(isDisallowedSource(pttEntry)).toBe(true);
  });
});
