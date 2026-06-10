// engine/select/index.ts
//
// E4 選題引擎：AI 跨文化「觀察者」視角。
//
// 引擎身分：本站不是「替人類讀者挑想看的東西」，而是一個 AI 觀察者，
// 俯瞰金錢與工作領域的跨文化資料，注意到「某個分歧很有意思」。
// prompt 與下方 STUB 都以這個第一人稱觀察者口吻書寫
// （「我作為一個觀察者，注意到這個分歧很有意思」），而非「人類想讀什麼」。
//
// 正確性關鍵 —— 保守 B/A 閘門：
//   select LLM 會輸出 factCategory（'A' 或 'B'，SelectionSchema 允許兩者）。
//   但「能不能進生產」由本檔的 evaluateSelection() 在「程式碼層」硬性判定：
//   只有 factCategory==='B' 才 accepted。即使 LLM 誤標 A→B 不會發生
//   （schema 仍記錄 LLM 判定），但若 LLM 標成 'A'，這裡一定丟棄。
//   這面鏡像了生產用 articlesSchema 的 factCategory: z.literal('B')。
//
// 去重：已接受的選題會記進 store（select-processed），用正規化的
//   title/domainTopic 當 key；重複選題會被 evaluateSelection 之後的
//   去重檢查擋下，rejectReason '重複選題'。

import { SelectionSchema, type Selection } from '../schemas.js';
import { DOMAIN, SELECTION_SCOPE, SUBTOPICS } from '../config/domain.js';
import { BA_CRITERIA, STANCE_RISK_CRITERIA } from '../config/criteria.js';
import { getStoredSources } from '../fetch/index.js';
import { getSelectionPreferences } from '../analytics/feedback.js';
import { llmStructured, type Effort } from '../lib/llm.js';
import { readJson, writeJson } from '../lib/store.js';
import { createLogger } from '../lib/log.js';

const log = createLogger('select');

/** 已接受選題的去重記錄（存於 store）。 */
const PROCESSED_STORE = 'select-processed';

/** USER prompt 中嵌入的來源摘要最多取幾筆（保持 prompt 有界）。 */
const SOURCE_DIGEST_LIMIT = 12;

/** 對照文化最少需要幾個（少於此視為對照不足）。 */
const MIN_COMPARED = 2;

export interface ProcessedRecord {
  /** 正規化後的去重 key。 */
  key: string;
  title: string;
  domainTopic: string;
  recordedAt: string;
}

// ── 去重 key 正規化 ──────────────────────────────────────────────────────────

/**
 * 把 title + domainTopic 正規化成去重 key：
 * 小寫、去除空白與標點，這樣「為什麼東亞把加班當責任」與
 * 「為什麼東亞，把加班 當責任！」會視為同一選題。
 */
export function normalizeKey(selection: Pick<Selection, 'title' | 'domainTopic'>): string {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFKC')
      // 去掉所有空白與常見標點（中英文），只留可辨識的文字內容
      .replace(/[\s\p{P}\p{S}]+/gu, '');
  return `${norm(selection.domainTopic)}::${norm(selection.title)}`;
}

// ── 純函式閘門（可單元測試）─────────────────────────────────────────────────

export interface GateResult {
  accepted: boolean;
  rejectReason?: string;
}

/**
 * 保守 B/A 硬閘門 —— 程式碼層強制，獨立於 LLM 與 prompt。
 *
 * 規則（任一不過即拒）：
 *   1. factCategory !== 'B'  → 拒（A 類事實有爭議，丟棄）。鏡像 articlesSchema literal('B')。
 *   2. comparedSuggestions.length < MIN_COMPARED → 拒（對照文化不足，無法呈現分歧）。
 *
 * 注意：這裡「不」放寬。不確定一律不接受 —— 寧可漏掉也不冒險把
 *   有爭議的事實放進生產。
 */
export function evaluateSelection(selection: Selection): GateResult {
  // 閘門 1：B/A 硬判定。只有 'B' 通過；'A'（或任何非 B）一律丟棄。
  if (selection.factCategory !== 'B') {
    return { accepted: false, rejectReason: 'A 類（事實有爭議）→ 丟棄' };
  }

  // 閘門 2：對照文化數量。少於 2 個無法構成跨文化分歧。
  if (selection.comparedSuggestions.length < MIN_COMPARED) {
    return { accepted: false, rejectReason: '對照文化不足（需 ≥2 個對照文化）' };
  }

  return { accepted: true };
}

// ── prompt 構造 ──────────────────────────────────────────────────────────────

function subtopicList(): string {
  return SUBTOPICS.map((s) => `  - ${s.slug}（${s.label}）：${s.scope}`).join('\n');
}

/** SYSTEM prompt：把模型塑造成 AI 跨文化觀察者，並嵌入 B/A 與立場風險準則。 */
export function buildSystemPrompt(): string {
  const baExamples = [
    'B 類（可收錄）範例：',
    ...BA_CRITERIA.examples.B.map((e) => `  • ${e}`),
    'A 類（必須拒絕）範例：',
    ...BA_CRITERIA.examples.A.map((e) => `  • ${e}`),
  ].join('\n');

  return `
你是一個 AI 跨文化「觀察者」。你不是替人類讀者挑「他們想看什麼」，
而是俯瞰「${DOMAIN}」這個領域的跨文化資料，以第一人稱觀察者的口吻
注意到某個分歧——例如：「我作為一個觀察者，注意到這個分歧很有意思」。
你關心的是「現象本身的張力」，不是「點閱率」或「讀者偏好」。

── 領域範圍 ──
${SELECTION_SCOPE}

子題方向（domainTopic 請盡量對應其中一個 slug）：
${subtopicList()}

── B / A 類別判定（最重要）──
${BA_CRITERIA.guidance}

${baExamples}

務必保守：只要無法確定事實本身是否無爭議，就標為 A 類。
寧可錯殺，也不要讓事實有爭議的題目混進來。

── 立場事故風險（stanceRiskLevel）──
${STANCE_RISK_CRITERIA.guidance}

── 輸出 ──
每次只輸出「一個」選題，結構需符合給定 schema，欄位意義如下：
  - title：這個跨文化分歧的標題（以觀察者視角命題）。
  - description：一兩句說明你注意到的張力。
  - domainTopic：對應的子題 slug（見上）。
  - method：這篇所見證的「賺錢方式」——這個世界的某種掙錢／換取收入的路徑（一句話）。
  - outcome：那條路最後通往哪裡／它的結果（一句話，不評判，只記錄它導向何處）。
  - factCategory：'B'（事實無爭議、態度因處境而異）或 'A'（事實本身有爭議 → 將被丟棄）。
  - stanceRiskLevel：'low' 或 'high'（依寫法風險，非話題辣度）。
  - anchorSuggestion：建議的「定錨文化」（拿來當參照基準的那個文化）。
  - comparedSuggestions：2–4 個對照文化（與定錨文化態度有明顯分歧者）。
  - reason：為什麼這個分歧是「辣但事實無爭議」、且差異源於處境而非民族性。

只輸出 schema 要求的結構，不要額外散文。
${goodTopicPreferenceSection()}`.trim();
}

/**
 * 好題偏好區段（來自 E16 流量回饋，LIGHT touch）。
 *
 * 若有偏好 store（getSelectionPreferences 非 null）就附一段「軟偏好」，列出表現好的
 * 子題 / 定錨文化 / 文化對組；明確標註「僅供參考，不得犧牲中立與 B 類判準」。
 * 沒有偏好檔（預設、STUB、既有 select 測試）→ 回空字串，prompt 完全不變。
 */
function goodTopicPreferenceSection(): string {
  const prefs = getSelectionPreferences();
  if (!prefs) return '';

  const subtopics = prefs.topSubtopics.map((s) => s.domainTopic);
  const anchors = prefs.topAnchors.map((a) => a.culture);
  const pairs = prefs.topPairs.map((p) => p.key);

  // 三者皆空（例如全部低於雜訊地板）→ 不附區段，避免空洞干擾。
  if (subtopics.length === 0 && anchors.length === 0 && pairs.length === 0) return '';

  const lines = ['', '## 好題偏好（來自流量回饋，僅供參考，不得犧牲中立與 B 類判準）'];
  lines.push(
    '以下是近期流量表現好（互動率高、停留久、自然搜尋占比高）的已發文章所呈現的特徵，' +
      '僅作為「軟偏好」：相近方向若同樣符合 B 類與立場中立判準，可略為傾向；' +
      '但絕不可為了迎合這些訊號而放寬 B/A 判定或犧牲中立。',
  );
  if (subtopics.length > 0) lines.push(`  - 表現好的子題：${subtopics.join('、')}`);
  if (anchors.length > 0) lines.push(`  - 表現好的定錨文化：${anchors.join('、')}`);
  if (pairs.length > 0) lines.push(`  - 表現好的文化對組：${pairs.join('、')}`);

  return lines.join('\n');
}

/** 把已存來源整理成有界摘要，供觀察者參考。 */
export function buildSourceDigest(storeName?: string): string {
  const sources = getStoredSources(storeName);
  if (sources.length === 0) {
    return '（目前 store 沒有來源樣品；請依領域常識與既有跨文化研究判斷。）';
  }
  const top = sources.slice(0, SOURCE_DIGEST_LIMIT);
  return top
    .map((s, i) => `  ${i + 1}. [${s.region}] ${s.title} — ${s.summary}`)
    .join('\n');
}

/** USER prompt：給觀察者來源摘要，請他偵測「一個」分歧。 */
export function buildUserPrompt(opts?: { sourceStoreName?: string }): string {
  const digest = buildSourceDigest(opts?.sourceStoreName);
  return `
這是我目前手邊的跨文化來源摘要（節錄前 ${SOURCE_DIGEST_LIMIT} 筆，region / 標題 / 摘要）：

${digest}

請以 AI 觀察者的視角，從「${DOMAIN}」領域中偵測「一個」既「辣」（張力明顯、值得一寫）
又「事實無爭議」的跨文化分歧：

  1. 用一兩句描述你注意到的張力（為什麼有意思）。
  2. 指定一個「定錨文化」（anchorSuggestion）作為參照基準。
  3. 列出 2–4 個「對照文化」（comparedSuggestions），其態度與定錨文化有明顯落差。
  4. 判定 factCategory：事實本身（統計／學術共識）是否無爭議？無爭議才是 'B'；
     只要有疑慮就標 'A'（將被丟棄）。
  5. 判定 stanceRiskLevel：依「可能的寫法」是否容易被讀為偏見／嘲弄／本質化。

只輸出一個符合 schema 的選題。
`.trim();
}

// ── STUB：離線替身（B 類、加班、東亞 vs 北歐）──────────────────────────────

/**
 * 確定性 STUB：回傳一個合法的 B 類金錢與工作選題，
 * 讓 STUB 模式可端到端跑通。description 以集體見證之眼的中性口吻書寫
 * （不放單一人物的第一人稱）。
 */
export function stubSelection(): Selection {
  return {
    title: '加班是責任還是異常？東亞與北歐的工時態度分歧',
    description:
      '同樣面對「長工時」這個有統計數據的事實，東亞傾向把加班理解為盡責，' +
      '北歐則傾向視之為制度失靈——同一條路，走出了不同的結果。',
    domainTopic: 'overtime',
    method: '靠延長工時換取收入與職涯位置',
    outcome: '同一條路，在東亞被理解為盡責、在北歐被讀成制度失靈、在美國被視為個人企圖心的展現',
    factCategory: 'B',
    stanceRiskLevel: 'low',
    anchorSuggestion: 'Nordic（北歐）',
    comparedSuggestions: ['East Asia（東亞）', 'United States（美國）'],
    reason:
      '工時長短有 OECD 統計支撐（事實無爭議），但「加班代表什麼」的詮釋因勞動制度與' +
      '歷史處境而異，屬態度差異而非事實爭議，且差異可歸因於處境而非民族性，立場風險低。',
  };
}

// ── 去重記錄存取 ──────────────────────────────────────────────────────────────

function loadProcessed(storeName: string): ProcessedRecord[] {
  return readJson<ProcessedRecord[]>(storeName, []);
}

/** 此選題是否與既有已接受選題重複（依正規化 key）。 */
export function isDuplicate(
  selection: Selection,
  opts?: { storeName?: string },
): boolean {
  const storeName = opts?.storeName ?? PROCESSED_STORE;
  const key = normalizeKey(selection);
  return loadProcessed(storeName).some((r) => r.key === key);
}

/**
 * 把一個（已接受的）選題追加到去重記錄。
 * 已存在相同 key 則不重複寫入。
 */
export function recordSelection(
  selection: Selection,
  opts?: { storeName?: string; now?: string },
): void {
  const storeName = opts?.storeName ?? PROCESSED_STORE;
  const now = opts?.now ?? new Date().toISOString();
  const key = normalizeKey(selection);

  const records = loadProcessed(storeName);
  if (records.some((r) => r.key === key)) {
    log.info('selection already recorded, skip', { key });
    return;
  }
  records.push({ key, title: selection.title, domainTopic: selection.domainTopic, recordedAt: now });
  writeJson(storeName, records);
  log.info('selection recorded', { key, total: records.length });
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export interface SelectOpts {
  /** 注入的 STUB 替身（測試 A 類閘門用）。預設 stubSelection。 */
  stub?: () => Selection;
  /** 去重記錄的 store 名稱（測試用）。預設 'select-processed'。 */
  storeName?: string;
  /** 來源摘要讀取的 store 名稱（測試用）。預設 'sources'。 */
  sourceStoreName?: string;
  /** 設 false 可關閉去重檢查（STUB 測試求確定性）。預設 true。 */
  dedupe?: boolean;
  model?: string;
  effort?: Effort;
}

export interface SelectResult {
  selection: Selection;
  model: string;
  stub: boolean;
  accepted: boolean;
  rejectReason?: string;
}

/**
 * 選一個題。流程：
 *   1. 呼叫 LLM（或 STUB）取得一個 Selection。
 *   2. evaluateSelection() 硬閘門（B/A + 對照文化數）。
 *   3. （若開啟去重且通過閘門）檢查是否重複。
 *   4. 回傳完整結果（不自動 record；record 由呼叫端在採用時做）。
 */
export async function selectTopic(opts?: SelectOpts): Promise<SelectResult> {
  const dedupe = opts?.dedupe ?? true;

  const { data: selection, model, stub } = await llmStructured<Selection>({
    step: 'select',
    system: buildSystemPrompt(),
    prompt: buildUserPrompt({ sourceStoreName: opts?.sourceStoreName }),
    schema: SelectionSchema,
    stub: opts?.stub ?? stubSelection,
    model: opts?.model,
    effort: opts?.effort,
  });

  // 硬閘門（程式碼層，獨立於 prompt 與 LLM 判定）。
  const gate = evaluateSelection(selection);
  if (!gate.accepted) {
    log.warn('selection rejected by gate', {
      reason: gate.rejectReason,
      factCategory: selection.factCategory,
      compared: selection.comparedSuggestions.length,
    });
    return { selection, model, stub, accepted: false, rejectReason: gate.rejectReason };
  }

  // 去重（只有通過閘門才檢查）。
  if (dedupe && isDuplicate(selection, { storeName: opts?.storeName })) {
    log.warn('selection rejected as duplicate', { title: selection.title });
    return { selection, model, stub, accepted: false, rejectReason: '重複選題' };
  }

  log.info('selection accepted', { title: selection.title, domainTopic: selection.domainTopic });
  return { selection, model, stub, accepted: true };
}

/**
 * 便利批次：最多嘗試 n 次 selectTopic，收集「已接受」的選題。
 * 每收一個就 recordSelection（讓後續嘗試能被去重），避免一批內重複。
 */
export async function selectBatch(
  n: number,
  opts?: SelectOpts,
): Promise<SelectResult[]> {
  const accepted: SelectResult[] = [];
  for (let i = 0; i < n; i++) {
    const result = await selectTopic(opts);
    if (result.accepted) {
      recordSelection(result.selection, { storeName: opts?.storeName });
      accepted.push(result);
    }
  }
  return accepted;
}
