import { z } from 'zod';

export const sourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  region: z.string(),
  language: z.string(),
  credibility: z.enum(['high', 'medium', 'low']),
});

export type Source = z.infer<typeof sourceSchema>;

export const articlesSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tldr: z.string().min(1),
  domainTopic: z.string().min(1),
  // 內容軸：「賺錢方式 × 結果」的見證記錄（取代舊的純態度差異）
  // method —— 這篇見證的「賺錢方式」（這個世界的某種掙錢路徑）。
  method: z.string().min(1),
  // outcome —— 那條路最後通往哪裡／它的結果。必填：沒有結果就只是態度比較，不是見證記錄。
  outcome: z.string().min(1),
  // witnessVigil —— 一句克制的見證引子（俯瞰開場白）。對映姊妹站 ginnyMemory / patronumVigil。
  witnessVigil: z.string().min(1),
  tags: z.array(z.string()).default([]),
  // 引擎判定
  anchorCulture: z.string().min(1),
  // spec §3：每篇對照文化 2–4 個
  comparedCultures: z.array(z.string()).min(2).max(4),
  suspectCultures: z.array(z.string()).default([]),
  factCategory: z.literal('B'), // 只允許 B；A 類禁止進生產
  stanceRiskLevel: z.enum(['low', 'high']),
  sources: z.array(sourceSchema).min(1),
  // 生成資訊（生成當下寫入，不寫死）
  writeModel: z.string().min(1),
  critiqueModel: z.string().min(1),
  pipelineVersion: z.string().min(1),
  specVersion: z.string().min(1),
  generatedDate: z.coerce.date(),
  updatedDate: z.coerce.date(),
  // 配圖（在 content.config.ts 內會用 Astro image() 覆寫；此處 string 版供測試與非 Astro 消費者）
  coverImage: z.string().optional(),
  coverC2paVerified: z.boolean().default(false),
  // 結構化
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  // 雙語
  lang: z.enum(['zh', 'en']).default('zh'),
  draft: z.boolean().default(false),
});
