// 引擎各步驟共用的 zod schemas。
//
// 重用選擇：src/schemas/articles.ts 只 import zod（不依賴 astro，已驗證可乾淨引入），
// 所以這裡直接 import 其中的 sourceSchema（{title,url,region,language,credibility}），
// 作為 EvidenceResultSchema.sources 的形狀，避免重複定義。

import { z } from 'zod';
import { sourceSchema } from '../src/schemas/articles';

/** 抓取層取得的單筆來源項目。 */
export const SourceRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  region: z.string(),
  language: z.string(),
  credibility: z.enum(['high', 'medium', 'low']),
  sourceName: z.string(),
  fetchedAt: z.string(),
  summary: z.string(),
  raw: z.string().optional(),
  access: z.enum(['real', 'stub']),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

/**
 * 選題引擎輸出。
 * 注意：此處 factCategory 允許 'A' —— schema 記錄 AI 的判定，
 * 由下游 gate 負責拒絕 A 類進生產（生產用 articlesSchema 只允許 B）。
 */
export const SelectionSchema = z.object({
  title: z.string(),
  description: z.string(),
  domainTopic: z.string(),
  // 內容軸：選題現在同時提案一個「賺錢方式」（method）與它通往的「結果」（outcome）。
  // witnessVigil 不在此 —— 見證引子在 write 階段才被書寫，非選題階段。
  method: z.string(),
  outcome: z.string(),
  factCategory: z.enum(['A', 'B']),
  stanceRiskLevel: z.enum(['low', 'high']),
  anchorSuggestion: z.string(),
  comparedSuggestions: z.array(z.string()),
  reason: z.string(),
});
export type Selection = z.infer<typeof SelectionSchema>;

/** 定錨演算法輸出。 */
export const AnchorResultSchema = z.object({
  status: z.enum(['ok', 'insufficient']),
  anchorCulture: z.string().optional(),
  comparedCultures: z.array(z.string()).optional(),
  suspectCultures: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type AnchorResult = z.infer<typeof AnchorResultSchema>;

/** 撈證據輸出；sources 形狀重用 src 的 sourceSchema。 */
export const EvidenceResultSchema = z.object({
  status: z.enum(['ok', 'insufficient']),
  sources: z.array(sourceSchema),
  note: z.string().optional(),
});
export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;

/** 批判（critique）裁決輸出。 */
export const CritiqueVerdictSchema = z.object({
  pass: z.boolean(),
  stanceRiskLevel: z.enum(['low', 'high']),
  issues: z.array(
    z.object({
      kind: z.enum(['essentializing', 'mocking', 'bias', 'other']),
      quote: z.string(),
      why: z.string(),
    }),
  ),
  revisedNote: z.string().optional(),
});
export type CritiqueVerdict = z.infer<typeof CritiqueVerdictSchema>;
