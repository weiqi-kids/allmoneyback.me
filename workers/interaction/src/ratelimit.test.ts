import { describe, it, expect } from 'vitest';
import { checkRateLimit, type KVLike, type RateLimitConfig } from './ratelimit';

/** 簡單的記憶體假 KV，記錄 put 過的值與 TTL。 */
function fakeKV(): KVLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

const CFG: RateLimitConfig = { windowSeconds: 600, limit: 3 };
const NOW = 1_000_000_000_000; // 固定 now，落在某視窗中段

describe('checkRateLimit', () => {
  it('allows up to the limit then blocks', async () => {
    const kv = fakeKV();
    const r1 = await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);
    const r2 = await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);
    const r3 = await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);
    const r4 = await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    expect(r4.retryAfter).toBeGreaterThan(0);
  });

  it('isolates by route and by ip_hash', async () => {
    const kv = fakeKV();
    await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);
    await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);
    await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);
    // 不同 ip_hash 不受影響
    const other = await checkRateLimit(kv, 'comments', 'h2', CFG, NOW);
    expect(other.allowed).toBe(true);
    // 不同 route 不受影響
    const route2 = await checkRateLimit(kv, 'commissions', 'h1', CFG, NOW);
    expect(route2.allowed).toBe(true);
  });

  it('resets in a new window', async () => {
    const kv = fakeKV();
    for (let i = 0; i < 4; i++) await checkRateLimit(kv, 'comments', 'h1', CFG, NOW);
    // 下個視窗
    const next = await checkRateLimit(kv, 'comments', 'h1', CFG, NOW + CFG.windowSeconds * 1000);
    expect(next.allowed).toBe(true);
  });
});
