// engine/commissions/index.test.ts
//
// 不發任何真實網路：未設 env → STUB 空陣列；有 env → 用注入的 fetch 替身。
// 重點：
//   - STUB：INTERACTION_API / ADMIN_TOKEN 任一缺 → { commissions: [], stub: true }，零 fetch。
//   - 真打（注入 fetchImpl）：帶 Bearer header、打 /api/commissions/export、zod 驗證形狀。
//   - 形狀不符 → fail loud（丟錯）。
//   - 非 2xx → 丟錯。

import { describe, it, expect, vi } from 'vitest';
import {
  fetchCommissions,
  CommissionExportResponseSchema,
} from './index.js';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchCommissions — STUB（無 env，無網路）', () => {
  it('缺 apiBase → STUB 空陣列，不呼叫 fetch', async () => {
    const fetchSpy = vi.fn();
    const result = await fetchCommissions({
      apiBase: '',
      adminToken: 'tok',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(result.stub).toBe(true);
    expect(result.commissions).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('缺 adminToken → STUB 空陣列，不呼叫 fetch', async () => {
    const fetchSpy = vi.fn();
    const result = await fetchCommissions({
      apiBase: 'https://example.workers.dev',
      adminToken: '',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(result.stub).toBe(true);
    expect(result.commissions).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchCommissions — 真打（注入 fetch 替身）', () => {
  it('帶 Bearer、打 export 端點、回轉成 ReaderCommission[]', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      okResponse({
        commissions: [
          {
            id: 'c1',
            methodDesc: '在夜市擺攤賣手沖咖啡',
            regionHint: '台灣',
            sourceHint: '朋友親述',
            nickname: '阿明',
            createdAt: '2026-06-10T00:00:00.000Z',
            status: 'pending',
          },
          {
            id: 'c2',
            methodDesc: '靠接遠端外包案維生',
            createdAt: '2026-06-10T01:00:00.000Z',
            status: 'pending',
          },
        ],
      }),
    );

    const result = await fetchCommissions({
      apiBase: 'https://example.workers.dev/',
      adminToken: 'secret-token',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(result.stub).toBe(false);
    expect(result.commissions).toHaveLength(2);
    // 只保留引擎關心的欄位（無 nickname/createdAt/status）。
    expect(result.commissions[0]).toEqual({
      id: 'c1',
      methodDesc: '在夜市擺攤賣手沖咖啡',
      regionHint: '台灣',
      sourceHint: '朋友親述',
    });
    expect(result.commissions[1]).toEqual({
      id: 'c2',
      methodDesc: '靠接遠端外包案維生',
      regionHint: undefined,
      sourceHint: undefined,
    });

    // URL 正規化（去尾斜線）+ Bearer header。
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.workers.dev/api/commissions/export');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer secret-token',
    });
  });

  it('形狀不符 → fail loud（丟錯）', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      okResponse({ commissions: [{ id: 'c1' /* 缺 methodDesc */ }] }),
    );
    await expect(
      fetchCommissions({
        apiBase: 'https://example.workers.dev',
        adminToken: 'tok',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  it('非 2xx → 丟錯', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(
      fetchCommissions({
        apiBase: 'https://example.workers.dev',
        adminToken: 'tok',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });
});

describe('CommissionExportResponseSchema', () => {
  it('接受合法形狀、拒絕缺欄位', () => {
    expect(
      CommissionExportResponseSchema.safeParse({
        commissions: [
          { id: 'a', methodDesc: 'x', createdAt: '2026-01-01', status: 'pending' },
        ],
      }).success,
    ).toBe(true);
    expect(
      CommissionExportResponseSchema.safeParse({ commissions: [{ id: 'a' }] }).success,
    ).toBe(false);
  });
});
