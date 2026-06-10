// engine/commissions/index.ts
//
// C4：把讀者委託案（「帶一樁賺錢的事來」）回灌選題引擎。
//
// 委託案是「候選」，不是自動發文 —— 它仍要走完 select 的 B/A 硬閘門、
// anchor、evidence、critique。本模組只負責「把待處理委託案安全地拉回來」，
// 交給 select 當作 LLM prompt 的種子（seed）。能不能進生產，由下游閘門決定。
//
// 優雅降級 / 無副作用：
//   未設定 INTERACTION_API 或 ADMIN_TOKEN（任一缺）→ STUB：回 { commissions: [], stub: true }，
//   不發任何網路請求。測試在無 env 下執行時一律走 STUB（無網路）。
//
// 來源（C3 Worker）：
//   GET /api/commissions/export  (Authorization: Bearer <ADMIN_TOKEN>)
//     → { commissions: [{ id, methodDesc, regionHint?, sourceHint?, nickname?, createdAt, status }] }
//   非公開端點，token 守門。形狀以 zod 驗證，shape 不符即 fail loud。

import { z } from 'zod';
import { createLogger } from '../lib/log.js';

const log = createLogger('commissions');

/**
 * 引擎關心的委託案欄位（選題種子用）。
 * nickname/createdAt/status 對選題判斷無用，故 ReaderCommission 只保留
 * methodDesc + 兩個 hint。匯出 response 仍以完整 schema 驗證形狀。
 */
export interface ReaderCommission {
  id: string;
  /** 讀者描述的「賺錢方式 / 案情」（必填）。 */
  methodDesc: string;
  /** 地區線索（選填）。 */
  regionHint?: string;
  /** 可查出處線索（選填）。 */
  sourceHint?: string;
}

/** 匯出端點單筆委託案的 zod schema（驗證 Worker 回應形狀，fail loud）。 */
export const CommissionExportItemSchema = z.object({
  id: z.string().min(1),
  methodDesc: z.string().min(1),
  regionHint: z.string().optional(),
  sourceHint: z.string().optional(),
  nickname: z.string().optional(),
  createdAt: z.string(),
  status: z.string(),
});

/** 匯出端點整體回應的 zod schema：{ commissions: [...] }。 */
export const CommissionExportResponseSchema = z.object({
  commissions: z.array(CommissionExportItemSchema),
});

export type CommissionExportResponse = z.infer<typeof CommissionExportResponseSchema>;

export interface FetchCommissionsResult {
  commissions: ReaderCommission[];
  /** true 表示走了 STUB（未設 env 或注入測試替身），未發任何真實網路請求。 */
  stub: boolean;
}

export interface FetchCommissionsOpts {
  /** 覆寫 INTERACTION_API（測試用）。預設讀 process.env.INTERACTION_API。 */
  apiBase?: string;
  /** 覆寫 ADMIN_TOKEN（測試用）。預設讀 process.env.ADMIN_TOKEN。 */
  adminToken?: string;
  /**
   * 注入的 fetch 替身（測試用，避免真實網路）。
   * 不提供時用全域 fetch。
   */
  fetchImpl?: typeof fetch;
}

/**
 * 拉取待處理（pending）委託案，轉成 ReaderCommission[]。
 *
 *   - INTERACTION_API 或 ADMIN_TOKEN 任一缺 → STUB：回空陣列、stub:true、不發網路。
 *   - 兩者都有 → 真打匯出端點，Bearer 認證，zod 驗證回應形狀（不符即丟錯）。
 *   - 非 2xx → 丟錯（fail loud；選題流程的呼叫端可自行決定要不要吞）。
 */
export async function fetchCommissions(
  opts?: FetchCommissionsOpts,
): Promise<FetchCommissionsResult> {
  const apiBase = opts?.apiBase ?? process.env.INTERACTION_API;
  const adminToken = opts?.adminToken ?? process.env.ADMIN_TOKEN;

  if (!apiBase || !adminToken) {
    log.stub('未設 INTERACTION_API / ADMIN_TOKEN，跳過委託案拉取（STUB，無網路）', {
      hasApiBase: Boolean(apiBase),
      hasToken: Boolean(adminToken),
    });
    return { commissions: [], stub: true };
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const base = apiBase.replace(/\/+$/, '');
  const url = `${base}/api/commissions/export`;

  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (!res.ok) {
    log.error('委託案匯出端點回應非 2xx', { status: res.status });
    throw new Error(`commissions export failed: HTTP ${res.status}`);
  }

  const raw: unknown = await res.json();
  // 形狀驗證：不符即 fail loud（zod 丟 ZodError）。
  const parsed = CommissionExportResponseSchema.parse(raw);

  const commissions: ReaderCommission[] = parsed.commissions.map((c) => ({
    id: c.id,
    methodDesc: c.methodDesc,
    regionHint: c.regionHint,
    sourceHint: c.sourceHint,
  }));

  log.info('拉取委託案完成', { count: commissions.length });
  return { commissions, stub: false };
}
