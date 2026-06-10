// 輸入驗證 + 伺服器側內容過濾（總規格 §9.3「最小化欄位、伺服器側內容過濾」）。
//
// 純函式，無 I/O，方便單元測試。長度上限：
//   nickname ≤ 40、body ≤ 2000、methodDesc ≤ 2000、regionHint/sourceHint ≤ 200。
// slug 樣式：小寫英數與連字號（對映 src/content/articles/<slug>）。

export const LIMITS = {
  NICKNAME_MAX: 40,
  BODY_MAX: 2000,
  METHOD_DESC_MAX: 2000,
  HINT_MAX: 200,
  SLUG_MAX: 200,
} as const;

/** slug：小寫英數 + 連字號，1..SLUG_MAX 字元。 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ValidationResult<T> {
  ok: boolean;
  /** 失敗原因（給 400 訊息，對使用者安全、不洩內部）。 */
  error?: string;
  value?: T;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/** 去除前後空白並驗證為非空字串。 */
function reqString(v: unknown): string | null {
  if (!isString(v)) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= LIMITS.SLUG_MAX && SLUG_RE.test(slug);
}

// ── 伺服器側內容過濾 ──────────────────────────────────────────────────────────
// 基本啟發式：超量連結、明顯垃圾關鍵字、整段全大寫吼叫、重複字洗版。
// 命中即拒（回 400）；非命中則照常 pending 進待審（人工/AI 預審仍是第二道）。

const BANNED_PATTERNS: RegExp[] = [
  /\b(viagra|cialis|casino|porn|p[o0]rn|xxx)\b/i,
  // CJK 無 ASCII 字邊界，故不用 \b；直接子字串比對。
  /(賭場|博弈|代開發票|刷單|色情|援交|借貸專線)/,
  /\b(crypto\s*airdrop|free\s*nft|pump\s*and\s*dump)\b/i,
];

/** 計算字串中的 URL 數量（http/https 或裸 www.）。 */
export function countLinks(text: string): number {
  const m = text.match(/(https?:\/\/|www\.)[^\s]+/gi);
  return m ? m.length : 0;
}

/**
 * 內容過濾決策。回 { ok:false, error } 表示應拒絕。
 * 規則：
 *   - 連結數 > 2 → 視為垃圾。
 *   - 命中 banned pattern → 拒絕。
 *   - 同一字元連續重複 ≥ 20 次 → 洗版。
 */
export function contentFilter(text: string): ValidationResult<string> {
  if (countLinks(text) > 2) {
    return { ok: false, error: 'too_many_links' };
  }
  for (const re of BANNED_PATTERNS) {
    if (re.test(text)) {
      return { ok: false, error: 'banned_content' };
    }
  }
  if (/(.)\1{19,}/.test(text)) {
    return { ok: false, error: 'spam_repetition' };
  }
  return { ok: true, value: text };
}

// ── 留言輸入 ──────────────────────────────────────────────────────────────────

export interface CommentInput {
  slug: string;
  nickname: string;
  body: string;
}

export function validateComment(raw: unknown): ValidationResult<CommentInput> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'invalid_body' };
  }
  const o = raw as Record<string, unknown>;

  const slug = reqString(o.slug);
  if (!slug) return { ok: false, error: 'slug_required' };
  if (!isValidSlug(slug)) return { ok: false, error: 'slug_invalid' };

  const nickname = reqString(o.nickname);
  if (!nickname) return { ok: false, error: 'nickname_required' };
  if (nickname.length > LIMITS.NICKNAME_MAX) return { ok: false, error: 'nickname_too_long' };

  const body = reqString(o.body);
  if (!body) return { ok: false, error: 'body_required' };
  if (body.length > LIMITS.BODY_MAX) return { ok: false, error: 'body_too_long' };

  const filtered = contentFilter(body);
  if (!filtered.ok) return { ok: false, error: filtered.error };

  return { ok: true, value: { slug, nickname, body } };
}

// ── 委託投題輸入 ──────────────────────────────────────────────────────────────

export interface CommissionInput {
  methodDesc: string;
  regionHint?: string;
  sourceHint?: string;
  nickname?: string;
}

/** 選填字串：缺省/空 → undefined；過長 → 失敗。 */
function optString(v: unknown, max: number, field: string): ValidationResult<string | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isString(v)) return { ok: false, error: `${field}_invalid` };
  const t = v.trim();
  if (t.length === 0) return { ok: true, value: undefined };
  if (t.length > max) return { ok: false, error: `${field}_too_long` };
  return { ok: true, value: t };
}

export function validateCommission(raw: unknown): ValidationResult<CommissionInput> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'invalid_body' };
  }
  const o = raw as Record<string, unknown>;

  const methodDesc = reqString(o.methodDesc);
  if (!methodDesc) return { ok: false, error: 'methodDesc_required' };
  if (methodDesc.length > LIMITS.METHOD_DESC_MAX) return { ok: false, error: 'methodDesc_too_long' };

  const filtered = contentFilter(methodDesc);
  if (!filtered.ok) return { ok: false, error: filtered.error };

  const regionHint = optString(o.regionHint, LIMITS.HINT_MAX, 'regionHint');
  if (!regionHint.ok) return { ok: false, error: regionHint.error };

  const sourceHint = optString(o.sourceHint, LIMITS.HINT_MAX, 'sourceHint');
  if (!sourceHint.ok) return { ok: false, error: sourceHint.error };

  const nickname = optString(o.nickname, LIMITS.NICKNAME_MAX, 'nickname');
  if (!nickname.ok) return { ok: false, error: nickname.error };

  return {
    ok: true,
    value: {
      methodDesc,
      regionHint: regionHint.value,
      sourceHint: sourceHint.value,
      nickname: nickname.value,
    },
  };
}
