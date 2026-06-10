-- allmoneyback.me 互動後端 D1 schema（總規格 §9.3）。
-- 套用：`wrangler d1 migrations apply allmoneyback-interaction --local|--remote`。
--
-- 設計原則：
--   * 欄位最小化（§9.3 防濫用「最小化欄位」）：不存真實姓名、不存原始 IP。
--   * ip_hash 僅為 SHA-256(IP + IP_HASH_SALT)，供速率限制 / 防濫用比對，不外露、不可逆推。
--   * status 預設 'pending'：留言/委託案一律進待審，不裸奔（§9.3「高風險進待審，不裸奔」）。

-- 留言：讀者在某篇見證記錄下的評判與討論。
CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,            -- crypto.randomUUID()
  article_slug TEXT NOT NULL,               -- 對映 src/content/articles/<slug>
  nickname     TEXT NOT NULL,               -- 暱稱（≤ 40 字），非真實姓名
  body         TEXT NOT NULL,               -- 留言內容（≤ 2000 字）
  created_at   TEXT NOT NULL,               -- ISO-8601 UTC 字串
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash      TEXT                         -- SHA-256(IP + salt)，防濫用用途
);

-- 公開讀取路徑：WHERE article_slug = ? AND status = 'approved' ORDER BY created_at。
CREATE INDEX IF NOT EXISTS idx_comments_slug_status_created
  ON comments (article_slug, status, created_at);

-- 委託投題：讀者「帶一樁賺錢的事來」委託見證者去查、去記。
CREATE TABLE IF NOT EXISTS commissions (
  id          TEXT PRIMARY KEY,             -- crypto.randomUUID()
  method_desc TEXT NOT NULL,                -- 賺錢方式 / 案情描述（必填）
  region_hint TEXT,                         -- 地區線索（選填）
  source_hint TEXT,                         -- 來源線索（選填）
  nickname    TEXT,                          -- 暱稱（選填）
  created_at  TEXT NOT NULL,                -- ISO-8601 UTC 字串
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash     TEXT                          -- SHA-256(IP + salt)，防濫用用途
);

-- 選題引擎（C4）拉取待處理委託案的路徑：WHERE status = 'pending' ORDER BY created_at。
CREATE INDEX IF NOT EXISTS idx_commissions_status_created
  ON commissions (status, created_at);
