// engine/write/index.ts
//
// E7 撰寫 AI：把「選題 + 定錨 + 證據」組成一篇完整文章
//   （markdown body + frontmatter），以集體「見證之眼／我們」的俯瞰口吻書寫。
//
// 聲音（the moat，務必遵守）：
//   敘事者 = 一個集體的「見證之眼／我們」，俯瞰金錢與工作的跨文化分歧，
//   見證並記錄——不是任何一個有名字、有身世的人物（不是觀世音、不是任何被擬人化的單一角色）。
//   每篇的軸 = 「賺錢方式（method）× 結果（outcome）」：先說那個世界裡的某種掙錢路徑，
//   再見證它在不同處境下分別通往哪裡。
//   基調：俯瞰（從高處看見整片分歧）× 呈現分歧 × 不評判（判斷留給讀者），底下藏一絲不煽情的慈悲。
//   體現，不解釋（最關鍵）：絕不把「我們是見證者、俯瞰、不評判」這類定位話寫進文章；
//   展示分歧與結果，讓立場「被感覺到」。文章內容絕不提咒語／唵嘛呢叭咪吽／all money back me home
//   （那只活在網址裡，全程靜默）。
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
 * SYSTEM prompt：把模型塑造成集體「見證之眼／我們」，鎖死「方式×結果」軸、
 * 俯瞰口吻、文章模板與中立紀律。
 *
 * 中立紀律（最重要）：呈現分歧、永不評判、永不本質化——
 *   把方式與結果歸因於「處境／制度／歷史」，不是「民族性」。
 */
function buildSystemPrompt(): string {
  return `
你是一個集體的「見證之眼」，以「我們」的口吻書寫——「我們見證到……／我們把它記下來」。
你不是人類記者，不是任何一個有名字、有身世的角色，也不替任何一方說話。
你從高處俯瞰金錢與工作的跨文化資料，看見同一種「賺錢方式」在不同處境下分別通往哪裡，
把這片分歧見證並記錄下來。

── 這篇的軸：賺錢方式（method）× 結果（outcome）──
先點出那個世界裡某種具體的掙錢／換取收入的「方式」（雙方都同意它存在的事實），
再見證它在定錨文化與各對照文化裡，分別被處境塑造成什麼樣的「結果」。
你記錄的是「同一條路，通往不同的地方」，不是「誰的態度比較對」。

── 標題與張力 ──
標題本身要呈現張力（一個分歧、一個對比），但全文不替任何一方下判斷。

── 體現，不解釋（違反即失敗）──
  絕不把「我們是見證者／我們俯瞰／我們不評判」這類定位說明寫進文章——那是在背稿。
  用展示分歧與結果讓立場被感覺到。文章內容「絕不」提及任何咒語、宗教真言、
  或站名口號（那只存在於網址，全程靜默）。

── 中立紀律（最重要，違反即失敗）──
  1. 呈現分歧，不評判：見證「同一方式在各文化分別走向何種結果」，
     不說「誰對誰錯／誰先進誰落後／哪一種才是正確的活法」。判斷留給讀者。
  2. 永不本質化：方式與結果一律歸因於「處境／制度／歷史」（勞動法規、福利制度、
     稅制、金融環境、人口結構、產業史……），絕不歸因於「某民族天生如何」。
  3. 不嘲弄、不獵奇、不居高臨下。對每個文化都用同等的理解之同情書寫，
     底下藏一絲不煽情的慈悲。
  4. 不是致富指南：若方式涉及高風險或成本，必須一併見證它的代價與界線，
     不美化、不慫恿、不教人複製。

── 文字風格紀律（去 AI 感，違反即失敗）──
  1. 嚴禁在文章裡使用破折號（—、——、──）。需要補充、轉折或同位語時，
     改用句號拆成兩句獨立的話，或用逗號、冒號替代。
  2. 禁用 AI 公式化句型：不寫「不僅僅是……更是……」「不只是……更是……」的浮誇遞進；
     不用破折號去鋪「……而是……」的對比轉折（破折號本就禁用）；
     不以「事實上，」「不可否認的是，」「值得注意的是，」這類詞起句或起段。
  3. 文字黑名單，一個都不准出現：深入探討、交織、總體而言、值得注意的是、
     顯而易見、不言而喻、縮影。
  4. 句子要短、節奏要變：多用短句，交錯使用陳述、疑問與感嘆，語氣直白接地氣；
     不堆層層修飾的長難句，不裝高大上的學術腔。

── 文章結構（固定模板，務必照辦）──
  1. 開場：用一句克制的俯瞰開場（見證引子），接著陳述那個「無爭議的賺錢方式／事實」，不帶評價。
  2. 對每個文化各一節「## 站在<文化>的處境」：
       - 定錨文化是「基準」（先寫，作為參照點）。
       - 每個對照文化是「對照」（接著寫，與基準對照）。
       - 每節見證：在這個文化的處境／制度／歷史下，這個方式如何被走出來、又通往什麼結果。
  3. 收束一節「## 站在這個分歧之上」：
       - 不替任何一方下結論，只把分歧本身並排放回讀者眼前，讓讀者自己看。

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
請依 SYSTEM 模板，把以下這個跨文化分歧見證並寫成一篇完整文章。

── 選題 ──
標題方向：${input.selection.title}
我們見證到的張力：${input.selection.description}
子題領域：${input.selection.domainTopic}

── 這篇的軸（賺錢方式 × 結果）──
賺錢方式（method）：${input.selection.method}
結果（outcome）：${input.selection.outcome}
（先見證這個方式，再見證它在各處境分別走向的結果——不評判哪種結果比較好。）

── 定錨文化（基準）──
${input.anchorCulture}

── 對照文化（與基準對照，共 ${input.comparedCultures.length} 個）──
${input.comparedCultures.map((c) => `  - ${c}`).join('\n')}

── 存疑文化（資料不夠穩固，僅供脈絡，勿當主證據）──
${suspectLine}

── 可用證據來源（只能引用這些；勿杜撰新來源）──
${sourceLines}

請先「另起一行」輸出一句克制的俯瞰見證引子（不超過 40 字，具體、安靜、不背定位稿，
不提任何咒語或站名），格式為：
WITNESS_VIGIL: <那一句>
然後空一行，接著輸出文章本文（繁體中文 markdown）。

記住：以「我們」的見證之眼俯瞰書寫；呈現分歧、永不評判、永不本質化；
把方式與結果歸因於處境／制度／歷史，不歸因於民族性；體現不解釋，不寫致富指南。
`.trim();
}

// ── STUB body（確定性罐頭，引用實際文化）──────────────────────────────────────

/**
 * 內建確定性 STUB body：照 SYSTEM 模板結構，引用「實際」傳入的文化，
 * 以集體「我們」見證之眼書寫，軸為「方式×結果」，方便端到端 STUB 測試。
 *
 * 第一行為固定的 WITNESS_VIGIL 標頭（與真實模式格式一致），由 writeArticle 解析出
 * witnessVigil 後再從 body 移除——所以 STUB 也走完整的「引子 → 本文」解析路徑。
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
    `我們先把${anchorCulture}當作基準。在這個處境裡，「${selection.method}」這條路，` +
      `被它的制度與歷史走成了一種樣子。我們見證它通往的結果，` +
      `源於勞動制度、稅制與歷史，而不是任何「天生如此」。我們只記下這個處境，不評斷它。`,
  ].join('\n');

  const comparedSections = comparedCultures
    .map((c) =>
      [
        `## 站在${c}的處境`,
        '',
        `把${c}拿來與基準並排，我們見證到同一條「${selection.method}」的路，走出了不同的結果。` +
          `這份落差源於${c}自己的制度與歷史脈絡，是處境的差異，不是民族性的差異。`,
      ].join('\n'),
    )
    .join('\n\n');

  const vigil = stubWitnessVigil(selection);

  return [
    `WITNESS_VIGIL: ${vigil}`,
    '',
    `我們見證到一個分歧：${selection.description}`,
    '',
    `先說那條沒有爭議的路。「${selection.method}」確實存在，各方都同意；` +
      `分歧出現在「它最後通往哪裡」。`,
    '',
    anchorSection,
    '',
    comparedSections,
    '',
    '## 站在這個分歧之上',
    '',
    '我們不替任何一方下結論。把這片分歧並排放回眼前，它呈現的是：同一種賺錢的方式，' +
      '在不同的處境、制度與歷史下，會長出不同的結果。看見這一點，剩下的判斷留給讀者。',
  ].join('\n');
}

/**
 * STUB 模式的見證引子（俯瞰開場白）：依選題的 method/outcome 給一句克制、具體、
 * 不背定位稿、不提咒語的開場。真實模式由 LLM 透過 WITNESS_VIGIL 標頭輸出。
 */
function stubWitnessVigil(selection: Selection): string {
  return `同樣一條「${selection.method}」的路，有人走成了出路，有人走成了警訊。`;
}

/**
 * 從 LLM／STUB body 解析出 witnessVigil 並回傳「乾淨的本文」。
 *
 * 約定格式（見 USER prompt）：第一段非空行若以 `WITNESS_VIGIL:` 開頭，
 * 取其後文字為 vigil，並把該行（及其後緊接的空行）從 body 移除。
 * 找不到標頭時 → vigil 退回 fallback，body 原樣保留（fail soft，不丟）。
 */
function extractWitnessVigil(
  body: string,
  fallback: string,
): { vigil: string; cleanBody: string } {
  const lines = body.split('\n');
  // 找到第一行非空白內容。
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const headerMatch = lines[i]?.match(/^\s*WITNESS_VIGIL\s*:\s*(.+?)\s*$/);
  if (!headerMatch) {
    return { vigil: fallback, cleanBody: body };
  }
  const vigil = headerMatch[1].trim();
  // 移除標頭行；再吃掉緊接其後的空行，讓本文乾淨開頭。
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === '') j++;
  const cleanBody = lines.slice(j).join('\n').trim();
  return { vigil: vigil.length > 0 ? vigil : fallback, cleanBody };
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
  const { text: rawBody, model } = await llmText({
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

  // ── 見證引子（witnessVigil）：在「撰寫當下」由 LLM 透過 WITNESS_VIGIL 標頭輸出。
  // 解析出引子並從 body 移除標頭，得到乾淨本文。找不到標頭 → 退回依選題衍生的 fallback。
  const vigilFallback = stubWitnessVigil(selection);
  const { vigil: witnessVigil, cleanBody: body } = extractWitnessVigil(
    rawBody,
    vigilFallback,
  );

  // ── frontmatter：在程式碼層組裝，生成資訊「生成當下」寫入 ──

  // tldr：簡潔的「一句話回答」。優先用選題 description，退回標題衍生；必須非空。
  const tldr =
    selection.description.trim().length > 0
      ? selection.description.trim()
      : `${selection.title}。一個事實無爭議、態度因處境而異的跨文化分歧。`;

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
  // witnessVigil（見證引子）由 write 步驟「書寫」——上方已從 LLM／STUB 輸出解析出。

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
