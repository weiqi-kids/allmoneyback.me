// Handler 層整合測試：以假 env（假 D1 + 假 KV）驅動 router，不需真 Cloudflare 帳號或網路。
import { describe, it, expect } from 'vitest';
import { route } from './router';
import type { Env } from './env';

const ORIGIN = 'https://allmoneyback.me';
const ALLOWED_ORIGINS = 'https://allmoneyback.me,https://weiqi-kids.github.io';

interface RunRecord {
  sql: string;
  bindings: unknown[];
}

/** 假 D1：記錄所有 run() 的 SQL+bindings，all() 回預設或設定好的 rows。 */
function fakeD1(allRows: unknown[] = []) {
  const runs: RunRecord[] = [];
  const db = {
    runs,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all<T>() {
          return { results: allRows as T[] };
        },
        async run() {
          runs.push({ sql, bindings: bound });
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return db;
}

/** 假 KV：記憶體 map。 */
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function makeEnv(opts: { allRows?: unknown[]; adminToken?: string } = {}): {
  env: Env;
  db: ReturnType<typeof fakeD1>;
  kv: ReturnType<typeof fakeKV>;
} {
  const db = fakeD1(opts.allRows ?? []);
  const kv = fakeKV();
  const env = {
    DB: db as unknown as Env['DB'],
    RATE_LIMIT: kv as unknown as Env['RATE_LIMIT'],
    ALLOWED_ORIGINS,
    IP_HASH_SALT: 'test-salt',
    ADMIN_TOKEN: opts.adminToken ?? 'secret-admin-token',
  } as Env;
  return { env, db, kv };
}

function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/comments', () => {
  it('inserts a comment with status pending and returns id+status', async () => {
    const { env, db } = makeEnv();
    const res = await route(
      postJson('/api/comments', { slug: 'a-b', nickname: '路人', body: '不錯的記錄' }),
      env,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; status: string };
    expect(json.status).toBe('pending');
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    // 確認 INSERT 用了 'pending' 且帶 ip_hash，且未回傳 ip_hash
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0].sql).toContain("'pending'");
    expect(db.runs[0].sql).toContain('ip_hash');
    expect(JSON.stringify(json)).not.toContain('ip_hash');
    // CORS 鎖定到請求 origin，非 *
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('rejects oversized body with 400', async () => {
    const { env } = makeEnv();
    const res = await route(
      postJson('/api/comments', { slug: 'a', nickname: 'n', body: 'x'.repeat(2001) }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: 'body_too_long' });
  });

  it('returns 429 when rate limit exceeded', async () => {
    const { env } = makeEnv();
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await route(
        postJson('/api/comments', { slug: 'a', nickname: 'n', body: 'hello world' }),
        env,
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('Retry-After')).toBeTruthy();
    expect((await last!.json()) as unknown).toEqual({ error: 'rate_limited' });
  });
});

describe('GET /api/comments', () => {
  it('returns approved comments for slug', async () => {
    const rows = [{ id: '1', nickname: 'a', body: 'hi', created_at: '2026-01-01T00:00:00Z' }];
    const { env } = makeEnv({ allRows: rows });
    const req = new Request('https://worker.example/api/comments?slug=a-b', {
      headers: { Origin: ORIGIN },
    });
    const res = await route(req, env);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ comments: rows });
  });

  it('400 on missing slug', async () => {
    const { env } = makeEnv();
    const req = new Request('https://worker.example/api/comments', { headers: { Origin: ORIGIN } });
    const res = await route(req, env);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/commissions', () => {
  it('inserts a commission pending and returns id', async () => {
    const { env, db } = makeEnv();
    const res = await route(
      postJson('/api/commissions', { methodDesc: '路邊攤賣雞蛋糕能賺多少？', regionHint: '台中' }),
      env,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; status: string };
    expect(json.status).toBe('pending');
    expect(db.runs[0].sql).toContain('commissions');
    expect(db.runs[0].sql).toContain("'pending'");
  });

  it('400 when methodDesc missing', async () => {
    const { env } = makeEnv();
    const res = await route(postJson('/api/commissions', { regionHint: 'x' }), env);
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({ error: 'methodDesc_required' });
  });
});

describe('GET /api/commissions/export', () => {
  it('rejects without ADMIN_TOKEN (401)', async () => {
    const { env } = makeEnv({ adminToken: 'right-token' });
    const req = new Request('https://worker.example/api/commissions/export', {
      headers: { Origin: ORIGIN },
    });
    const res = await route(req, env);
    expect(res.status).toBe(401);
    expect((await res.json()) as unknown).toEqual({ error: 'unauthorized' });
  });

  it('rejects wrong token (401)', async () => {
    const { env } = makeEnv({ adminToken: 'right-token' });
    const req = new Request('https://worker.example/api/commissions/export', {
      headers: { Origin: ORIGIN, Authorization: 'Bearer wrong-token-xx' },
    });
    expect((await route(req, env)).status).toBe(401);
  });

  it('returns commissions with correct token', async () => {
    const rows = [
      {
        id: '1',
        method_desc: 'm',
        region_hint: 'tw',
        source_hint: null,
        nickname: null,
        created_at: '2026-01-01T00:00:00Z',
        status: 'pending',
      },
    ];
    const { env } = makeEnv({ allRows: rows, adminToken: 'right-token' });
    const req = new Request('https://worker.example/api/commissions/export', {
      headers: { Origin: ORIGIN, Authorization: 'Bearer right-token' },
    });
    const res = await route(req, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { commissions: Array<{ methodDesc: string }> };
    expect(json.commissions[0].methodDesc).toBe('m');
    // export 輸出絕不含 ip_hash
    expect(JSON.stringify(json)).not.toContain('ip_hash');
  });
});

describe('CORS + routing', () => {
  it('disallowed origin gets no Allow-Origin header', async () => {
    const { env } = makeEnv();
    const res = await route(
      postJson('/api/comments', { slug: 'a', nickname: 'n', body: 'hi' }, { Origin: 'https://evil.example' }),
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('OPTIONS preflight from allowed origin returns 204', async () => {
    const { env } = makeEnv();
    const req = new Request('https://worker.example/api/comments', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN },
    });
    const res = await route(req, env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('unknown route returns 404 JSON', async () => {
    const { env } = makeEnv();
    const req = new Request('https://worker.example/api/nope', { headers: { Origin: ORIGIN } });
    const res = await route(req, env);
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({ error: 'not_found' });
  });
});
