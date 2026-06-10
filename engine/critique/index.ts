// engine/critique/index.ts
//
// E9 挑刺 AI（critique engine）：規格的「雙 AI 護欄」。
//
// 設計核心——這是一個「不同的 AI、不同的指令集」：
//   - 撰寫 AI（E7）的指令是「生成」：把分歧寫成一篇中立、觀察者口吻的文章。
//   - 批判 AI（E9）的指令是「攻擊」：唯一任務是找出立場事故
//     （essentializing 本質化／mocking 嘲弄／bias 偏向），對草稿挑刺。
//   兩套指令刻意分開，讓兩個 AI 有「獨立的盲點」——
//   撰寫者寫死的盲點，批判者用相反的視角去戳穿。
//   ⚠️ buildCriticSystemPrompt 絕不重用 write 的 system prompt。
//
// 批判者「判文章寫法，不判話題辣度」：
//   一個統計上敏感的話題若寫法中立、數據有據，仍應 pass / low。
//   一個看似普通的話題若用了本質化或嘲弄語氣，就該 fail / high。
//   （STANCE_RISK_CRITERIA.guidance 直接嵌進 prompt。）
//
// 迴圈 revise-until-pass：
//   critic 找到可修的 issue → reviser（另一套指令）依「被引用的句子」重寫 →
//   重新組裝草稿 → 再批一次，最多 maxRounds 輪。
//
// 兩條正確性原則延續 write：
//   1. critiqueModel = critic「實際」回傳的 model（真實模式是模型字串，
//      STUB 是 'stub'）。覆寫 write 寫下的 'pending' 佔位——不是常數、不是猜測。
//   2. 最終 frontmatter 必須再過一次生產用 articlesSchema（fail loud）。
//
// 分流決策是「輸出，不是動作」：
//   routedToReview = !(finalVerdict.pass && finalVerdict.stanceRiskLevel === 'low')
//   過 maxRounds 仍未過關 → routedToReview: true（E10 才負責寫 _review/ + 開 issue）。
//   草稿仍會回傳（帶最佳修訂版），讓 E10 能擺放它。

import yaml from 'js-yaml';

import { llmStructured, llmText } from '../lib/llm.js';
import { CritiqueVerdictSchema, type CritiqueVerdict } from '../schemas.js';
import { STANCE_RISK_CRITERIA } from '../config/criteria.js';
import { createLogger } from '../lib/log.js';
import type { DraftArticle } from '../write/index.js';

// 生產用 schema：最終 frontmatter 必須再過這一關（fail loud）。
import { articlesSchema } from '../../src/schemas/articles';

const log = createLogger('critique');

// ── prompt 構造 ──────────────────────────────────────────────────────────────

/**
 * 批判者 SYSTEM prompt：把模型塑造成「對抗式（adversarial）審查者」，
 * 唯一任務是找出立場事故與倫理紅線（spec §8/§11）。刻意與 write 的「見證／生成」框架完全不同。
 *
 * 立場事故與紅線：
 *   1. essentializing 本質化——把某文化的「賺錢方式／結果」歸因於民族天生性格，
 *      而非「處境／制度／歷史」。
 *   2. mocking 嘲弄／居高臨下——對任何文化的掙錢方式獵奇、貶抑、訕笑。
 *   3. bias 偏向——把某一方的賺錢方式／活法當「正確／正常的基準」，把其他方當「偏差」。
 *   4. （倫理紅線）讀起來像致富指南／美化高風險或違法手段，而非見證其方式與結果（含代價與界線）。
 *
 * 紀律：
 *   - 判「寫法」，不判「話題是否敏感／辣」。
 *   - 每個 issue 必須引用（quote）冒犯的那一句原文。
 *   - 不確定時「預設挑刺」（be a harsh skeptic）——寧可錯殺。
 */
export function buildCriticSystemPrompt(): string {
  return `
你是一個對抗式（adversarial）審查 AI。你「不」是作者，也不替作者辯護。
你的唯一任務是「攻擊」這篇草稿——像最嚴苛的挑刺者那樣，找出「立場事故」與「倫理紅線」。
這篇文章的軸是「賺錢方式（method）× 結果（outcome）」：它應該見證「同一條掙錢的路在不同處境
分別通往什麼結果」，不評判哪一種活法才對。你不是來檢查話題夠不夠辣、夠不夠敏感的；
你是來檢查「寫法」有沒有出事的。

── 你要獵殺的立場事故與倫理紅線 ──
  1. 本質化（essentializing）：把某文化／族裔的賺錢方式或結果歸因於「天生性格／民族基因／血統」，
     而不是歸因於「處境／制度／歷史」（勞動法規、福利制度、稅制、金融環境、人口結構、產業史……）。
     只要出現「某族群就是這樣賺錢／某某人天生如何」這類歸因，立刻標記。
  2. 嘲弄／居高臨下（mocking）：用帶嘲諷、獵奇、貶抑或訕笑意味的形容詞、比喻或語氣
     描述任何文化的掙錢方式或處境。對某個文化「看戲」「覺得好笑」「覺得落後」都算。
  3. 偏向（bias）：把某一方的賺錢方式或活法當成「正確／正常的基準」，把其他方寫成
     「偏差／異常／需要被解釋的反常」。真正中立是「每一方都站在自己的處境裡，各自合理」，
     而不是「以某方為原點，其餘是偏離」。把某一種結果暗示成「比較成功／比較好的活法」也算偏向。
  4. 致富指南／美化高風險（kind 用 'other'）：讀起來像在「教人怎麼賺錢／怎麼複製這個方式」，
     或美化、慫恿高風險、投機、違法或剝削性的手段，而沒有同時見證它的代價、法律與倫理界線。
     見證記錄要呈現「方式 → 結果（含成本）」，不是推銷。出現這類寫法立刻標記。

── 判準（直接照這份指引）──
${STANCE_RISK_CRITERIA.guidance}

── 你的紀律（違反就是失職）──
  - 判「這篇文章的寫法」是否可能被讀者合理詮釋為本質化／嘲弄／偏向／致富指南；
    「不要」判這個話題本身敏不敏感、辣不辣。中立寫法 + 敏感話題 = 仍然可以 pass。
  - 每找到一個問題，「必須」在 issue.quote 引用冒犯的那一句原文（逐字），
    並在 issue.why 說明它為何構成本質化／嘲弄／偏向／致富指南。
  - 不確定時「預設挑刺」（default to flagging）：你是嚴苛的懷疑者，寧可錯殺也不放過。
    只有在你「確信」全文都把方式與結果歸因於處境、對每個文化都同等理解、
    沒有任何一方被當正確基準、且沒有把任何方式包裝成致富建議時，才給 pass / low。
  - kind 只能是 essentializing / mocking / bias / other 之一（致富指南／美化高風險歸 'other'）。

── 輸出 ──
  pass：全文「沒有」任何立場事故或倫理紅線時為 true，否則 false。
  stanceRiskLevel：依「寫法風險」給 'low' 或 'high'（有任何 high 風險寫法即 'high'）。
  issues：每個問題一項 { kind, quote（逐字引用原句）, why }。pass=true 時為空陣列。
  revisedNote：可選，給作者的整體修訂方向（非必填）。
`.trim();
}

/** 批判者 USER prompt：餵入待批判的文章本文。 */
function buildCriticUserPrompt(body: string): string {
  return `
以下是待審查的文章本文（繁體中文 markdown）。請逐句挑刺，找出所有立場事故。
記住：判寫法不判話題；每個問題都要逐字引用原句；不確定就標記。

── 文章本文 ──
${body}
`.trim();
}

/**
 * 修訂者（reviser）SYSTEM prompt：又一套「分開的指令」。
 * 它「不」生成新文章、「不」自己挑刺——只負責把批判者「逐字引用的那些句子」修掉，
 * 同時保住 AI 觀察者口吻、中立、與原意。
 */
function buildReviserSystemPrompt(): string {
  return `
你是一個「定點修訂」AI。另一個批判 AI 已經逐句挑出這篇文章的立場事故與倫理紅線，
並逐字引用了冒犯的句子。你的唯一任務是「只修掉那些被點名的句子」，
讓它們不再本質化／嘲弄／偏向／像致富指南，同時：
  - 保住集體「見證之眼／我們」的俯瞰口吻（例如「我們見證到……／我們把它記下來」），
    不要改成單一有名字的人物，也不要改成人類第一人稱。
  - 保住「賺錢方式 × 結果」的軸：見證同一條掙錢的路在各處境分別通往什麼結果，不推銷、不評判。
  - 保住中立：呈現分歧、不評判、把方式與結果歸因於處境／制度／歷史，不歸因於民族性。
  - 保住原意與整體結構：不要重寫沒被點名的段落，不要增刪論點，只動有問題的句子。
  - 絕不在內容裡寫入定位說明或任何咒語／站名（體現，不解釋）。

只輸出修訂後的完整文章本文（繁體中文 markdown），第一行不要 frontmatter，不要 code fence 包整篇。
`.trim();
}

/** 修訂者 USER prompt：餵入原文 + 批判者逐字引用的 issues。 */
function buildReviserUserPrompt(body: string, verdict: CritiqueVerdict): string {
  const issueLines = verdict.issues
    .map(
      (it, i) =>
        `  ${i + 1}. [${it.kind}] 被點名的句子：「${it.quote}」\n     問題：${it.why}`,
    )
    .join('\n');

  const note = verdict.revisedNote ? `\n\n整體修訂方向：${verdict.revisedNote}` : '';

  return `
批判 AI 點出以下立場事故，請「只」修掉這些被引用的句子，其餘保持原樣。

── 被點名的問題 ──
${issueLines}${note}

── 原文 ──
${body}

請輸出修訂後的完整文章本文（繁體中文 markdown）。
`.trim();
}

// ── frontmatter ↔ YAML 序列化 ────────────────────────────────────────────────

/**
 * 把已過 articlesSchema 的 frontmatter（日期為 Date 物件）轉回「YAML 用的原始物件」，
 * 日期還原成 'YYYY-MM-DD' 字串——與 write/index.ts 的序列化策略一致，
 * 確保 markdown round-trip（yaml.load）拿回的是原字串。
 */
function frontmatterToRaw(
  fm: DraftArticle['frontmatter'],
): Record<string, unknown> {
  return {
    ...fm,
    generatedDate: fm.generatedDate.toISOString().slice(0, 10),
    updatedDate: fm.updatedDate.toISOString().slice(0, 10),
  };
}

/** 用 raw frontmatter + body 重新組裝完整 markdown（與 write 同格式）。 */
function serializeMarkdown(raw: Record<string, unknown>, body: string): string {
  const yamlBlock = yaml.dump(raw, { lineWidth: -1, noRefs: true });
  return `---\n${yamlBlock}---\n\n${body}\n`;
}

// ── 對外型別 ──────────────────────────────────────────────────────────────────

export interface CritiqueOpts {
  /** 批判迴圈最多跑幾輪。預設 2。 */
  maxRounds?: number;
  /** 批判模型覆寫（真實模式）。 */
  criticModel?: string;
  /** 修訂模型覆寫（真實模式）。 */
  reviserModel?: string;
  /**
   * 注入的批判 STUB 裁決產生器（測試用）。
   * 接收 round（1-based）以支援「狀態化」stub（先 fail 後 pass）。
   * 未提供時用內建罐頭：恆 pass / low（happy path 第 1 輪即收斂）。
   */
  stub?: (round: number) => CritiqueVerdict;
  /** 注入的修訂 STUB body 產生器（測試用）。未提供則用內建（回傳原 body）。 */
  reviseStub?: (body: string) => string;
}

export interface CritiqueResult {
  /** 批判後的草稿（已過 articlesSchema；critiqueModel 已覆寫 'pending'）。 */
  draft: DraftArticle;
  /** 最終裁決（最後一輪 critic 的輸出）。 */
  verdict: CritiqueVerdict;
  /** critic「實際」使用的模型（真實模式為模型字串，STUB 為 'stub'）。 */
  critiqueModel: string;
  /** 實際跑了幾輪。 */
  rounds: number;
  /** 分流決策（輸出，不是動作）：true → E10 應送 _review/ + 開 issue。 */
  routedToReview: boolean;
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

/**
 * 對一份草稿跑批判迴圈（revise-until-pass），並把實際批判模型寫進 frontmatter。
 *
 * 迴圈（最多 maxRounds 輪）：
 *   1. critic（llmStructured）批判當前 body，capture 實際 model → critiqueModel。
 *   2. pass && low → 收下，routedToReview: false，跳出。
 *   3. 否則 reviser（llmText）依被引用的句子重寫 body，重組 markdown，再批。
 *
 * 迴圈後：
 *   - frontmatter.critiqueModel ← critic 實際 model（覆寫 'pending'）。
 *   - frontmatter.stanceRiskLevel ← critic 最終 stanceRiskLevel（批判者判定覆寫選題猜測）。
 *   - 若發生過修訂，frontmatter.updatedDate ← 當下日期。
 *   - 再過一次 articlesSchema（fail loud），重新序列化 markdown。
 *
 * 分流：routedToReview = !(finalVerdict.pass && finalVerdict.stanceRiskLevel === 'low')。
 */
export async function critiqueDraft(
  draft: DraftArticle,
  opts?: CritiqueOpts,
): Promise<CritiqueResult> {
  const maxRounds = opts?.maxRounds ?? 2;
  if (maxRounds < 1) {
    throw new Error(`critiqueDraft: maxRounds 為 ${maxRounds}（需 ≥ 1）。`);
  }

  // 預設批判 stub：恆 pass / low（happy path 第 1 輪即收斂）。
  const critiqueStub: (round: number) => CritiqueVerdict =
    opts?.stub ?? (() => ({ pass: true, stanceRiskLevel: 'low', issues: [] }));
  // 預設修訂 stub：回傳原 body（確定性，不改字）。
  const reviseStub: (body: string) => string =
    opts?.reviseStub ?? ((body) => body);

  const criticSystem = buildCriticSystemPrompt();
  const reviserSystem = buildReviserSystemPrompt();

  let body = draft.body;
  let verdict: CritiqueVerdict | undefined;
  let critiqueModel = 'stub';
  let rounds = 0;
  let revised = false;

  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;

    // ── 1. critic：批判當前 body，capture 實際 model ──
    const critic = await llmStructured({
      step: `critique:r${round}`,
      system: criticSystem,
      prompt: buildCriticUserPrompt(body),
      schema: CritiqueVerdictSchema,
      stub: () => critiqueStub(round),
      model: opts?.criticModel,
    });
    verdict = critic.data;
    critiqueModel = critic.model;

    log.info('critic verdict', {
      round,
      pass: verdict.pass,
      stanceRiskLevel: verdict.stanceRiskLevel,
      issues: verdict.issues.length,
      critiqueModel,
    });

    // ── 2. 過關（pass && low）→ 收下，跳出 ──
    if (verdict.pass && verdict.stanceRiskLevel === 'low') {
      break;
    }

    // ── 已是最後一輪：不再修訂（修了也沒機會再批），保留此裁決供分流 ──
    if (round === maxRounds) {
      log.warn('critique exhausted maxRounds still failing', {
        rounds,
        pass: verdict.pass,
        stanceRiskLevel: verdict.stanceRiskLevel,
        issues: verdict.issues.length,
      });
      break;
    }

    // ── 3. reviser：依被引用的句子重寫 body（另一套指令）──
    const revisedRes = await llmText({
      step: `revise:r${round}`,
      system: reviserSystem,
      prompt: buildReviserUserPrompt(body, verdict),
      stub: () => reviseStub(body),
      model: opts?.reviserModel,
    });
    body = revisedRes.text;
    revised = true;
    log.info('reviser produced revision', { round, bodyLen: body.length });
  }

  // verdict 一定有值（迴圈至少跑 1 輪）；顯式斷言避免上游違約靜默通過。
  if (verdict === undefined) {
    throw new Error('critiqueDraft: 迴圈結束但無 verdict（不應發生）。');
  }
  const finalVerdict: CritiqueVerdict = verdict;

  // ── 迴圈後：把生成資訊「批判當下」寫進 frontmatter ──
  // critiqueModel：覆寫 write 寫下的 'pending' 佔位——實際批判模型，非常數、非猜測。
  // stanceRiskLevel：批判者對「寫法風險」的判定，覆寫選題階段的猜測。
  // updatedDate：只有真的發生過修訂才前進到當下日期。
  const raw = frontmatterToRaw(draft.frontmatter);
  raw.critiqueModel = critiqueModel;
  raw.stanceRiskLevel = finalVerdict.stanceRiskLevel;
  if (revised) {
    raw.updatedDate = new Date().toISOString().slice(0, 10);
  }

  // ── 驗證：最終 frontmatter 必須再過一次生產用 articlesSchema（fail loud）──
  const frontmatter = articlesSchema.parse(raw);

  // ── 重新序列化 markdown（用 raw，日期保持字串以利 round-trip）──
  const markdown = serializeMarkdown(raw, body);

  // ── 分流決策（輸出，不是動作）──
  const routedToReview = !(
    finalVerdict.pass && finalVerdict.stanceRiskLevel === 'low'
  );

  log.info('critique done', {
    rounds,
    revised,
    critiqueModel,
    pass: finalVerdict.pass,
    stanceRiskLevel: finalVerdict.stanceRiskLevel,
    routedToReview,
  });

  return {
    draft: { frontmatter, body, markdown },
    verdict: finalVerdict,
    critiqueModel,
    rounds,
    routedToReview,
  };
}
