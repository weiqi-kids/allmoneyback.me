// engine/anchor/index.ts
//
// E5 定錨演算法：純函式，正確性關鍵。
//
// 核心規則：錨點由「資料可得性」決定，不由人工挑選。
//   - 資料最穩定、一手、可信的文化成為錨點。
//   - 資料黑箱的文化只能是「存疑對照」，永遠不能是錨點。
//   - 若無文化具備穩定一手可信的資料，主題被拒為「資料不足」。

import { AnchorResultSchema, type AnchorResult } from '../schemas.js';

// ── 公開介面 ──────────────────────────────────────────────────────────────────

export interface SourceEvidence {
  /** 資料可信度。 */
  credibility: 'high' | 'medium' | 'low';
  /** 資料取得方式：real = 真實資料；stub = 樣本佔位（貢獻減半）。 */
  access: 'real' | 'stub';
  /** 是否為一手資料（統計局／原始問卷調查等）。一手資料額外加分。 */
  firstHand?: boolean;
}

export interface CultureEvidence {
  culture: string;
  sources: SourceEvidence[];
}

export interface AnchorInput {
  candidates: CultureEvidence[];
}

// ── 評分常數（皆有說明）───────────────────────────────────────────────────────

/**
 * 可信度分數基礎值。
 * high=3：最高信任（統計/學術共識）。
 * medium=2：次可信（可信新聞/政府報告但非直接數據）。
 * low=1 ：最低信任（二手/觀點/輕度可信）。
 */
const CREDIBILITY_WEIGHT: Record<SourceEvidence['credibility'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * 取得方式乘數。
 * real=1.0：真實資料，全值計算。
 * stub=0.5：樣本佔位，只是佔位符，資料可靠性減半。
 *            stub 不算「穩定一手資料」，即使 credibility=high 也不能單靠 stub 成為錨點。
 */
const ACCESS_MULTIPLIER: Record<SourceEvidence['access'], number> = {
  real: 1.0,
  stub: 0.5,
};

/**
 * 一手資料加分（+1/來源）。
 * firstHand=true 表示該來源直接出自統計機構/原始問卷，比二手引用更可信。
 */
const FIRST_HAND_BONUS = 1;

// ── 評分函式（匯出供測試）────────────────────────────────────────────────────

export interface CultureScore {
  /** 加總資料強度分數（credibility × access + firstHand bonus）。 */
  dataStrength: number;
  /**
   * 是否具備穩定來源：至少一筆 credibility==='high' AND access==='real'。
   * 這是「穩定、一手、可信」的最低門檻，anchor 資格的必要條件。
   */
  hasStableSource: boolean;
  /**
   * 是否為資料黑箱：有來源，但全部都是 low credibility 或 stub-only。
   * 正式定義：沒有任何來源同時滿足 (credibility==='high' OR 'medium') AND access==='real'。
   * 黑箱文化只能進 suspectCultures，永不能成為 anchor 或正式 compared。
   */
  isBlackbox: boolean;
  /** 一手來源計數（tie-break 用）。 */
  firstHandCount: number;
}

/**
 * 對單一文化計算資料強度與資格標記。
 * 純函式，確定性，可獨立單元測試。
 */
export function scoreCulture(c: CultureEvidence): CultureScore {
  let dataStrength = 0;
  let firstHandCount = 0;
  let hasStableSource = false;
  let hasNonBlackboxSource = false;

  for (const src of c.sources) {
    // 基礎分：可信度 × 取得方式乘數
    const base = CREDIBILITY_WEIGHT[src.credibility] * ACCESS_MULTIPLIER[src.access];
    // 一手資料加分
    const bonus = src.firstHand === true ? FIRST_HAND_BONUS : 0;
    dataStrength += base + bonus;

    if (src.firstHand === true) {
      firstHandCount += 1;
    }

    // 穩定來源判定：high + real（最高品質組合）
    if (src.credibility === 'high' && src.access === 'real') {
      hasStableSource = true;
    }

    // 非黑箱判定：至少一筆 (high | medium) + real
    if ((src.credibility === 'high' || src.credibility === 'medium') && src.access === 'real') {
      hasNonBlackboxSource = true;
    }
  }

  // 黑箱：有來源但無任何 (high|medium)+real 組合
  const isBlackbox = c.sources.length > 0 && !hasNonBlackboxSource;

  return { dataStrength, hasStableSource, isBlackbox, firstHandCount };
}

// ── 主函式 ────────────────────────────────────────────────────────────────────

export interface AnchorOpts {
  /**
   * 錨點資格門檻（dataStrength 下限）。
   * 預設 3。必須同時具備 hasStableSource=true 才算 anchor 候選。
   */
  anchorThreshold?: number;
  /**
   * 對照文化門檻（dataStrength 下限）。
   * 預設 1.5。低於此視為資料不足，進 suspectCultures。
   */
  comparedThreshold?: number;
  /**
   * 最多保留幾個對照文化。
   * 預設 4。超出按 dataStrength 降冪截斷。
   */
  maxCompared?: number;
}

/**
 * 計算錨點（定錨演算法核心）。
 *
 * 輸出符合 AnchorResultSchema，解析失敗時立即拋錯（fail loud）。
 *
 * 規則：
 *   1. 計算每個文化的 CultureScore。
 *   2. Anchor 候選：hasStableSource===true AND dataStrength >= anchorThreshold。
 *      若無候選 → status:'insufficient'（資料不足：無任何文化具備穩定、一手、可信的錨點資料）。
 *   3. 選最高 dataStrength 者為 anchor；同分時優先 firstHandCount 高者，再按 culture 名字升冪。
 *   4. 其餘文化中，非黑箱且 dataStrength >= comparedThreshold → comparedCultures（降冪，最多 maxCompared）。
 *      需至少 2 個對照文化（下游文章 schema 要求 comparedCultures.length >= 2）。
 *      若未達 2 → status:'insufficient'（資料不足：可信對照文化不足 2 個）。
 *   5. 黑箱候選（以及非錨點、低於 comparedThreshold 的文化）→ suspectCultures。
 */
export function computeAnchor(input: AnchorInput, opts?: AnchorOpts): AnchorResult {
  const anchorThreshold = opts?.anchorThreshold ?? 3;
  const comparedThreshold = opts?.comparedThreshold ?? 1.5;
  const maxCompared = opts?.maxCompared ?? 4;

  // Step 1：評分所有候選文化
  const scored = input.candidates.map((c) => ({
    culture: c.culture,
    ...scoreCulture(c),
  }));

  // Step 2：篩選 anchor 候選（hasStableSource + 達門檻）
  const anchorCandidates = scored.filter(
    (s) => s.hasStableSource && s.dataStrength >= anchorThreshold,
  );

  if (anchorCandidates.length === 0) {
    const result = AnchorResultSchema.parse({
      status: 'insufficient',
      note: '資料不足：無任何文化具備穩定、一手、可信的錨點資料',
    });
    return result;
  }

  // Step 3：選最佳 anchor（確定性 tie-break）
  //   主要：dataStrength 降冪
  //   次要：firstHandCount 降冪（一手資料越多越好）
  //   三次：culture 名字升冪（純確定性保障，不影響語義）
  const anchor = anchorCandidates.sort((a, b) => {
    if (b.dataStrength !== a.dataStrength) return b.dataStrength - a.dataStrength;
    if (b.firstHandCount !== a.firstHandCount) return b.firstHandCount - a.firstHandCount;
    return a.culture.localeCompare(b.culture);
  })[0];

  // Step 4：其餘文化分類
  const rest = scored.filter((s) => s.culture !== anchor.culture);

  // 對照文化：非黑箱且達門檻，降冪排序後截斷
  const comparedCultures = rest
    .filter((s) => !s.isBlackbox && s.dataStrength >= comparedThreshold)
    .sort((a, b) => {
      if (b.dataStrength !== a.dataStrength) return b.dataStrength - a.dataStrength;
      return a.culture.localeCompare(b.culture);
    })
    .slice(0, maxCompared)
    .map((s) => s.culture);

  // Step 4b：對照不足 → insufficient
  if (comparedCultures.length < 2) {
    const result = AnchorResultSchema.parse({
      status: 'insufficient',
      note: '資料不足：可信對照文化不足 2 個',
    });
    return result;
  }

  // Step 5：存疑對照（黑箱 OR 低於對照門檻的非錨點文化）
  const comparedSet = new Set(comparedCultures);
  const suspectCultures = rest
    .filter((s) => !comparedSet.has(s.culture))
    .map((s) => s.culture)
    .sort(); // 確定性排序

  // 組裝結果並透過 schema 驗證（parse 失敗則拋錯，fail loud）
  const raw: AnchorResult = {
    status: 'ok',
    anchorCulture: anchor.culture,
    comparedCultures,
    ...(suspectCultures.length > 0 ? { suspectCultures } : {}),
  };

  return AnchorResultSchema.parse(raw);
}
