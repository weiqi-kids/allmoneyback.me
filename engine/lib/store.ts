// engine/data/ 底下的 JSON 檔案儲存。極簡：readJson / writeJson / ensureDataDir。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// data 目錄相對於本檔案（engine/lib/store.ts）→ engine/data/
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

function filePath(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

/** 確保 engine/data/ 存在（寫入前呼叫）。 */
export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** 讀 engine/data/<name>.json；檔案不存在則回 fallback。 */
export function readJson<T>(name: string, fallback: T): T {
  const p = filePath(name);
  if (!fs.existsSync(p)) return fallback;
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as T;
}

/** 寫 engine/data/<name>.json（pretty JSON），必要時建立 data 目錄。 */
export function writeJson(name: string, data: unknown): void {
  ensureDataDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2) + '\n', 'utf8');
}
