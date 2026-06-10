// 域範圍設定：金錢與工作。
//
// SUBTOPICS 的 slug 與 src/utils/article-categories.ts 的 ArticleCategorySlug
// 保持一致（5 個正典 slug：overtime / debt / retirement / consumption / value）。
// 可新增額外子題，但 5 個正典必須存在。

/** 領域識別名稱，用於 LLM prompt 及日誌。 */
export const DOMAIN = '金錢與工作';

export interface Subtopic {
  /** 對應 ArticleCategorySlug（正典 5 個）或自訂延伸 slug。 */
  slug: string;
  /** 顯示標籤（中文）。 */
  label: string;
  /**
   * 給 LLM 用的範圍說明：這個子題「包含什麼」，
   * 供 select 步驟聚焦時使用。
   */
  scope: string;
}

/**
 * 金錢與工作的子題清單。
 * 正典 5 slug：overtime / debt / retirement / consumption / value。
 * 另加 2 個延伸子題（entrepreneurship / identity）供未來文章選題。
 */
export const SUBTOPICS: Subtopic[] = [
  {
    slug: 'overtime',
    label: '加班與工時',
    scope:
      '工時長短、加班文化、過勞現象、工作生活平衡，以及不同處境下對責任制的態度差異。',
  },
  {
    slug: 'debt',
    label: '債務與負債',
    scope:
      '借貸態度、房貸壓力、信用卡文化、負債羞恥感，以及對「好債／壞債」的文化詮釋差異。',
  },
  {
    slug: 'retirement',
    label: '退休想像',
    scope:
      '退休年齡期待、養老安排、年金信任度、對晚年生活的規劃與世代責任感的跨文化分歧。',
  },
  {
    slug: 'consumption',
    label: '消費與儲蓄',
    scope:
      '消費觀念、儲蓄率、節儉美德、面子消費、超前消費與節制文化的張力。',
  },
  {
    slug: 'value',
    label: '金錢與身分／工作與自我價值',
    scope:
      '金錢與成功、地位、家庭幸福的價值排序；工作作為自我認同或純粹謀生工具的觀念落差。',
  },
  // --- 延伸子題（非正典 slug，供選題輔助） ---
  {
    slug: 'entrepreneurship',
    label: '創業與失敗',
    scope:
      '創業精神的文化差異、對商業失敗的汙名程度，以及家族期望對創業決策的影響。',
  },
  {
    slug: 'identity',
    label: '工作身分認同',
    scope:
      '以職業定義個人價值的程度差異、失業或轉職的文化衝擊，以及「夠不夠努力」的道德化程度。',
  },
];

/**
 * 選題 LLM prompt 中用來描述「什麼算 in-scope」的散文字串。
 * 明確列出正典子題，並說明 B 類條件（事實無爭議、態度因處境而異）。
 */
export const SELECTION_SCOPE: string = `
本站聚焦領域：${DOMAIN}。

收錄範圍（in-scope）：
- 事實本身沒有爭議（有統計數據或學術共識支撐），但「對此現象的態度或做法」因文化背景、
  處境（收入、世代、國情）不同而出現明顯分歧的主題。
- 子題方向：加班與工時、債務與借貸態度、退休想像與養老安排、消費與儲蓄習慣、
  金錢與自我價值認同、創業失敗文化、工作身分認同。
- 比較角度需有數據或研究支撐（調查、統計、學術論文），不得僅靠坊間傳聞。

不收錄（out-of-scope，視為 A 類拒絕）：
- 事實本身存在爭議（例如：某政策是否有效、某數據是否可信）。
- 主題本質是衝突性的政治議題、科學否認，或帶有明顯勝負立場的論戰。
- 無跨文化比較維度：只是某一文化的現象陳述，缺乏對照。
`.trim();
