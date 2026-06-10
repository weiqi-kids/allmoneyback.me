# 錢途 allmoneyback.me

**金錢與工作的跨文化態度觀察站**

敘事主體是 **AI 觀察者**，呈現不同文化對金錢、工作、消費、財富的真實分歧，不評判對錯、不本質化、不嘲諷。選題限定事實無爭議的 B 類題（factCategory = `B`），寫法保持中立。

---

## 技術棧

| 層面 | 採用 |
|------|------|
| 靜態站 | Astro 5（純 static output） |
| 套件管理 | pnpm |
| 互動元件 | Svelte（island 架構） |
| OG 圖像生成 | satori（build-time SVG → PNG via sharp） |
| 全文搜尋 | pagefind（postbuild 自動索引） |
| 部署 | GitHub Pages + GitHub Actions |
| 測試 | vitest |
| 型別 | TypeScript + Zod |

---

## 本機開發

```bash
pnpm install          # 安裝依賴
pnpm dev              # 啟動 dev server（http://localhost:4321）
pnpm build            # 靜態建置 → dist/；postbuild 自動跑 pagefind
pnpm test             # vitest run（schema + utility 單測）
pnpm run content:audit  # 掃描文章 AI 感句型／模糊引用／raw-enum
```

---

## 預覽 / 上線（GitHub Pages）

一個開關控制全部：環境變數 **`DEPLOY_TARGET`**（`preview` | `production`，預設 `production`）。

| 模式 | site | base | CNAME | 用途 |
|------|------|------|-------|------|
| `production`（預設） | `https://allmoneyback.me` | `/` | 寫入 `dist/CNAME` | 自訂網域正式上線 |
| `preview` | `https://<owner>.github.io` | `/<repo>/` | 不寫入 | 買網域前先在 github.io 看草稿 |

`preview` 模式下，`site` / `base` 會自動從 GitHub Actions 的 `GITHUB_REPOSITORY_OWNER`、`GITHUB_REPOSITORY` 推導出 project page 網址（本機可用 `PREVIEW_SITE` / `PREVIEW_BASE` 覆寫）。所有站內連結都透過 `src/utils/url.ts` 的 `withBase()` 加上 base 前綴，因此預覽不會 404。

### 買網域前：預覽草稿
從 GitHub Actions UI 手動觸發 **Deploy to GitHub Pages**（`workflow_dispatch`），`deploy_target` 選 `preview`（預設）。完成後草稿會出現在：

```
https://<owner>.github.io/<repo>/zh/
```

本機要產出同樣的預覽 build：

```bash
DEPLOY_TARGET=preview \
  GITHUB_REPOSITORY_OWNER=<owner> \
  GITHUB_REPOSITORY=<owner>/<repo> \
  pnpm build
# dist/ 內連結會帶 /<repo>/ 前綴，且不產生 dist/CNAME
```

### 買網域後：正式上線
什麼都不用改——預設就是 `production`。push 到 `main` 會以 `DEPLOY_TARGET=production` 建置，自動寫入 `dist/CNAME`（`allmoneyback.me`）切到自訂網域。（需先在 GitHub Pages 設定中綁定自訂網域並完成 DNS。）

---

## 專案結構

```
src/
  content/
    articles/         # Markdown 文章（每檔一篇；slug = 檔名）
  schemas/
    articles.ts       # Zod schema（單一 source of truth）
  content.config.ts   # Astro content collection 設定（image() 覆寫封面欄位）
  layouts/
    Base.astro        # HTML shell、SEO meta、hreflang、JSON-LD
    Article.astro     # 文章頁版型
    List.astro        # 列表版型
    Policy.astro      # 靜態政策頁版型
  components/
    blocks/           # 頁面級區塊（TopNav, Footer, ArticleCard, AiDisclosure...）
    ui/               # 通用元件（Button, CategoryTag, SearchBar, Breadcrumb...）
    seo/              # JSON-LD 注入（JsonLd.astro）
  pages/
    index.astro       # 根路徑 → redirect /zh/
    zh/               # 中文路由（index, articles/[...slug], search, about, ...）
    404.astro
    rss.xml.ts
    llms.txt.ts / llms-full.txt.ts
  utils/
    social-meta.ts    # 站名、預設 OG 圖、description 常數
    og-template.ts    # satori OG 卡片生成
    og-fonts.ts       # build-time 字型載入
    articles.ts       # 文章 collection 查詢輔助
    date.ts           # 日期格式化
    tag-stats.ts      # tag 彙總
    article-categories.ts  # 文章分類常數
  styles/
    global.css        # design tokens（OKLCH）+ 全局排版
    rwd-fixes.css     # 響應式修補
engine/               # AI 內容引擎（半無人 pipeline）— 見「AI 內容引擎」一節
scripts/
  audit-ai-tone.mjs   # 內容挑刺腳本（AI 感句型、模糊引用、raw-enum）
  verify-c2pa.mjs     # postbuild C2PA manifest 存在性檢查（gates build）
.github/
  workflows/
    deploy.yml        # pnpm build → GitHub Pages 部署
    docs-sync-check.yml  # PR 功能程式碼變更時要求同步文件
public/
  favicon.svg / .ico / apple-touch-icon.png  # 品牌 favicon
  # 注意：CNAME 不放 public/（會每次 build 都複製、破壞 github.io 預覽）；
  # 改由 astro.config.mjs 的 conditional-cname integration 僅在 production 寫入 dist/CNAME。
  og-static/          # 靜態預設 OG 圖（default.png）
  robots.txt
  vendor/             # 自託管字型備份
tests/
  content-schema.test.ts  # Zod schema + frontmatter 驗證測試
docs/                 # 內部文件（superpowers、playbooks 等）
```

---

## 內容 frontmatter schema

文章 frontmatter 由 `src/schemas/articles.ts` 定義，欄位分組如下：

| 群組 | 欄位 |
|------|------|
| 識別 | `title`, `description`, `tldr`, `domainTopic`, `tags` |
| 跨文化選題 | `anchorCulture`, `comparedCultures`（2–4 個）, `suspectCultures` |
| 品管 | `factCategory`（只允許 `B`）, `stanceRiskLevel`（`low` \| `high`） |
| 來源 | `sources[]`（title, url, region, language, credibility） |
| 生成資訊 | `writeModel`, `critiqueModel`, `pipelineVersion`, `specVersion`, `generatedDate`, `updatedDate` |
| 配圖 | `coverImage`（optional）, `coverC2paVerified` |
| 結構化 | `faq[]`（q/a pairs） |
| 雙語 | `lang`（`zh` \| `en`，預設 `zh`） |
| 狀態 | `draft`（預設 `false`） |

---

## AI 內容引擎（半無人 pipeline）

`engine/` 是一條「半無人」的內容生產線：給定來源白名單與選題準則，端到端跑出一份**已被批判驗證**的文章草稿，再依立場事故風險自動分流——低風險落地上線、高風險隔離待人工審查。它是「可被執行的程式碼庫」，**不是自走、不是 live**：每次都由 `pnpm engine run-pipeline` 或 CI 觸發。

### 管線階段（依序）

1. **抓取（fetch）** — 依來源白名單（survey / stats-office / academic / discourse）產生來源樣品，論壇類來源被拒。
2. **選題（select，B/A 保守 gate）** — 只放行事實無爭議的 B 類題，保守擋下 A 類爭議題；可去重避免重複選題。
3. **撈證據（evidence，限白名單）** — 為選題撈跨文化證據，**只**接受白名單來源；證據不足則誠實退回。
4. **定錨（anchor，資料可得性算錨點）** — 以「哪個文化的資料最可得」決定定錨文化，而非預設立場；可得性不足則退回。
5. **撰寫（write，AI 觀察者）** — 以「AI 觀察者」敘事主體產出中立草稿（寫前已逐關放行，write 內部仍再 guard 一次）。
6. **挑刺（critique，雙 AI 對抗）** — 第二個 AI 對抗式挑刺，revise-until-pass，產出最終草稿與立場風險判定。
7. **風險分流（route）** — `low` → 發布到 `src/content/articles/`；`high` → 隔離到 `_review/`（不 build、不上線）並開 GitHub issue 待審。
8. **配圖（cover，C2PA）** — 生成 AI 封面圖並標記 C2PA（`coverC2paVerified`）；STUB 時為佔位圖、`coverC2paVerified:false`。
9. **監測（GA4 + 異常 + 好題回饋）** — `report` 彙整 GA4 流量摘要、異常訊號、待審件數，並從流量回饋萃取「好題偏好」供未來選題參考。

> 設計誠信原則：任一閘門（select / evidence / anchor）未過，管線**誠實退回** `rejected` + 階段 + 原因，**絕不**硬產出半套文章。

### 如何執行

```bash
pnpm engine run-pipeline            # DRY-RUN：跑完整條（含 critique），但「不寫任何檔」
pnpm engine run-pipeline --publish  # 真的落地（低風險→發布；高風險→_review + 開 issue）
pnpm engine fetch                   # 只跑抓取層，印來源摘要
pnpm engine report                  # 站長報告（流量 + 異常 + 待審件數 + 好題偏好）
```

**STUB 模式 vs REAL 模式**：

| | 觸發條件 | 行為 |
|--|--------|------|
| **STUB** | 未設 `ANTHROPIC_API_KEY` | 離線、確定性替身（`writeModel`/`critiqueModel` = `stub`）；無 `OPENAI_API_KEY` → 佔位封面；無 `GA4_PROPERTY_ID` → 離線替身報告。可離線完整跑通整條管線。 |
| **REAL** | 設了對應金鑰 | 呼叫真實模型撰寫／批判（仍受同樣的保守閘門約束）。 |

`src/content/articles/` 內附**兩篇**示範：`overtime-east-asia-vs-nordic.md`（Phase 1 手寫）與一篇 `overtime-<hash>.md`（STUB 模式跑完整管線的落地樣本，frontmatter `writeModel: stub`、本文頂端標明為 pipeline-stub 樣本）。

### `engine/` 佈局

```
engine/
  cli.ts            # `pnpm engine <command>` 派發（run-pipeline / fetch / report / help）
  pipeline.ts       # 階段編排：fetch→select→evidence→anchor→write→critique→route
  schemas.ts        # 引擎內部型別與 Zod schema
  version.ts        # pipelineVersion / specVersion
  config/           # 選題準則（criteria）、領域（domain）、來源白名單（sources）
  fetch/            # 抓取層（白名單樣品、論壇拒絕）
  select/           # 選題 gate（B/A 保守）+ 去重
  evidence/         # 跨文化證據（限白名單）
  anchor/           # 資料可得性算錨點
  write/            # AI 觀察者撰寫 + cover.ts（配圖）
  critique/         # 雙 AI 對抗挑刺
  route/            # 風險分流（發布 / 隔離 + 開 issue）
  publish/          # 檔案落地（publishArticle / quarantineDraft + slug 命名）
  analytics/        # ga4.ts（流量 + 異常）、feedback.ts（好題回饋）
  lib/              # llm.ts（STUB/REAL 切換）、image.ts、store.ts（JSON 持久化）、log.ts
  data/             # 執行期 store（gitignored，不入版控）
```

### Phase 狀態

- **Phase 1（站台）完成**：Astro 站、schema、SEO/OG/JSON-LD、雙語骨架、部署。
- **Phase 2–6（引擎）完成**：選題→證據→定錨→撰寫→批判→分流→配圖→監測，皆可在 STUB 模式離線跑通並有測試覆蓋。

**目前仍為 STUB（待接真實後端）**：

- **真實來源抓取**：`fetch` 目前產生白名單「樣品」，尚未真的去各來源 API/網站抓資料。
- **GSC（Google Search Console）**：尚未串接，自然搜尋訊號目前由 GA4 維度近似。
- **完整 C2PA 驗證**：`verify:c2pa` 目前為 manifest「存在性」檢查，尚非完整密碼學驗章。

上線運營、值班、金鑰設定、故障排除請見 **[OPERATIONS.md](./OPERATIONS.md)**。

---

## Phase 路線圖

### Phase 1（已完成）— Bootstrap
- 套件設定、Astro config、content collection schema、Zod 驗證測試
- design token 重新主題化（navy / paper / accent bronze）
- SEO/OG/JSON-LD 工具、satori OG 圖像生成
- 頁面骨架雙語化（/zh/）
- 手寫示範文章（overtime-east-asia-vs-nordic）
- GitHub Actions 部署、docs-sync-check
- CNAME、favicon、README/AGENTS

### Phase 2–6（已完成）— AI 內容引擎
- 自動化選題（B 類保守 gate、factCategory 驗證）+ 去重
- 跨文化證據（限白名單）+ 資料可得性定錨
- AI 撰寫 pipeline（撰寫 + 挑刺雙模型對抗，revise-until-pass）
- 風險分流（low → 發布 / high → `_review/` + 開 issue）
- AI 配圖 + C2PA manifest 標記（`coverC2paVerified`）
- GA4 監測 + 異常訊號 + 好題回饋
- OPERATIONS.md（值班手冊）

詳見上方 [AI 內容引擎](#ai-內容引擎半無人-pipeline) 一節。仍為 STUB 的部分（真實來源抓取、GSC、完整 C2PA 驗章）見 [OPERATIONS.md](./OPERATIONS.md)。

---

## 修改紀律

`docs-sync-check.yml` 在每個 PR 上執行：若功能程式碼路徑（`src/`, `scripts/`, `.github/workflows/`, `astro.config.mjs`, `package.json`）有變動，**必須同步更新 README.md、AGENTS.md 或 `docs/`**，否則 CI 擋 PR。

例外：在 PR body 或任一 commit message 加入 `[skip docs]`（適用純測試、輕微設定微調、typo 修正等不影響架構的異動）。

---

## 已知延後項

以下事項有意識地推遲：

- `favicon.ico` 目前為 PNG-in-ICO 格式（sharp 直出），可升級為標準多尺寸 ICO
- **真實來源抓取**：`pnpm engine fetch` 目前產生白名單樣品，尚未真的抓各來源資料
- **GSC（Search Console）**：尚未串接，自然搜尋訊號暫由 GA4 維度近似
- **完整 C2PA 驗章**：`verify:c2pa` 目前為 manifest 存在性檢查，尚非完整密碼學驗證

（GA4 埋點、C2PA manifest 標記、OPERATIONS.md 已於 Phase 5–6 完成——見上方引擎章節。）
