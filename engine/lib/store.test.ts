import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './store';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TEST_NAME = '__store_test__';
const TEST_FILE = path.join(DATA_DIR, `${TEST_NAME}.json`);

afterAll(() => {
  if (fs.existsSync(TEST_FILE)) fs.rmSync(TEST_FILE);
});

describe('store', () => {
  it('writeJson 後 readJson 可往返讀回相同資料', () => {
    const data = { a: 1, b: ['x', 'y'], nested: { ok: true } };
    writeJson(TEST_NAME, data);
    const read = readJson(TEST_NAME, null);
    expect(read).toEqual(data);
  });

  it('檔案不存在時 readJson 回 fallback', () => {
    const fallback = { fallback: true };
    const read = readJson('__definitely_missing__', fallback);
    expect(read).toEqual(fallback);
  });
});
