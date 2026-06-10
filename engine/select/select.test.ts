// engine/select/select.test.ts
//
// STUB 模式測試（不發任何真實 API）。重點驗證：
//   - STUB 端到端：回傳已接受的 B 類選題（≥2 對照文化），model:'stub'。
//   - 硬閘門（CODE gate）：A 類被拒（rejectReason 提到 A）；對照 <2 被拒。
//   - evaluateSelection 純函式：B+2 接受、A 拒、B+1 拒。
//   - 去重：record 後再選同題 → 拒（重複選題），用 test store 不污染正式記錄。

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  selectTopic,
  evaluateSelection,
  recordSelection,
  isDuplicate,
  normalizeKey,
  stubSelection,
} from './index.js';
import type { Selection } from '../schemas.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TEST_STORE = 'select-processed-test';
const testFilePath = path.join(DATA_DIR, `${TEST_STORE}.json`);

function cleanTestStore() {
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
}

afterEach(() => {
  cleanTestStore();
});

// 共用替身工廠：以合法 B 類選題為基底，便於覆寫個別欄位。
function makeSelection(over: Partial<Selection> = {}): Selection {
  return { ...stubSelection(), ...over };
}

describe('selectTopic (STUB)', () => {
  it('回傳已接受的 B 類選題，≥2 對照文化，model:stub', async () => {
    // 關閉去重以求測試確定性
    const result = await selectTopic({ dedupe: false });

    expect(result.model).toBe('stub');
    expect(result.stub).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.selection.factCategory).toBe('B');
    expect(result.selection.comparedSuggestions.length).toBeGreaterThanOrEqual(2);
  });

  it('A 類閘門：注入 factCategory=A 的替身 → accepted:false，rejectReason 提到 A', async () => {
    const result = await selectTopic({
      dedupe: false,
      stub: () => makeSelection({ factCategory: 'A' }),
    });

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toBeDefined();
    expect(result.rejectReason).toContain('A');
  });

  it('對照文化 <2 → accepted:false，rejectReason 提到對照不足', async () => {
    const result = await selectTopic({
      dedupe: false,
      stub: () => makeSelection({ comparedSuggestions: ['East Asia（東亞）'] }),
    });

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('對照');
  });
});

describe('evaluateSelection (純函式硬閘門)', () => {
  it('B + 2 對照 → accept', () => {
    const gate = evaluateSelection(makeSelection());
    expect(gate.accepted).toBe(true);
    expect(gate.rejectReason).toBeUndefined();
  });

  it('A → reject（rejectReason 提到 A）', () => {
    const gate = evaluateSelection(makeSelection({ factCategory: 'A' }));
    expect(gate.accepted).toBe(false);
    expect(gate.rejectReason).toContain('A');
  });

  it('B + 1 對照 → reject', () => {
    const gate = evaluateSelection(makeSelection({ comparedSuggestions: ['only-one'] }));
    expect(gate.accepted).toBe(false);
    expect(gate.rejectReason).toContain('對照');
  });
});

describe('dedupe（用 test store）', () => {
  it('record 後再選同一題 → 拒（重複選題）', async () => {
    cleanTestStore();

    // 第一次：開啟去重，但 store 為空 → 接受
    const first = await selectTopic({ storeName: TEST_STORE });
    expect(first.accepted).toBe(true);

    // 記錄這個已接受選題
    recordSelection(first.selection, { storeName: TEST_STORE, now: '2026-06-10T00:00:00.000Z' });
    expect(isDuplicate(first.selection, { storeName: TEST_STORE })).toBe(true);

    // 第二次選到同樣的（STUB 固定回傳同一題）→ 被去重擋下
    const second = await selectTopic({ storeName: TEST_STORE });
    expect(second.accepted).toBe(false);
    expect(second.rejectReason).toBe('重複選題');
  });

  it('normalizeKey 對空白/標點差異視為同一 key', () => {
    const a = makeSelection({ title: '為什麼東亞把加班當責任', domainTopic: 'overtime' });
    const b = makeSelection({ title: '為什麼東亞，把加班 當責任！', domainTopic: 'overtime' });
    expect(normalizeKey(a)).toBe(normalizeKey(b));
  });
});
