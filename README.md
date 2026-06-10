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
scripts/
  audit-ai-tone.mjs   # 內容挑刺腳本（AI 感句型、模糊引用、raw-enum）
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

## Phase 路線圖

### Phase 1（已完成）— Bootstrap
- 套件設定、Astro config、content collection schema、Zod 驗證測試
- design token 重新主題化（navy / paper / accent bronze）
- SEO/OG/JSON-LD 工具、satori OG 圖像生成
- 頁面骨架雙語化（/zh/）
- 手寫示範文章（overtime-east-asia-vs-nordic）
- GitHub Actions 部署、docs-sync-check
- CNAME、favicon、README/AGENTS

### Phase 2–3（待建）— 選題引擎 + 撰寫引擎
- 自動化選題（B 類篩選、factCategory 驗證）
- 定錨來源抓取（真實 URL 替換佔位 sources）
- AI 撰寫 pipeline（寫作 + 挑刺雙模型對抗）
- `content:audit` 升級為 CI 嚴格模式

### Phase 4（待建）— 配圖 + C2PA
- AI 生成封面圖
- C2PA manifest 簽署（`coverC2paVerified: true`）
- OG 圖注入 C2PA 標記

### Phase 5–6（待建）— 監測 + 運營
- GA4 埋點（隱私友善）
- OPERATIONS.md（值班手冊）
- 效能監測、broken-link 掃描

---

## 修改紀律

`docs-sync-check.yml` 在每個 PR 上執行：若功能程式碼路徑（`src/`, `scripts/`, `.github/workflows/`, `astro.config.mjs`, `package.json`）有變動，**必須同步更新 README.md、AGENTS.md 或 `docs/`**，否則 CI 擋 PR。

例外：在 PR body 或任一 commit message 加入 `[skip docs]`（適用純測試、輕微設定微調、typo 修正等不影響架構的異動）。

---

## 已知延後項

以下事項有意識地推遲，待後續 Phase 處理：

- `favicon.ico` 目前為 PNG-in-ICO 格式（sharp 直出），可升級為標準多尺寸 ICO
- GA4 埋點代碼尚未加入
- C2PA manifest 簽署尚未實作（`coverC2paVerified` 欄位預留）
- 文章 `sources` 目前為佔位 URL，待 Phase 2 替換為真實抓取來源
- OPERATIONS.md 將於 Phase 5–6 建立
