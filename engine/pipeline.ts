// engine/pipeline.ts
//
// E8 管線編排：把 Phase-2 各層串成一條可執行的管線，產出一份「已驗證的草稿」。
//
// 資料相依順序（重要）：fetch → select → evidence → anchor → write
//   - anchor 消費 evidence 產出的 cultureEvidence，所以 evidence 在 anchor「之前」跑。
//
// 設計誠信原則延續各層：任一閘門（select 閘門 / evidence 充分度 / anchor 可得性）
// 未過，管線就「誠實退回」rejected + stage + reason，絕不硬產出半套文章。
// write 步驟本身會再 guard 一次（縱深防禦），理論上不會在此被觸發，因為前面已先擋。
//
// 注意：實際把草稿發佈到 src/content 與 critique（E9/E10）屬 Phase 3；
//   本步驟只負責「產出一份通過 articlesSchema 的草稿」。

import { runFetch } from './fetch/index.js';
import { selectTopic, recordSelection } from './select/index.js';
import { gatherEvidence } from './evidence/index.js';
import { computeAnchor } from './anchor/index.js';
import { writeArticle, type DraftArticle } from './write/index.js';
import type { Selection } from './schemas.js';
import { createLogger } from './lib/log.js';
import { isLlmStubMode } from './lib/llm.js';

const log = createLogger('pipeline');

export interface PipelineResult {
  status: 'published-draft' | 'rejected';
  /** rejected 時，標示在哪個階段被擋（'select' | 'evidence' | 'anchor'）。 */
  stage?: string;
  /** rejected 時的原因（取自被擋階段的 reason / note）。 */
  rejectReason?: string;
  /** published-draft 時的草稿（已過 articlesSchema）。 */
  draft?: DraftArticle;
  /** 採用的選題。 */
  selection?: Selection;
  /** 各步驟實際使用的模型（目前僅 write）。 */
  model?: { write: string };
  /** 是否為 STUB 模式（無 ANTHROPIC_API_KEY）。 */
  stub: boolean;
}

export interface RunPipelineOpts {
  /** 生成時間（ISO 字串）。注入以利測試確定性；預設生成當下。 */
  now?: string;
  /** 來源 store 名稱覆寫（測試用）。預設 'sources'。 */
  storeName?: string;
  /** 設 true 可跳過 fetch（假設 store 已備妥）。預設 false。 */
  skipFetch?: boolean;
  /** select 最多嘗試幾次直到取得 accepted。預設 3。 */
  maxSelectAttempts?: number;
  /**
   * 設 true 時，採用的選題會寫入去重記錄（recordSelection），
   * 讓後續 run 不重複同一題。預設 false——
   * STUB 的選題固定，預設不記錄以維持整合測試的確定性。
   */
  dedupe?: boolean;
}

/**
 * 執行整條管線（fetch → select → evidence → anchor → write）。
 *
 * 回傳：
 *   - 成功：{ status:'published-draft', draft, selection, model:{write}, stub }
 *   - 任一閘門未過：{ status:'rejected', stage, rejectReason, stub }
 */
export async function runPipeline(opts?: RunPipelineOpts): Promise<PipelineResult> {
  const now = opts?.now;
  const storeName = opts?.storeName ?? 'sources';
  const skipFetch = opts?.skipFetch ?? false;
  const maxSelectAttempts = opts?.maxSelectAttempts ?? 3;
  const dedupe = opts?.dedupe ?? false;

  log.info('pipeline started', { now, storeName, skipFetch, maxSelectAttempts, dedupe });

  // ── Stage 0：fetch（除非 skipFetch）──
  if (!skipFetch) {
    log.info('stage fetch');
    await runFetch({ now, storeName });
  } else {
    log.info('stage fetch skipped');
  }

  // ── Stage 1：select（最多嘗試 maxSelectAttempts 次直到 accepted）──
  log.info('stage select');
  let accepted:
    | { selection: Selection; rejectReason?: undefined }
    | undefined;
  let lastRejectReason: string | undefined;
  // dedupe 由 opt 控制：STUB 選題固定，預設關閉去重以維持確定性。
  // 去重記錄的 store 名稱沿用來源 storeName 後綴，避免測試污染正式去重記錄。
  const selectStoreName = storeName === 'sources' ? undefined : `${storeName}-processed`;
  for (let attempt = 1; attempt <= maxSelectAttempts; attempt++) {
    const result = await selectTopic({
      sourceStoreName: storeName,
      storeName: selectStoreName,
      dedupe,
    });
    if (result.accepted) {
      accepted = { selection: result.selection };
      log.info('select accepted', { attempt, title: result.selection.title });
      break;
    }
    lastRejectReason = result.rejectReason;
    log.warn('select attempt rejected', { attempt, reason: result.rejectReason });
  }

  if (accepted === undefined) {
    log.warn('pipeline rejected at select', { rejectReason: lastRejectReason });
    return {
      status: 'rejected',
      stage: 'select',
      rejectReason: lastRejectReason,
      stub: isLlmStubMode(),
    };
  }

  const selection = accepted.selection;

  // 去重記錄：只有在 dedupe 開啟時才記，避免測試重複跑時被自己擋下。
  if (dedupe) {
    recordSelection(selection, { storeName: selectStoreName, now });
  }

  // ── Stage 2：evidence（在 anchor「之前」，因為 anchor 消費 cultureEvidence）──
  log.info('stage evidence');
  const { evidence, cultureEvidence } = await gatherEvidence(selection, { storeName });
  if (evidence.status === 'insufficient') {
    log.warn('pipeline rejected at evidence', { rejectReason: evidence.note });
    return {
      status: 'rejected',
      stage: 'evidence',
      rejectReason: evidence.note,
      selection,
      stub: isLlmStubMode(),
    };
  }

  // ── Stage 3：anchor（消費 evidence 的 cultureEvidence）──
  log.info('stage anchor');
  const anchor = computeAnchor({ candidates: cultureEvidence });
  if (anchor.status === 'insufficient') {
    log.warn('pipeline rejected at anchor', { rejectReason: anchor.note });
    return {
      status: 'rejected',
      stage: 'anchor',
      rejectReason: anchor.note,
      selection,
      stub: isLlmStubMode(),
    };
  }

  // ── Stage 4：write（前面已逐關放行；writeArticle 內部仍會再 guard 一次）──
  log.info('stage write');
  const { draft, model, stub } = await writeArticle({ selection, anchor, evidence, now });

  log.info('pipeline done: published-draft', {
    title: draft.frontmatter.title,
    writeModel: model,
    stub,
  });

  return {
    status: 'published-draft',
    draft,
    selection,
    model: { write: model },
    stub,
  };
}
