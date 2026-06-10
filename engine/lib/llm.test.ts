import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { llmStructured, isLlmStubMode } from './llm';

// 這些測試只跑 STUB 模式（清掉 ANTHROPIC_API_KEY），絕不發真實 API 請求。

const schema = z.object({ value: z.string(), n: z.number() });

describe('llm STUB 模式', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it('未設 ANTHROPIC_API_KEY 時 isLlmStubMode 為 true', () => {
    expect(isLlmStubMode()).toBe(true);
  });

  it('llmStructured 回傳 stub 物件、model="stub"、stub=true', async () => {
    const res = await llmStructured({
      step: 'test',
      system: 's',
      prompt: 'p',
      schema,
      stub: () => ({ value: 'hi', n: 1 }),
    });
    expect(res.stub).toBe(true);
    expect(res.model).toBe('stub');
    expect(res.data).toEqual({ value: 'hi', n: 1 });
  });

  it('stub() 回傳不符 schema 的物件時應 throw（fail loud）', async () => {
    await expect(
      llmStructured({
        step: 'test',
        system: 's',
        prompt: 'p',
        schema,
        // n 應為 number，這裡給 string → schema 驗證失敗
        stub: () => ({ value: 'hi', n: 'oops' }) as unknown as z.infer<typeof schema>,
      }),
    ).rejects.toThrow();
  });
});
