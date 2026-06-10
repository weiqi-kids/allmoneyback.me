// allmoneyback.me 互動後端 — Cloudflare Worker fetch 入口（總規格 §9.3 B 案）。
//
// 留言 + 委託投題，免登入，待審不裸奔（status=pending）、CORS 鎖域、IP 雜湊、KV 速率限制。
// 路由與各端點實作見 ./router.ts 與 ./{comments,commissions}.ts。
//
// 部署前站長須完成 OPERATIONS：建 D1/KV 並填 wrangler.jsonc placeholder、put 兩個 secret、deploy。

import type { Env } from './env';
import { route } from './router';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
