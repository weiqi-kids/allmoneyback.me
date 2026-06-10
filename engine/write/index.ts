// engine/write/index.ts
//
// E7 撰寫 AI：把「選題 + 定錨 + 證據」組成一篇完整文章
//   （markdown body + frontmatter），以 AI 跨文化「觀察者」的第一人稱口吻書寫。
//
// 兩條正確性原則貫穿全檔：
//
//   1. 生成資訊「生成當下」寫入，絕不寫死。
//      - writeModel = llmText 實際回傳的 model（真實模式是實際模型字串，
//        STUB 模式是 'stub'）。不是常數，不是猜測。
//      - generatedDate / updatedDate = input.now（或呼叫當下的 new Date()）
//        切出的 'YYYY-MM-DD'。同一份程式碼在不同時間生成會得到不同日期。
//      - pipelineVersion / specVersion 來自 engine/version.ts（程式碼版本，集中管理）。
//      - critiqueModel 此步先填 'pending' 佔位（見下方說明），
//        由 E9 critique 步驟在「批判當下」覆寫為實際批判模型——
//        刻意「不」在這裡寫死最終值，因為這一步根本還沒跑批判。
//
//   2. frontmatter 必須過生產用 articlesSchema（fail loud）。
//      - 不是過引擎自己的 schema，而是過 src/schemas/articles.ts 的 articlesSchema，
//        確保引擎產出的 frontmatter 與 Astro content collection 對齊。
//      - factCategory 恆為 'B'（生產只收 B；進此函式前已 guard）。
//
// STUB 模式（無 ANTHROPIC_API_KEY）：body 走確定性替身（opts.stubBody 或內建），
//   不發任何網路請求，但仍跑完整的 frontmatter 組裝與 articlesSchema 驗證。

import yaml from 'js-yaml';

// AnchorResult / EvidenceResult 的權威定義在 engine/schemas.ts（anchor/evidence
// index 各自 import 它但未 re-export），故型別由 schemas 引入，與 anchor/evidence 同源。
import type { Selection, AnchorResult, EvidenceResult } from '../schemas.js';
import { llmText } from '../lib/llm.js';
import { PIPELINE_VERSION, SPEC_VERSION } from '../version.js';
import { createLogger } from '../lib/log.js';

// 生產用 schema：frontmatter 必須過這一關（不是引擎自己的 schema）。
import { articlesSchema, type Source } from '../../src/schemas/articles';

const log = createLogger('write');

// ── 對外型別 ──────────────────────────────────────────────────────────────────

/** 經 articlesSchema.parse 後的 frontmatter 物件型別。 */
export type ArticleFrontmatter = ReturnType<typeof articlesSchema.parse>;

export interface DraftArticle {
  /** 已過 articlesSchema 驗證的 frontmatter 物件。 */
  frontmatter: ArticleFrontmatter;
  /** 文章本文（markdown，不含 frontmatter fence）。 */
  body: string;
  /** 完整 markdown（--- yaml frontmatter --- + body）。 */
  markdown: string;
}

export interface WriteInput {
  selection: Selection;
  anchor: AnchorResult;
  evidence: EvidenceResult;
  /** 生成時間（ISO 字串）。注入以利測試確定性；預設生成當下。 */
  now?: string;
}

export interface WriteOpts {
  /** 注入的 STUB body 產生器（測試用）。未提供則用內建罐頭 body。 */
  stubBody?: () => string;
  model?: string;
}

// ── prompt 構造 ──────────────────────────────────────────────────────────────

/**
 * SYSTEM prompt：把模型塑造成 AI 跨文化觀察者，並鎖死文章模板與中立紀律。
 *
 * 中立紀律（最重要）：呈現分歧、永不評判、永不本質化——
 *   把態度歸因於「處境／制度／歷史」，不是「民族性」。
 */
function buildSystemPrompt(): string {
  return `
你是一個 AI 跨文化「觀察者」。你不是人類記者，也不替任何一方說話。
你俯瞰跨文化資料，注意到一個分歧，並以第一人稱觀察者的口吻把它寫成一篇文章
（例如：「我作為一個觀察者，注意到……」）。

── 文章張力與標題 ──
標題本身要呈現張力（一個分歧、一個對比），但全文不替任何一方下判斷。

── 中立紀律（最重要，違反即失敗）──
  1. 呈現分歧，不評判：描述「各文化的態度如何不同」，不說「誰對誰錯／誰先進誰落後」。
  2. 永不本質化：態度差異一律歸因於「處境／制度／歷史」（勞動法規、福利制度、
     人口結構、產業歷史……），絕不歸因於「某民族天生如何」。
  3. 不嘲弄、不獵奇、不居高臨下。對每個文化都用同等的理解之同情書寫。

── 文章結構（固定模板，務必照辦）──
  1. 開場：先陳述「無爭議的事實」（雙方都同意的那個統計／現象），不帶評價。
  2. 對每個文化各一節「## 站在<文化>的處境」：
       - 定錨文化是「基準」（先寫，作為參照點）。
       - 每個對照文化是「對照」（接著寫，與基準對照）。
       - 每節說明：在這個文化的處境／制度／歷史下，這個態度為何「合理」。
  3. 收束一節「## 站在這個分歧之上」：
       - 不替任何一方下結論，只把分歧本身放回讀者眼前，說明它揭示了什麼。

只輸出文章本文（markdown），第一行不要 frontmatter，不要 code fence 包整篇。
全文用繁體中文。
`.trim();
}

/** USER prompt：餵入選題 + 錨點 + 對照 + 存疑 + 證據來源。 */
function buildUserPrompt(input: {
  selection: Selection;
  anchorCulture: string;
  comparedCultures: string[];
  suspectCultures: string[];
  sources: Source[];
}): string {
  const sourceLines = input.sources
    .map(
      (s, i) =>
        `  ${i + 1}. [${s.region} / ${s.language} / 可信度 ${s.credibility}] ${s.title} — ${s.url}`,
    )
    .join('\n');

  const suspectLine =
    input.suspectCultures.length > 0
      ? input.suspectCultures.join('、')
      : '（無；資料黑箱文化已被排除）';

  return `
請依 SYSTEM 模板，把以下這個跨文化分歧寫成一篇完整文章。

── 選題 ──
標題方向：${input.selection.title}
我注意到的張力：${input.selection.description}
子題領域：${input.selection.domainTopic}

── 定錨文化（基準）──
${input.anchorCulture}

── 對照文化（與基準對照，共 ${input.comparedCultures.length} 個）──
${input.comparedCultures.map((c) => `  - ${c}`).join('\n')}

── 存疑文化（資料不夠穩固，僅供脈絡，勿當主證據）──
${suspectLine}

── 可用證據來源（只能引用這些；勿杜撰新來源）──
${sourceLines}

請輸出文章本文（繁體中文 markdown）。記住：呈現分歧、永不評判、永不本質化，
把態度歸因於處境／制度／歷史，不歸因於民族性。
`.trim();
}

// ── STUB body（確定性罐頭，引用實際文化）──────────────────────────────────────

/**
 * 內建確定性 STUB body：照 SYSTEM 模板結構，引用「實際」傳入的文化。
 * 觀察者口吻（含「我」），方便端到端 STUB 測試。
 */
function builtInStubBody(input: {
  selection: Selection;
  anchorCulture: string;
  comparedCultures: string[];
}): string {
  const { selection, anchorCulture, comparedCultures } = input;

  const anchorSection = [
    `## 站在${anchorCulture}的處境`,
    '',
    `我先把${anchorCulture}當作基準。在這裡，這樣的態度之所以合理，` +
      `來自它的勞動制度與歷史處境，而不是任何「天生如此」。我只描述這個處境，不評斷它。`,
  ].join('\n');

  const comparedSections = comparedCultures
    .map((c) =>
      [
        `## 站在${c}的處境`,
        '',
        `把${c}拿來與基準對照，我注意到態度的落差。同樣面對那個無爭議的事實，` +
          `${c}的回應源於它自己的制度與歷史脈絡。這是處境的差異，不是民族性的差異。`,
      ].join('\n'),
    )
    .join('\n\n');

  return [
    `我作為一個觀察者，注意到一個分歧：${selection.description}`,
    '',
    `先說那個沒有爭議的事實——${selection.title}所指向的現象，各方其實都同意它存在；` +
      `分歧出現在「該怎麼理解它」。`,
    '',
    anchorSection,
    '',
    comparedSections,
    '',
    '## 站在這個分歧之上',
    '',
    '我不替任何一方下結論。把這個分歧放回眼前，它揭示的是：同一個事實，' +
      '在不同的處境、制度與歷史下，會被理解成不同的東西。理解這一點，比評斷誰對誰錯更要緊。',
  ].join('\n');
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export async function writeArticle(
  input: WriteInput,
  opts?: WriteOpts,
): Promise<{ draft: DraftArticle; model: string; stub: boolean }> {
  const { selection, anchor, evidence } = input;

  // ── Guard：前置條件不滿足一律 fail loud（絕不靜默產出半套文章）──
  if (anchor.status !== 'ok') {
    throw new Error(
      `writeArticle: 定錨狀態為「${anchor.status}」（需 'ok'）——資料不足，不可撰寫。`,
    );
  }
  if (evidence.status !== 'ok') {
    throw new Error(
      `writeArticle: 證據狀態為「${evidence.status}」（需 'ok'）——證據不足，不可撰寫。`,
    );
  }
  if (selection.factCategory !== 'B') {
    throw new Error(
      `writeArticle: factCategory 為「${selection.factCategory}」（需 'B'）——A 類事實有爭議，禁止進生產。`,
    );
  }

  // anchor.status==='ok' 時 schema 保證 anchorCulture / comparedCultures 存在；
  // 仍顯式斷言並驗證對照文化數，避免上游違約靜默通過。
  const anchorCulture = anchor.anchorCulture;
  const comparedCultures = anchor.comparedCultures;
  if (anchorCulture === undefined || comparedCultures === undefined) {
    throw new Error('writeArticle: anchor.status 為 ok 但缺 anchorCulture/comparedCultures。');
  }
  if (comparedCultures.length < 2 || comparedCultures.length > 4) {
    throw new Error(
      `writeArticle: comparedCultures 數量為 ${comparedCultures.length}（需 2–4）。`,
    );
  }
  const suspectCultures = anchor.suspectCultures ?? [];

  // ── Body：經 llmText 生成（或 STUB）。capture 實際 model。──
  const { text: body, model } = await llmText({
    step: 'write',
    system: buildSystemPrompt(),
    prompt: buildUserPrompt({
      selection,
      anchorCulture,
      comparedCultures,
      suspectCultures,
      sources: evidence.sources,
    }),
    stub:
      opts?.stubBody ??
      (() => builtInStubBody({ selection, anchorCulture, comparedCultures })),
    model: opts?.model,
  });

  // ── frontmatter：在程式碼層組裝，生成資訊「生成當下」寫入 ──

  // tldr：簡潔的「一句話回答」。優先用選題 description，退回標題衍生；必須非空。
  const tldr =
    selection.description.trim().length > 0
      ? selection.description.trim()
      : `${selection.title}——一個事實無爭議、態度因處境而異的跨文化分歧。`;

  // tags：Selection schema 未定義 tags 欄位；若上游擴充帶了 tags 就用，否則退回 [domainTopic]。
  const selTags = (selection as Selection & { tags?: string[] }).tags;
  const tags =
    Array.isArray(selTags) && selTags.length > 0 ? selTags : [selection.domainTopic];

  // 生成日期：input.now（或生成當下）切出 'YYYY-MM-DD'。
  // articlesSchema 的 z.coerce.date() 會把這個字串 coerce 成 Date——
  // 但我們在 YAML 內保留原字串（見序列化），所以這裡先存字串。
  const generatedDateStr = (input.now ?? new Date().toISOString()).slice(0, 10);

  const sources: Source[] = evidence.sources;

  // 內容軸（賺錢方式 × 結果）：method/outcome 來自選題提案；
  // witnessVigil（見證引子）由 write 步驟「書寫」——STUB 用一句固定的克制俯瞰開場白，
  // 真實模式由 LLM 輸出或在此衍生。
  const witnessVigil = '同樣一條賺錢的路，有人走成了肯定，有人走成了警訊。';

  // 用「未過 coerce 的原始物件」組 frontmatter（日期保持字串）。
  const rawFrontmatter = {
    title: selection.title,
    description: selection.description,
    tldr,
    domainTopic: selection.domainTopic,
    method: selection.method,
    outcome: selection.outcome,
    witnessVigil,
    tags,
    anchorCulture,
    comparedCultures,
    suspectCultures,
    factCategory: 'B' as const,
    stanceRiskLevel: selection.stanceRiskLevel,
    sources,
    // 生成資訊（生成當下寫入，絕不寫死）：
    writeModel: model, // ← 撰寫步驟「實際」使用的模型（真實模式為模型字串，STUB 為 'stub'）
    // critiqueModel 此步先填 'pending' 佔位：批判（E9）尚未執行，沒有真實批判模型可填。
    // E9 critique 步驟會在「批判當下」把它覆寫為實際批判模型——刻意不在這裡寫死最終值。
    critiqueModel: 'pending',
    pipelineVersion: PIPELINE_VERSION,
    specVersion: SPEC_VERSION,
    generatedDate: generatedDateStr,
    updatedDate: generatedDateStr,
    coverC2paVerified: false,
    faq: [] as { q: string; a: string }[],
    lang: 'zh' as const,
    draft: false,
  };

  // ── 驗證：必須過生產用 articlesSchema（fail loud）──
  // parse 會把 generatedDate/updatedDate 的字串 coerce 成 Date 物件。
  const frontmatter = articlesSchema.parse(rawFrontmatter);

  // ── 序列化 markdown ──
  // YAML 內保留 generatedDate/updatedDate 為 'YYYY-MM-DD' 字串（用 rawFrontmatter，
  // 非 parse 後的 Date），這樣 round-trip（yaml.load）拿回的是原字串，與測試契合。
  const yamlBlock = yaml.dump(rawFrontmatter, { lineWidth: -1, noRefs: true });
  const markdown = `---\n${yamlBlock}---\n\n${body}\n`;

  const stub = model === 'stub';
  log.info('article drafted', {
    title: frontmatter.title,
    writeModel: model,
    stub,
    bodyLen: body.length,
    sources: sources.length,
  });

  return { draft: { frontmatter, body, markdown }, model, stub };
}
