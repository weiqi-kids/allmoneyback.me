import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCoverImage, isImageStubMode } from './image';

// 這些測試只跑 STUB 模式（清掉 OPENAI_API_KEY），絕不發真實 OpenAI API 請求。
// 暫存封面寫到 engine/data/ 底下（gitignore），測後清理——絕不寫進 src/content。

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TMP_COVERS = path.join(DATA_DIR, '_test_covers');

describe('image STUB 模式', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
    // 清理暫存封面
    fs.rmSync(TMP_COVERS, { recursive: true, force: true });
  });

  it('未設 OPENAI_API_KEY 時 isImageStubMode 為 true', () => {
    expect(isImageStubMode()).toBe(true);
  });

  it('generateCoverImage 寫出佔位 PNG、c2pa=stub-none、model=stub、bytes>0', async () => {
    const res = await generateCoverImage({
      prompt: 'x',
      slug: 'test-cover',
      outDir: TMP_COVERS,
    });

    expect(res.stub).toBe(true);
    expect(res.model).toBe('stub');
    expect(res.c2pa).toBe('stub-none');
    expect(res.bytes).toBeGreaterThan(0);
    expect(res.path).toBe(path.join(TMP_COVERS, 'test-cover.png'));

    // 檔案實際存在且為合法 PNG（magic bytes）。
    expect(fs.existsSync(res.path)).toBe(true);
    const buf = fs.readFileSync(res.path);
    expect(buf.length).toBe(res.bytes);
    expect(buf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
