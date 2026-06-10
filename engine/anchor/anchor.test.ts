// engine/anchor/anchor.test.ts
//
// 定錨演算法窮舉測試。
//
// 核心測試案例：
//   1. 清晰錨點：一個文化 high+real(+firstHand)，兩個 medium+real → anchor 是強的那個，status ok。
//   2. 黑箱永不成為錨點：黑箱文化有大量 low/stub 來源（raw count 最多），
//      但因 hasStableSource=false 被排除成為錨點，只落入 suspectCultures。
//   3. 資料不足（無穩定錨點）：所有文化都是黑箱 → insufficient。
//   4. 資料不足（對照不足）：錨點 ok 但只有 1 個其他可信文化 → insufficient。
//   5. suspectCultures 正確填充；錨點不出現在 compared 或 suspect。
//   6. scoreCulture 單元測試：high+real=3, low+stub=0.5, firstHand bonus。
//   7. 確定性：相同輸入 → 相同輸出；tie-break 穩定。

import { describe, it, expect } from 'vitest';
import { computeAnchor, scoreCulture } from './index.js';
import type { CultureEvidence, AnchorInput } from './index.js';

// ── 測試工具 ──────────────────────────────────────────────────────────────────

/** 建立一個只有一筆 high+real 來源的文化（錨點最小合法候選）。 */
function makeStableCandidate(culture: string, extra?: Partial<CultureEvidence>): CultureEvidence {
  return {
    culture,
    sources: [{ credibility: 'high', access: 'real' }],
    ...extra,
  };
}

/** 建立只有 medium+real 來源的文化（可對照，非錨點 if 其他更強）。 */
function makeMediumCandidate(culture: string): CultureEvidence {
  return {
    culture,
    sources: [{ credibility: 'medium', access: 'real' }],
  };
}

/** 建立全為 low+stub 的黑箱文化（資料黑箱，永不錨點）。 */
function makeBlackboxCandidate(culture: string, sourceCount = 1): CultureEvidence {
  return {
    culture,
    sources: Array.from({ length: sourceCount }, () => ({
      credibility: 'low' as const,
      access: 'stub' as const,
    })),
  };
}

// ── scoreCulture 單元測試 ─────────────────────────────────────────────────────

describe('scoreCulture — 評分常數', () => {
  it('high + real = 3（無 firstHand）', () => {
    const score = scoreCulture({ culture: 'X', sources: [{ credibility: 'high', access: 'real' }] });
    expect(score.dataStrength).toBe(3); // 3 * 1.0
    expect(score.hasStableSource).toBe(true);
    expect(score.isBlackbox).toBe(false);
    expect(score.firstHandCount).toBe(0);
  });

  it('high + real + firstHand = 4（3 基礎 + 1 一手加分）', () => {
    const score = scoreCulture({
      culture: 'X',
      sources: [{ credibility: 'high', access: 'real', firstHand: true }],
    });
    expect(score.dataStrength).toBe(4); // 3 * 1.0 + 1
    expect(score.firstHandCount).toBe(1);
  });

  it('medium + real = 2', () => {
    const score = scoreCulture({ culture: 'X', sources: [{ credibility: 'medium', access: 'real' }] });
    expect(score.dataStrength).toBe(2); // 2 * 1.0
    expect(score.hasStableSource).toBe(false); // medium 不滿足 stable（需 high）
    expect(score.isBlackbox).toBe(false); // medium+real 非黑箱
  });

  it('low + stub = 0.5', () => {
    const score = scoreCulture({ culture: 'X', sources: [{ credibility: 'low', access: 'stub' }] });
    expect(score.dataStrength).toBe(0.5); // 1 * 0.5
    expect(score.hasStableSource).toBe(false);
    expect(score.isBlackbox).toBe(true); // 只有 low+stub → 黑箱
  });

  it('low + real = 1（非黑箱，因 access=real；但非 stable）', () => {
    const score = scoreCulture({ culture: 'X', sources: [{ credibility: 'low', access: 'real' }] });
    expect(score.dataStrength).toBe(1);
    expect(score.hasStableSource).toBe(false);
    // low+real 不滿足非黑箱條件（需 high|medium + real），所以是黑箱
    expect(score.isBlackbox).toBe(true);
  });

  it('high + stub = 1.5（stub 減半；非黑箱但 hasStableSource=false）', () => {
    // high+stub：雖然 credibility=high，但 access=stub，不算 stable（stable 需 high+real）
    // 非黑箱：需 (high|medium)+real；high+stub 中 access=stub，所以是黑箱
    const score = scoreCulture({ culture: 'X', sources: [{ credibility: 'high', access: 'stub' }] });
    expect(score.dataStrength).toBe(1.5); // 3 * 0.5
    expect(score.hasStableSource).toBe(false); // stub 不算 stable
    expect(score.isBlackbox).toBe(true); // 沒有任何 (high|medium)+real
  });

  it('多筆來源累加：high+real + medium+real = 5', () => {
    const score = scoreCulture({
      culture: 'X',
      sources: [
        { credibility: 'high', access: 'real' },
        { credibility: 'medium', access: 'real' },
      ],
    });
    expect(score.dataStrength).toBe(5); // 3 + 2
    expect(score.hasStableSource).toBe(true);
    expect(score.isBlackbox).toBe(false);
  });

  it('firstHand=false 不計入加分', () => {
    const score = scoreCulture({
      culture: 'X',
      sources: [{ credibility: 'high', access: 'real', firstHand: false }],
    });
    expect(score.dataStrength).toBe(3); // 3 * 1.0，無加分
    expect(score.firstHandCount).toBe(0);
  });

  it('多筆 firstHand：兩筆一手 → firstHandCount=2，bonus=+2', () => {
    const score = scoreCulture({
      culture: 'X',
      sources: [
        { credibility: 'high', access: 'real', firstHand: true },
        { credibility: 'medium', access: 'real', firstHand: true },
      ],
    });
    expect(score.dataStrength).toBe(7); // (3+1) + (2+1)
    expect(score.firstHandCount).toBe(2);
  });
});

// ── computeAnchor：清晰錨點 ─────────────────────────────────────────────────

describe('computeAnchor — 清晰錨點', () => {
  it('一個 high+real(+firstHand)，兩個 medium+real → anchor 是強的那個，status ok', () => {
    const input: AnchorInput = {
      candidates: [
        {
          culture: 'Nordic',
          sources: [{ credibility: 'high', access: 'real', firstHand: true }],
        },
        makeMediumCandidate('EastAsia'),
        makeMediumCandidate('US'),
      ],
    };
    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.anchorCulture).toBe('Nordic');
    expect(result.comparedCultures).toContain('EastAsia');
    expect(result.comparedCultures).toContain('US');
    expect(result.comparedCultures).toHaveLength(2);
    // anchor 不出現在 compared
    expect(result.comparedCultures).not.toContain('Nordic');
  });

  it('最強的文化被選為 anchor，而非來源數最多的文化', () => {
    const input: AnchorInput = {
      candidates: [
        // 三筆 medium+real：dataStrength=6，但 hasStableSource=false
        {
          culture: 'ManyMedium',
          sources: [
            { credibility: 'medium', access: 'real' },
            { credibility: 'medium', access: 'real' },
            { credibility: 'medium', access: 'real' },
          ],
        },
        // 一筆 high+real：dataStrength=3，hasStableSource=true → 才有 anchor 資格
        makeStableCandidate('OneHigh'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };
    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    // ManyMedium 雖然 dataStrength 更高，但 hasStableSource=false，無 anchor 資格
    expect(result.anchorCulture).toBe('OneHigh');
    expect(result.comparedCultures).not.toContain('OneHigh');
  });
});

// ── 關鍵測試：黑箱永不成為錨點 ──────────────────────────────────────────────

describe('computeAnchor — 黑箱永不成為錨點（關鍵測試）', () => {
  it('黑箱文化有大量 low+stub 來源（raw count 最多），不被選為 anchor，落入 suspectCultures', () => {
    // BlackboxKing：10 筆 low+stub，dataStrength = 10 * 0.5 = 5
    // 看起來「資料最多」，但全是黑箱來源
    const blackboxKing: CultureEvidence = {
      culture: 'BlackboxKing',
      sources: Array.from({ length: 10 }, () => ({
        credibility: 'low' as const,
        access: 'stub' as const,
      })),
    };

    // RealAnchor：一筆 high+real，dataStrength = 3（比 BlackboxKing 低！）
    const realAnchor: CultureEvidence = makeStableCandidate('RealAnchor');

    const input: AnchorInput = {
      candidates: [
        blackboxKing,
        realAnchor,
        makeMediumCandidate('Compared1'),
        makeMediumCandidate('Compared2'),
      ],
    };

    const result = computeAnchor(input);

    // 核心斷言：BlackboxKing 雖 dataStrength=5 > RealAnchor=3，但不能成為 anchor
    expect(result.status).toBe('ok');
    expect(result.anchorCulture).toBe('RealAnchor');
    expect(result.anchorCulture).not.toBe('BlackboxKing');

    // BlackboxKing 必須落入 suspectCultures
    expect(result.suspectCultures).toBeDefined();
    expect(result.suspectCultures).toContain('BlackboxKing');

    // BlackboxKing 絕不出現在 comparedCultures
    expect(result.comparedCultures).not.toContain('BlackboxKing');
  });

  it('黑箱文化有 high+stub（可信度高但 stub 存取）→ 不能成為 anchor，進 suspectCultures', () => {
    // HighCredStub：high+stub，dataStrength=1.5，hasStableSource=false，isBlackbox=true
    const highCredStub: CultureEvidence = {
      culture: 'HighCredStub',
      sources: [{ credibility: 'high', access: 'stub' }],
    };

    const input: AnchorInput = {
      candidates: [
        highCredStub,
        makeStableCandidate('ProperAnchor'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.anchorCulture).toBe('ProperAnchor');
    expect(result.suspectCultures).toContain('HighCredStub');
    expect(result.comparedCultures).not.toContain('HighCredStub');
  });

  it('純黑箱混合：有多筆 low+stub 和 high+stub，都進 suspectCultures', () => {
    const input: AnchorInput = {
      candidates: [
        { culture: 'Blackbox1', sources: [{ credibility: 'low', access: 'stub' }] },
        { culture: 'Blackbox2', sources: [{ credibility: 'high', access: 'stub' }, { credibility: 'low', access: 'stub' }] },
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.anchorCulture).toBe('Anchor');
    expect(result.suspectCultures).toContain('Blackbox1');
    expect(result.suspectCultures).toContain('Blackbox2');
  });
});

// ── 資料不足：無穩定錨點 ─────────────────────────────────────────────────────

describe('computeAnchor — 資料不足：無穩定錨點', () => {
  it('所有文化都是黑箱 → status insufficient，note 提到資料不足', () => {
    const input: AnchorInput = {
      candidates: [
        makeBlackboxCandidate('A', 3),
        makeBlackboxCandidate('B', 5),
        makeBlackboxCandidate('C', 2),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('insufficient');
    expect(result.note).toContain('資料不足');
    expect(result.anchorCulture).toBeUndefined();
    expect(result.comparedCultures).toBeUndefined();
  });

  it('所有文化 medium 或 low（無任何 high+real）→ insufficient', () => {
    const input: AnchorInput = {
      candidates: [
        makeMediumCandidate('A'),
        makeMediumCandidate('B'),
        { culture: 'C', sources: [{ credibility: 'low', access: 'real' }] },
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('insufficient');
    expect(result.note).toContain('資料不足');
  });

  it('只有一個 high+real 但達門檻，然而其他都是黑箱（沒有任何 compared）→ insufficient', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeBlackboxCandidate('Blackbox1'),
        makeBlackboxCandidate('Blackbox2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('insufficient');
    expect(result.note).toContain('資料不足');
    expect(result.note).toContain('對照');
  });
});

// ── 資料不足：對照文化不足 ───────────────────────────────────────────────────

describe('computeAnchor — 資料不足：對照文化不足 2 個', () => {
  it('錨點 ok 但只有 1 個其他可信文化 → insufficient', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('OnlyOne'), // 只有一個對照
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('insufficient');
    expect(result.note).toContain('資料不足');
    expect(result.note).toContain('對照');
  });

  it('錨點 ok，一個 medium+real 對照，一個黑箱 → 只有 1 個合格對照 → insufficient', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'),
        makeBlackboxCandidate('Blackbox1'), // 黑箱不算合格對照
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('insufficient');
    expect(result.note).toContain('對照');
  });

  it('錨點 ok，2 個 medium+real → ok（剛好 2 個）', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.comparedCultures).toHaveLength(2);
  });

  it('dataStrength 低於 comparedThreshold 的文化不算對照 → 可能導致 insufficient', () => {
    // 預設 comparedThreshold=1.5；low+real = 1（低於 1.5）
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        { culture: 'TooWeak1', sources: [{ credibility: 'low', access: 'real' }] }, // 1.0 < 1.5
        { culture: 'TooWeak2', sources: [{ credibility: 'low', access: 'real' }] },
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('insufficient');
  });
});

// ── suspectCultures 填充正確性 ──────────────────────────────────────────────

describe('computeAnchor — suspectCultures 填充', () => {
  it('黑箱文化進入 suspectCultures；非黑箱低資料文化也進入 suspectCultures', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('GoodCompare1'),
        makeMediumCandidate('GoodCompare2'),
        makeBlackboxCandidate('BlackboxSuspect'), // 黑箱
        { culture: 'WeakSuspect', sources: [{ credibility: 'low', access: 'real' }] }, // 1.0 < 1.5，非黑箱但資料不足
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.suspectCultures).toBeDefined();
    expect(result.suspectCultures).toContain('BlackboxSuspect');
    expect(result.suspectCultures).toContain('WeakSuspect');
    // anchor 不在 suspect
    expect(result.suspectCultures).not.toContain('Anchor');
    // compared 不在 suspect
    expect(result.suspectCultures).not.toContain('GoodCompare1');
    expect(result.suspectCultures).not.toContain('GoodCompare2');
  });

  it('無存疑文化時 suspectCultures 不存在或為空', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    // suspectCultures 應該不存在（或空）
    expect(result.suspectCultures == null || result.suspectCultures.length === 0).toBe(true);
  });
});

// ── maxCompared 截斷 ─────────────────────────────────────────────────────────

describe('computeAnchor — maxCompared 截斷', () => {
  it('預設 maxCompared=4：5 個可信對照只保留前 4 個（dataStrength 降冪）', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        // 5 個不同 dataStrength 的 medium+real（dataStrength=2 各）
        // 加上 extra sources 讓它們 dataStrength 不同
        {
          culture: 'C5',
          sources: [
            { credibility: 'medium', access: 'real' },
            { credibility: 'medium', access: 'real' },
          ],
        }, // 4
        {
          culture: 'C4',
          sources: [
            { credibility: 'medium', access: 'real' },
            { credibility: 'low', access: 'real' },
          ],
        }, // 3
        makeMediumCandidate('C3'), // 2
        {
          culture: 'C2',
          sources: [{ credibility: 'medium', access: 'real', firstHand: true }],
        }, // 3
        {
          culture: 'C1',
          sources: [
            { credibility: 'medium', access: 'real' },
            { credibility: 'medium', access: 'real' },
            { credibility: 'medium', access: 'real' },
          ],
        }, // 6
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.comparedCultures!.length).toBeLessThanOrEqual(4);
  });

  it('自訂 maxCompared=2：只保留前 2 個對照', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('C1'),
        makeMediumCandidate('C2'),
        makeMediumCandidate('C3'),
      ],
    };

    const result = computeAnchor(input, { maxCompared: 2 });

    expect(result.status).toBe('ok');
    expect(result.comparedCultures).toHaveLength(2);
  });
});

// ── 確定性與 tie-break ──────────────────────────────────────────────────────

describe('computeAnchor — 確定性與 tie-break', () => {
  it('相同輸入多次呼叫 → 相同輸出', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
        makeBlackboxCandidate('Suspect'),
      ],
    };

    const results = Array.from({ length: 5 }, () => computeAnchor(input));
    const first = JSON.stringify(results[0]);
    for (const r of results.slice(1)) {
      expect(JSON.stringify(r)).toBe(first);
    }
  });

  it('兩個 anchor 候選同分：firstHandCount 高者優先', () => {
    const input: AnchorInput = {
      candidates: [
        {
          culture: 'AnchorWithFirstHand',
          sources: [{ credibility: 'high', access: 'real', firstHand: true }],
        }, // dataStrength=4, firstHandCount=1
        {
          culture: 'AnchorNoFirstHand',
          sources: [
            { credibility: 'high', access: 'real' },
            { credibility: 'low', access: 'stub' },
          ],
        }, // dataStrength=3.5, firstHandCount=0 — 分數稍低，AnchorWithFirstHand 仍勝
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.anchorCulture).toBe('AnchorWithFirstHand');
  });

  it('dataStrength 和 firstHandCount 完全同分：culture 名字升冪（字典序小者優先）', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('ZZZ'), // 字典序最後
        makeStableCandidate('AAA'), // 字典序最前 → 應該被選
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.anchorCulture).toBe('AAA');
  });
});

// ── 自訂門檻 ─────────────────────────────────────────────────────────────────

describe('computeAnchor — 自訂門檻', () => {
  it('提高 anchorThreshold=5：low dataStrength 的 high+real 不夠 → insufficient', () => {
    // makeStableCandidate 只有一筆 high+real = 3，低於 threshold=5
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'), // dataStrength=3，低於 anchorThreshold=5
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
      ],
    };

    const result = computeAnchor(input, { anchorThreshold: 5 });

    expect(result.status).toBe('insufficient');
    expect(result.note).toContain('錨點');
  });

  it('降低 comparedThreshold=0.4：原本太弱的 low+stub 也成為對照（0.5 > 0.4）', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        // low+stub = 0.5，低於預設 1.5，但高於自訂 0.4
        { culture: 'WeakCompare1', sources: [{ credibility: 'low', access: 'real' }] }, // 1.0 > 0.4，但需非黑箱
        { culture: 'WeakCompare2', sources: [{ credibility: 'medium', access: 'stub' }] }, // 1.0 > 0.4，medium+stub 非黑箱
      ],
    };

    // WeakCompare1 (low+real=1.0) 是黑箱嗎？
    // isBlackbox: 需 (high|medium)+real → low+real 沒有 → 黑箱
    // WeakCompare2 (medium+stub): isBlackbox: 需 (high|medium)+real → medium+stub，access=stub → 黑箱
    // 所以即使降低 comparedThreshold，黑箱仍不算對照
    const result = computeAnchor(input, { comparedThreshold: 0.4 });

    // 兩個 WeakCompare 都是黑箱，comparedThreshold 降低也無法讓它們成為對照
    expect(result.status).toBe('insufficient');
  });

  it('comparedThreshold 降低：medium+real(2) 在高門檻(3)下不算對照，在低門檻(1)下可以', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'), // dataStrength=2
        makeMediumCandidate('Compare2'), // dataStrength=2
      ],
    };

    // 高門檻：medium = 2 < threshold 3 → insufficient
    const resultHigh = computeAnchor(input, { comparedThreshold: 3 });
    expect(resultHigh.status).toBe('insufficient');

    // 低門檻：medium = 2 > threshold 1 → ok
    const resultLow = computeAnchor(input, { comparedThreshold: 1 });
    expect(resultLow.status).toBe('ok');
    expect(resultLow.comparedCultures).toHaveLength(2);
  });
});

// ── 邊界案例 ─────────────────────────────────────────────────────────────────

describe('computeAnchor — 邊界案例', () => {
  it('空候選列表 → insufficient', () => {
    const result = computeAnchor({ candidates: [] });
    expect(result.status).toBe('insufficient');
  });

  it('只有一個文化 → insufficient（即使是完美文化，對照不足）', () => {
    const result = computeAnchor({
      candidates: [makeStableCandidate('Alone')],
    });
    expect(result.status).toBe('insufficient');
  });

  it('anchor 永不出現在 comparedCultures 或 suspectCultures', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
        makeBlackboxCandidate('Suspect1'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    expect(result.comparedCultures).not.toContain(result.anchorCulture);
    if (result.suspectCultures) {
      expect(result.suspectCultures).not.toContain(result.anchorCulture);
    }
  });

  it('每個文化在結果中只出現一次（互斥）', () => {
    const input: AnchorInput = {
      candidates: [
        makeStableCandidate('Anchor'),
        makeMediumCandidate('Compare1'),
        makeMediumCandidate('Compare2'),
        makeBlackboxCandidate('Suspect1'),
        makeBlackboxCandidate('Suspect2'),
      ],
    };

    const result = computeAnchor(input);

    expect(result.status).toBe('ok');
    const allCultures = [
      result.anchorCulture!,
      ...(result.comparedCultures ?? []),
      ...(result.suspectCultures ?? []),
    ];
    const unique = new Set(allCultures);
    expect(unique.size).toBe(allCultures.length);
  });
});
