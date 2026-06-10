# OPERATIONS.md — 上線手動步驟 Runbook

> **適用對象：站長（非工程師）**  
> **目的**：記錄 CLI build 無法自動完成、必須手動執行一次的步驟，以及日常運維流程。  
> **原則**：本文件的每個指令名稱、環境變數名稱、workflow 輸入項名稱，均已對應 repo 內實際程式碼驗證。

---

## 1. 概覽

### Build 交付了什麼

- 一個可執行、端到端可測試的靜態站 + 內容引擎 codebase
- **STUB 模式**：不設定任何 API 金鑰即可離線跑通全條管線（`pnpm engine run-pipeline`）——引擎各層用確定性替身代替真實 LLM/圖像/GA4 呼叫，產出固定內容，不發任何網路請求
- **GitHub Actions**：`deploy.yml`（push 即部署）、`engine.yml`（排程 + 手動發布）已就緒

### 哪些事情需要手動做一次才能「真的上線 + 自動運作」

1. 建立 GitHub repo、push 程式碼、開啟 GitHub Pages
2. （買網域前）跑 preview 部署確認草稿
3. 設定 DNS → 切換到正式網域
4. 在 GitHub Secrets 填入 API 金鑰（引擎才能跑真實模式）
5. 建立 GA4 屬性並授權服務帳戶（流量報告才有真實數字）
6. （建議）驗證 Google Search Console 所有權

---

## 2. GitHub Repo 與 Pages

### 步驟

- [ ] 在 GitHub 建立新 repo（名稱任意，但要與 CNAME `allmoneyback.me` 一致）
- [ ] 將本機程式碼 push 到 `main` 分支
- [ ] 進入 repo → **Settings → Pages**
  - Source 選 **GitHub Actions**（不要選 Deploy from a branch）
- [ ] 確認第一次 push 觸發 `deploy.yml`（Actions tab 可查看）
  - push 到 `main` 時 `DEPLOY_TARGET` 預設為 `production`（deploy.yml 第 55 行：`github.event.inputs.deploy_target || 'production'`）
  - production build 會在 `dist/CNAME` 寫入 `allmoneyback.me`
- [ ] deploy job 成功後，Pages 設定頁面會顯示 `https://allmoneyback.me` 的 URL（DNS 設定完成後才能訪問）

---

## 3. 預覽（買網域前）

在尚未購買 `allmoneyback.me` 域名時，可先用 GitHub Pages 的 project page 網址預覽草稿。

### 方法：手動觸發 deploy.yml

1. 進入 **Actions → Deploy to GitHub Pages → Run workflow**
2. **`deploy_target`** 選 `preview`（workflow_dispatch 的預設值即為 `preview`）
3. 按 **Run workflow**

部署完成後可在以下網址看到草稿：

```
https://<owner>.github.io/<repo>/zh/
```

### Preview 模式的機制

- `DEPLOY_TARGET=preview` 時，`astro.config.mjs` 自動從 Actions 環境變數推導 `site`（`https://<owner>.github.io`）與 `base`（`/<repo>/`）
- **不會**寫入 `dist/CNAME`，因此不會強制綁定自訂網域，github.io 預覽正常運作
- 所有站內連結透過 `src/utils/url.ts` 的 `withBase()` 帶上 base 前綴，不會 404

### 本機產出同樣的 preview build

```bash
DEPLOY_TARGET=preview \
  GITHUB_REPOSITORY_OWNER=<owner> \
  GITHUB_REPOSITORY=<owner>/<repo> \
  pnpm build
```

---

## 4. 網域 DNS（上線）

### 前提

域名 `allmoneyback.me` 已購買，並在域名商後台有 DNS 管理權。

### DNS 設定

依照 **GitHub Pages 官方文件指定的 A/AAAA 記錄**，將 `allmoneyback.me` 指向 GitHub Pages IP（請在 [https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site) 取得最新 IP 列表，此處不列固定 IP 以免過時）。

常見設定方式（擇一）：

| 記錄類型 | 主機名稱 | 目標 |
|----------|----------|------|
| A 記錄 × 4 | `@`（apex） | GitHub Pages 文件指定的四個 IP |
| AAAA 記錄 × 4 | `@`（apex） | GitHub Pages 文件指定的 IPv6 位址 |

www 子網域（可選）：

| 記錄類型 | 主機名稱 | 目標 |
|----------|----------|------|
| CNAME | `www` | `<owner>.github.io` |

### 一鍵切換上線

DNS 設定完成後，**什麼都不需要在程式碼改**：

- push 到 `main` 預設走 `production` build（`DEPLOY_TARGET=production`）
- `astro.config.mjs` 的 `cnameIntegration` 在 production build 自動寫入 `dist/CNAME`（內容：`allmoneyback.me`）
- GitHub Pages 讀到 `CNAME` 後自動啟用自訂網域

### GitHub Pages 設定確認

- Settings → Pages → Custom domain 欄位填入 `allmoneyback.me`
- 勾選 **Enforce HTTPS**（GitHub 自動管 Let's Encrypt 憑證）

---

## 5. API 金鑰與 GitHub Secrets

引擎在無金鑰時以 STUB 模式執行（安全、離線），但要產出真實內容必須設定以下 Secrets。

進入 repo → **Settings → Secrets and variables → Actions → New repository secret**。

### 必填 Secrets

| Secret 名稱 | 用途 | 讀取位置 |
|-------------|------|----------|
| `ANTHROPIC_API_KEY` | 文章撰寫與批判 AI（claude-opus-4-8） | `engine/lib/llm.ts`：`process.env.ANTHROPIC_API_KEY` |
| `OPENAI_API_KEY` | AI 封面圖生成（gpt-image-1） | `engine/lib/image.ts`：`process.env.OPENAI_API_KEY` |

### 關於 `GITHUB_TOKEN`

`engine.yml` 的 Run pipeline step 傳入 `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`。這個 token 由 GitHub Actions **自動提供**，不需要手動建立。但它必須在 workflow env 顯式傳給 engine 程序，高立場風險的草稿才能透過 `gh` CLI 自動開立待審 issue（`engine/route/index.ts`：`process.env.GITHUB_TOKEN`）。

### GA4 相關 Secrets（見第 6 節）

| Secret 名稱 | 用途 |
|-------------|------|
| `GA4_PROPERTY_ID` | GA4 屬性 ID（數字字串，例如 `123456789`） |
| `GA4_SA_KEY` | 服務帳戶金鑰 JSON 的完整內容（單行或多行 JSON） |

> **安全紀律**：所有 API 金鑰與服務帳戶 JSON 僅存放於 GitHub Secrets 或本機 `.env`（已加入 `.gitignore`），絕不 commit 進 repo。

### 本機開發用 `.env`

```bash
# 複製 .env.example 為 .env（.gitignore 排除）
cp .env.example .env
# 填入對應值後儲存
```

`.env.example` 目前只包含：

```
PUBLIC_GA4_MEASUREMENT_ID=
```

其餘金鑰（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GA4_PROPERTY_ID`、`GA4_SA_KEY` / `GOOGLE_APPLICATION_CREDENTIALS`）加入 `.env` 即可在本機使用真實模式。

---

## 6. GA4 建立與授權

對應規格 §10.8 / §11。

### 6a. 建立 GA4 屬性 → 取得 Measurement ID

1. 前往 [https://analytics.google.com](https://analytics.google.com) → 管理 → 建立屬性
2. 取得 **Measurement ID**，格式為 `G-XXXXXXXXXX`
3. 將 Measurement ID 設為 **build-time 環境變數 `PUBLIC_GA4_MEASUREMENT_ID`**：
   - 方法：在 `deploy.yml` 的 Build step env 區塊加入：
     ```yaml
     env:
       DEPLOY_TARGET: ${{ github.event.inputs.deploy_target || 'production' }}
       PUBLIC_GA4_MEASUREMENT_ID: ${{ secrets.PUBLIC_GA4_MEASUREMENT_ID }}
     ```
   - 並在 GitHub Secrets 建立 `PUBLIC_GA4_MEASUREMENT_ID`，值為 `G-XXXXXXXXXX`
   - `.env.example` 顯示此變數為 public（`PUBLIC_` 前綴），Astro build 會注入頁面，留空則不注入 GA4 追蹤碼

### 6b. 設定服務帳戶（GA4 Data API 讀取用）

引擎的 `pnpm engine report` 呼叫 GA4 Data API 讀取流量；這需要 Google Cloud 服務帳戶授權。

1. **Google Cloud Console** → 建立（或選取）專案 → **啟用 Google Analytics Data API**
2. **IAM → 服務帳戶 → 建立服務帳戶**（名稱任意，例如 `allmoneyback-analytics`）
3. 服務帳戶建立後 → 金鑰 → 新增金鑰 → JSON → 下載 `.json` 金鑰檔
4. 回到 **Google Analytics** → 管理 → 帳戶存取管理 → 新增使用者：
   - 填入服務帳戶的 email（格式：`<name>@<project>.iam.gserviceaccount.com`）
   - 角色：**Viewer**（唯讀即可）
5. **設定 Secrets**（二擇一）：
   - 推薦：`GA4_SA_KEY`（金鑰 JSON 的完整文字內容貼為 Secret 值）
     - `engine/analytics/ga4.ts` 偵測到 `GA4_SA_KEY` 時直接用 inline credentials
   - 替代：`GOOGLE_APPLICATION_CREDENTIALS`（含金鑰 JSON 的檔案路徑；適合本機 ADC 模式）
     - 無 `GA4_SA_KEY` 時，SDK 走 ADC 自動讀此環境變數
6. 設定 `GA4_PROPERTY_ID`（純數字 ID，GA4 屬性設定頁面可查，**不含** `properties/` 前綴）

### STUB 模式判定

`isGa4StubMode()` 判斷：**同時具備** `GA4_PROPERTY_ID` 與至少一個憑證來源（`GOOGLE_APPLICATION_CREDENTIALS` 或 `GA4_SA_KEY`）才走真實模式；缺任一則回傳離線替身數字（日誌標記 `STUB`）。

### 使用

```bash
pnpm engine report   # 印站長報告：流量摘要 + 異常訊號 + 待審件數 + 好題偏好
```

---

## 7. Google Search Console（建議設定）

> 降權的**準確訊號**來自 Google Search Console（曝光、點擊、平均排名），GA4 的工作階段驟降只是早期警訊代理（`engine/analytics/ga4.ts` 中的 `detectAnomalies` 明確說明此點）。

### 步驟

1. 前往 [https://search.google.com/search-console](https://search.google.com/search-console) → 新增資源
2. 選擇「網址前置字串」，輸入 `https://allmoneyback.me`
3. 驗證所有權（推薦 HTML 標籤法或 DNS TXT 記錄法）
4. （選用）在 Search Console → 設定 → 使用者和權限，加入第 6 節建立的服務帳戶 email 為 **受限使用者**，未來整合 Search Console API 讀取排名時可直接用同一帳戶

> **目前狀態**：GSC 讀取器尚未實作（見第 12 節）。`pnpm engine report` 目前以 GA4 流量驟降作為降權早期警訊；當排名驟降時，應直接開啟 Search Console UI 查詢曝光/點擊/排名資料。

---

## 8. 排程器主機

### GitHub Actions 內建排程

`engine.yml` 已設定 cron：

```yaml
schedule:
  - cron: '0 2 * * 1,4'   # 每週一、週四 02:00 UTC
```

**重要安全機制**：排程觸發（`schedule`）的跑法**永遠是 DRY-RUN**——完整跑管線（含批判），但不寫任何檔案、不 commit。目的是防止 STUB 模式下的替身垃圾自動進 repo（見 `engine.yml` 第 1–8 行說明）。

### 真實發布的唯一入口

只有**手動 workflow_dispatch 且 `publish=true`** 才會真的落地：

```
Actions → Content Engine → Run workflow → publish: true → Run workflow
```

workflow 會：
1. 跑完整管線（fetch→select→evidence→anchor→write→critique→route）
2. 低立場風險草稿 → 寫入 `src/content/articles/`
3. 高立場風險草稿 → 寫入 `_review/` + 開 GitHub issue
4. commit/push 有變更的內容（`chore(engine): 自動發布管線產出內容 [skip ci]`）

### 本機手動跑（有金鑰時）

```bash
pnpm engine run-pipeline             # DRY-RUN（不寫任何檔）
pnpm engine run-pipeline --publish   # 真的落地（需 ANTHROPIC_API_KEY + OPENAI_API_KEY）
```

### 替代排程主機

若需要在 GitHub Actions 以外的環境排程（例如 n8n、cron job、本機排程），只需以正確環境變數執行 `pnpm engine run-pipeline --publish`。

---

## 9. 內容運維

日常操作流程如下：

### 讀報告

```bash
pnpm engine report
```

輸出包含：
- 近 28 天流量摘要（工作階段數、互動率、前期對比）
- 各文章指標（自然搜尋工作階段數）
- 異常訊號（互動率偏低 `engagement-low` / 流量驟降 `traffic-drop`）
- `_review/` 待審草稿件數

### 發布新文章

1. 在 GitHub Actions UI 手動觸發 **Content Engine** → `publish=true`
2. 或本機執行 `pnpm engine run-pipeline --publish`（需備妥金鑰）

### 高立場風險草稿的人工審核

- 引擎批判 AI（E9）判定為高風險的草稿自動落入 `_review/`，不會上線
- GitHub repo 同步開立一個 issue，標題格式：`待審：<文章標題>（立場事故風險高）`
- 審核流程：
  - [ ] 開啟 `_review/<slug>.md` 閱讀草稿
  - [ ] 修改至符合中立標準（factCategory B、無立場事故）
  - [ ] 手動移到 `src/content/articles/<slug>.md`
  - [ ] 關閉對應的 GitHub issue
  - [ ] push → deploy.yml 自動建置上線

---

## 10. C2PA / 圖片

AI 封面圖（由 `engine/lib/image.ts` 呼叫 OpenAI gpt-image-1 生成）在出廠時即內嵌 **C2PA Content Credentials** 與 SynthID 浮水印。

### Build 閘門

`package.json` 的 `postbuild` script 在每次 build 後自動執行：

```json
"postbuild": "pagefind --site dist && pnpm verify:c2pa"
```

`pnpm verify:c2pa`（即 `scripts/verify-c2pa.mjs`）執行 **manifest 存在性掃描（presence check）**：

- 對所有 frontmatter 中 `coverC2paVerified: true` 的文章，驗證 source 圖與 dist 中的已建置封面仍帶 C2PA manifest
- **任一張缺 manifest → build 以 exit 1 失敗**，阻止無憑證圖片悄悄上線

### 為何不做完整密碼學驗證

目前為 presence heuristic（byte 層面掃描 `c2pa`/`jumb`/`jumd`/`cai`/`contentauth` 標記），不做 X.509 簽章鏈與 claim hash 校驗。原因：`c2pa-node` 為重量級 native binary，避免讓 build 變脆。完整驗證列為 TODO（見第 12 節）。

### 圖片最佳化注意事項

AI 封面圖以原封 bytes 寫入（VERBATIM），不經 sharp 或 Astro 圖片最佳化器——任何 re-encode 都會剝離 C2PA manifest。若調整 Astro 圖片設定，必須確保封面圖仍用 plain `<img>` 而非 Astro 的 `<Image>` 元件。

---

## 11. 發布語言

目前發布語言：**僅中文（`/zh/`）**。

`/en/` 的頁面結構已預建（含 hreflang 設定），但 hreflang 目前以條件式關閉，待 `/en/` 內容存在後再開啟。上線初期不需要做任何語言相關的手動設定。

---

## 12. 待辦 / 已知 Stub

以下功能目前為 stub 或尚未完整實作，站長應知悉「真實運作」與「目前狀態」的差距：

| 項目 | 目前狀態 | 真實運作需要 |
|------|----------|--------------|
| **來源抓取（fetch）** | STUB：管線 fetch 層產出固定替身來源樣品，不真正抓取 URL | 真實 HTTP 抓取白名單來源、解析頁面內容 |
| **GSC 讀取器** | 未實作：`pnpm engine report` 只讀 GA4；降權以流量驟降作代理警訊 | 實作 Google Search Console API 讀取曝光/點擊/排名，替換 GA4 代理訊號 |
| **C2PA 完整密碼學驗證** | Presence heuristic（byte 掃描）；不做 X.509 驗簽與 claim hash 校驗 | 整合 `c2pa-node` 做完整 cryptographic validation（驗簽 + hard-binding） |
| **`PUBLIC_GA4_MEASUREMENT_ID` 注入 deploy.yml** | `.env.example` 已定義變數，但 `deploy.yml` 的 Build step env 區塊尚未加入此變數（見第 6a 節） | 手動在 `deploy.yml` Build step 補上 env 傳遞，或改用其他 Astro 環境變數注入方式 |

---

## 附錄：完整 Secret / 環境變數清單

| 名稱 | 類型 | 必要性 | 說明 |
|------|------|--------|------|
| `ANTHROPIC_API_KEY` | GitHub Secret | 引擎真實模式必填 | Claude API 金鑰（文章生成） |
| `OPENAI_API_KEY` | GitHub Secret | 引擎真實模式必填 | OpenAI API 金鑰（封面圖生成） |
| `GITHUB_TOKEN` | Actions 自動提供 | 自動 | 開待審 issue 用；Actions 自動注入，不需手動建立 |
| `PUBLIC_GA4_MEASUREMENT_ID` | GitHub Secret（或 build env） | GA4 追蹤必填 | `G-XXXXXXXXXX` 格式；build-time 注入頁面 |
| `GA4_PROPERTY_ID` | GitHub Secret | GA4 Data API 必填 | 純數字 ID（不含 `properties/` 前綴） |
| `GA4_SA_KEY` | GitHub Secret | GA4 Data API 必填（與下方二擇一） | 服務帳戶金鑰 JSON 完整內容 |
| `GOOGLE_APPLICATION_CREDENTIALS` | 環境變數 | GA4 Data API 替代方案 | 服務帳戶 JSON 檔的路徑（ADC 模式） |
| `IP_HASH_SALT` | Worker Secret（`wrangler secret put`） | 互動後端必填 | 雜湊來訪者 IP 的鹽；不外露、設定後勿更改（改了舊雜湊失聯） |
| `ADMIN_TOKEN` | Worker Secret（`wrangler secret put`） | 委託案匯出必填 | 選題引擎（C4）拉取 `/api/commissions/export` 的 Bearer token |
| `PUBLIC_INTERACTION_API` | GitHub Secret（或 build env） | 互動前台選填 | 互動 Worker 的 base URL；留空 → 前台留言/投題優雅降級為「尚未啟用」，不發請求 |
| `INTERACTION_API` | 環境變數（引擎端） | 委託回灌選填 | 同 Worker base URL；與 `ADMIN_TOKEN` 同時設定才會回灌委託案，否則 STUB 空陣列 |

---

## 互動後端（Cloudflare Worker，§9.3 B 案）

留言 + 委託投題後端，與 Astro 站解耦獨立部署於 `workers/interaction/`。**站長部署前必做（依序）：**

```bash
cd workers/interaction
pnpm install                                          # 安裝 wrangler 等（worker 自帶 package.json）
wrangler login                                        # 綁定 Cloudflare 帳號

# 1) 建 D1，把回傳的 database_id 填回 wrangler.jsonc 的 d1_databases[0].database_id（取代 PLACEHOLDER）
wrangler d1 create allmoneyback-interaction

# 2) 建 KV，把回傳的 id 填回 wrangler.jsonc 的 kv_namespaces[0].id（取代 PLACEHOLDER）
wrangler kv namespace create RATE_LIMIT

# 3) 套用 schema
wrangler d1 migrations apply allmoneyback-interaction --remote

# 4) 設定兩個 secret（互動式輸入，勿寫進檔案或指令參數）
wrangler secret put IP_HASH_SALT     # 任意高熵字串，設定後勿更改
wrangler secret put ADMIN_TOKEN      # 給 C4 選題引擎拉委託案用

# 5) 部署
wrangler deploy
```

部署完成後 API（皆在 `/api/` 下，CORS 鎖定 `https://allmoneyback.me` + `https://weiqi-kids.github.io`）：

| 方法 | 路徑 | 用途 |
|------|------|------|
| GET | `/api/comments?slug=<slug>` | 公開讀某篇已核准留言（時間序，上限 200） |
| POST | `/api/comments` | 免登入發留言（`{slug,nickname,body}`）→ 入庫 `pending`（待審不裸奔） |
| POST | `/api/commissions` | 委託投題（`{methodDesc,regionHint?,sourceHint?,nickname?}`）→ 入庫 `pending` |
| GET | `/api/commissions/export` | **需 `Authorization: Bearer <ADMIN_TOKEN>`**；給 C4 引擎拉待處理委託案 |

**審核**：留言/委託案預設 `status='pending'`，不會自動顯示。站長須以 D1 將要公開的留言 `UPDATE comments SET status='approved' WHERE id=...`（人工/AI 預審佇列；前台只讀 `approved`）。

**防濫用**：每個 ip_hash + route 每 10 分鐘 5 次（`src/ratelimit.ts` 的 `DEFAULT_LIMITS`），超限回 429。IP 僅以 `SHA-256(IP + IP_HASH_SALT)` 存 `ip_hash`，不存原始 IP。

**本地測試**：`pnpm vitest run`（worker 測試以假 D1/KV 跑，不需 Cloudflare 帳號或網路）。`wrangler deploy --dry-run` 可離線驗證設定。

### 前台介接（C4）——部署 Worker 後才設

前台（Astro 站）透過 build-time 環境變數 `PUBLIC_INTERACTION_API` 取得上面 Worker 的 base URL。**未設定時一律優雅降級**：文章頁的留言島渲染「留言功能尚未啟用」、`/zh/commission/` 委託投題表單渲染「投題功能尚未啟用」，不發任何請求、不報錯。Worker 部署完成前可（也應）留空。

部署 Worker 後，站長設定 `PUBLIC_INTERACTION_API`：

- **本機 `.env`**：`PUBLIC_INTERACTION_API=https://interaction.<your-subdomain>.workers.dev`（見 `.env.example`）。
- **GitHub Actions**：建立 Secret `PUBLIC_INTERACTION_API`，並在 build step 的 `env:` 注入（與 `PUBLIC_GA4_MEASUREMENT_ID` 同模式，見第 6a 節）。

設定後重新 build，文章頁出現留言列表 + 留言表單、`/zh/commission/` 出現投題表單；表單送出皆回 `pending`（待審不裸奔）。

### 委託案回灌選題引擎（C4，仍過 B/A 閘門）

選題引擎可把讀者委託案當作**候選種子**回灌（`engine/commissions/`）：

- 設定**引擎端**環境變數 `INTERACTION_API`（Worker base URL）+ `ADMIN_TOKEN`（與 Worker secret 同值）後，`fetchCommissions()` 會帶 `Authorization: Bearer <ADMIN_TOKEN>` 打 `/api/commissions/export` 拉 `pending` 委託案。
- **任一缺 → STUB**：回空陣列、不發網路（既有選題流程不受影響）。
- **委託案不被自動信任**：它只是 LLM prompt 的種子，最終仍須通過 `engine/select` 的 B/A 硬閘門、對照文化數、anchor、evidence、critique 才可能進生產。委託 ≠ 自動發文。
