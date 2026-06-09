# allmoneyback.me Phase 1：Bootstrap & Re-theme 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 從 evidencetoday.news fork 出一個可 build、可部署到 GitHub Pages 的全新獨立站 allmoneyback.me，剝除所有 evidencetoday/健康/媒體痕跡，re-theme 成「金錢與工作・AI 跨文化觀察站」，建立新的 `articles` content collection schema 與一篇手寫示範文章，並架好 zh/en 雙語結構（起步只發繁中）。

**Architecture:** 複製 evidencetoday 已驗證的 Astro 5 靜態基礎建設（config/layouts/utils/styles/SEO/OG/部署），不複製其 content collection 與媒體專屬程式；重建 content schema 與品牌，產出可獨立 build 的成品。後續 Phase 2–6（pipeline 引擎、配圖+C2PA、GA4 監測）在此基礎上增建。

**Tech Stack:** Astro 5（static）、pnpm、@astrojs/sitemap、@astrojs/mdx、satori（OG）、pagefind（搜尋）、zod（schema）、GitHub Pages + Actions、vitest（測試）。

**來源專案（唯讀，僅複製）：** `/Users/lightman/weiqi.kids/evidencetoday.news`
**目標專案：** `/Users/lightman/weiqi.kids/allmoneyback.me`（已 git init，已有 `docs/`、`.gitignore`）

---

## 6 階段路線圖（本計畫只詳述 Phase 1）

| Phase | 交付 | 計畫文件 |
|---|---|---|
| **1** | Bootstrap & Re-theme：可 build/部署的主題化站 + 新 schema + 示範文章 + 雙語結構 | 本文件 |
| 2 | 選題/定錨/撈證據/撰寫引擎（Anthropic）+ 抓取層（真抓+stub）+ 設定檔 | 待 Phase 1 完成後撰寫 |
| 3 | 雙 AI 挑刺對抗 + 立場事故風險分流（`_review/` + GitHub issue）+ Actions 排程 | 同上 |
| 4 | 配圖（OpenAI Image 2）+ C2PA 保留與 build 驗證 + AI 圖可見標記 | 同上 |
| 5 | GA4 埋點 + Data API 讀取 + 異常訊號 + 好題回饋 | 同上 |
| 6 | OPERATIONS.md + 端到端驗收 + 一篇走完整 pipeline 的示範文章 | 同上 |

---

## Phase 1 檔案結構

複製來源 → 目標（exact）：

| 目標檔案 | 來源/動作 | 責任 |
|---|---|---|
| `package.json` | 改寫 evidencetoday 版 | 移除 youtube/podcast 依賴與 script，改名 |
| `astro.config.mjs` | 複製+改 | site URL、整合套件 |
| `tsconfig.json` `vitest.config.ts` `src/env.d.ts` | 複製 | 型別/測試設定 |
| `src/content.config.ts` | **重寫** | 新 `articles` schema（spec §3） |
| `src/layouts/Base.astro` | 複製+改 | SEO/OG/JSON-LD head、品牌 |
| `src/layouts/Article.astro` `List.astro` `Policy.astro` | 複製+改 | 文章/列表/政策版型（不複製 Media.astro） |
| `src/styles/tokens.css` `global.css` `typography.css` `rwd-fixes.css` | 複製+改 tokens 主色 | design token 系統 |
| `src/utils/og-template.ts` `og-fonts.ts` `date.ts` `social-meta.mjs` `articles.ts` `tag-stats.ts` `article-categories.ts` | 複製+改 | OG/SEO/文章工具（不複製 youtube.ts/podcasts.ts/videos.ts/news.ts） |
| `src/pages/index.astro` `about.astro` `search.astro` `404.astro` `rss.xml.ts` `llms.txt.ts` `llms-full.txt.ts` | 複製+改 | 首頁/關於/搜尋/RSS/AI 爬蟲（不複製 admin/medical-disclaimer） |
| `src/pages/privacy.astro` `terms.astro` `contact.astro` `editorial-policy.astro` `disclosure.astro` | 複製+改文案 | 政策頁 re-theme |
| `public/robots.txt` `CNAME` `favicon.*` `og-static/` `vendor/` | 複製+改 | 站台 chrome |
| `scripts/audit-ai-tone.mjs` `generate-favicons.mjs` | 複製+改 | 挑刺腳本（Phase 3 擴充）、favicon（不複製 sync-youtube/check-myth） |
| `.github/workflows/deploy.yml` `docs-sync-check.yml` | 複製+改 | 部署（移除 youtube sync）、文件紀律（不複製 content-audit，Phase 3 重建） |
| `src/content/articles/_seed-overtime-asia-vs-nordic.md` | **新建** | 示範文章，exercise 全 schema |
| `tests/content-schema.test.ts` | **新建** | schema 驗證測試 |
| `README.md` `AGENTS.md` | **新建** | 專案說明、agent 紀律 |

---

## Task 1：建立 package.json 與基礎設定檔

**Files:**
- Create: `/Users/lightman/weiqi.kids/allmoneyback.me/package.json`
- Copy: `astro.config.mjs` `tsconfig.json` `vitest.config.ts` `src/env.d.ts`

- [ ] **Step 1: 複製基礎設定檔（不含 youtube/podcast）**

```bash
cd /Users/lightman/weiqi.kids/allmoneyback.me
SRC=/Users/lightman/weiqi.kids/evidencetoday.news
mkdir -p src
cp "$SRC/tsconfig.json" "$SRC/vitest.config.ts" .
cp "$SRC/src/env.d.ts" src/
```

- [ ] **Step 2: 寫 package.json（移除 youtube/podcast 依賴與 script，改名）**

```json
{
  "name": "allmoneyback-me",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "postbuild": "pagefind --site dist",
    "preview": "astro preview",
    "content:audit": "node scripts/audit-ai-tone.mjs",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@astrojs/mdx": "^4.3.14",
    "@astrojs/rss": "^4.0.18",
    "@astrojs/sitemap": "^3.7.2",
    "@astrojs/svelte": "^7.2.5",
    "@fontsource/inter": "^5.2.8",
    "@fontsource/noto-sans-tc": "^5.2.9",
    "@fontsource/noto-serif-tc": "^5.2.10",
    "@fontsource/source-serif-4": "^5.2.9",
    "astro": "^5.18.1",
    "satori": "^0.26.0",
    "svelte": "^5.55.5"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.6.0",
    "js-yaml": "^4.2.0",
    "pagefind": "^1.5.2",
    "sharp": "^0.34.5",
    "typescript": "^5.9.3",
    "vitest": "^4.1.8",
    "zod": "^3.24.0"
  }
}
```

> 註：d3-* 與 @toast-ui/editor、pinyin-pro 為 evidencetoday 圖表/編輯器專屬，Phase 1 不需要；如後續圖表需要再加。zod 由 Astro 內建帶入，明列以利 schema 測試直接 import。

- [ ] **Step 3: 寫 astro.config.mjs（改 site URL）**

```javascript
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://allmoneyback.me',
  integrations: [
    svelte(),
    sitemap({ filter: (page) => !page.includes('/admin') }),
    mdx(),
  ],
  output: 'static',
});
```

- [ ] **Step 4: 安裝依賴並確認 astro 可辨識**

Run: `cd /Users/lightman/weiqi.kids/allmoneyback.me && pnpm install`
Expected: 安裝成功，無 peer error 中斷。

- [ ] **Step 5: Commit**

```bash
git add package.json astro.config.mjs tsconfig.json vitest.config.ts src/env.d.ts pnpm-lock.yaml
git commit -m "chore: bootstrap package.json 與 Astro 基礎設定"
```

---

## Task 2：定義新 content schema 與驗證測試（TDD）

**Files:**
- Create: `src/content.config.ts`
- Test: `tests/content-schema.test.ts`

- [ ] **Step 1: 寫失敗測試（schema 應接受合法 frontmatter、拒絕缺欄位）**

`tests/content-schema.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { articlesSchema } from '../src/content.config';

const valid = {
  title: '為什麼東亞把加班當責任、北歐當管理失敗',
  description: '一個 AI 觀察者俯瞰加班態度的跨文化分歧。',
  tldr: '加班在東亞被讀成責任感，在北歐被讀成管理失敗——兩者都源於各自的勞動處境。',
  domainTopic: 'overtime',
  tags: ['加班', '勞動文化'],
  anchorCulture: 'Nordic',
  comparedCultures: ['East Asia', 'United States'],
  suspectCultures: [],
  factCategory: 'B',
  stanceRiskLevel: 'low',
  sources: [
    { title: 'OECD Hours Worked', url: 'https://oecd.org/x', region: 'OECD', language: 'en', credibility: 'high' },
  ],
  writeModel: 'claude-opus-4-8',
  critiqueModel: 'claude-sonnet-4-6',
  pipelineVersion: '0.1.0',
  specVersion: 'base-md-v1',
  generatedDate: new Date('2026-06-09'),
  updatedDate: new Date('2026-06-09'),
  coverImage: './cover.png',
  coverC2paVerified: true,
  faq: [{ q: '為什麼差異存在？', a: '因為勞動處境不同。' }],
  lang: 'zh',
};

describe('articlesSchema', () => {
  it('接受合法 frontmatter', () => {
    expect(() => articlesSchema.parse(valid)).not.toThrow();
  });
  it('factCategory 只接受 B（A 應被拒絕，禁止 A 類進生產）', () => {
    expect(() => articlesSchema.parse({ ...valid, factCategory: 'A' })).toThrow();
  });
  it('stanceRiskLevel 只接受 low/high', () => {
    expect(() => articlesSchema.parse({ ...valid, stanceRiskLevel: 'medium' })).toThrow();
  });
  it('缺 anchorCulture 應拒絕', () => {
    const { anchorCulture, ...rest } = valid;
    expect(() => articlesSchema.parse(rest)).toThrow();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/lightman/weiqi.kids/allmoneyback.me && pnpm vitest run tests/content-schema.test.ts`
Expected: FAIL（`articlesSchema` 未匯出 / 模組不存在）。

- [ ] **Step 3: 寫 content.config.ts（匯出可測 schema + collection）**

`src/content.config.ts`：
```typescript
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const sourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  region: z.string(),
  language: z.string(),
  credibility: z.enum(['high', 'medium', 'low']),
});

// 純 zod schema，供 vitest 直接 import 測試（不依賴 astro:content 執行期）
export const articlesSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tldr: z.string().min(1),
  domainTopic: z.string().min(1),
  tags: z.array(z.string()).default([]),
  // 引擎判定
  anchorCulture: z.string().min(1),
  comparedCultures: z.array(z.string()).min(2).max(4),
  suspectCultures: z.array(z.string()).default([]),
  factCategory: z.literal('B'), // 只允許 B；A 類禁止進生產
  stanceRiskLevel: z.enum(['low', 'high']),
  sources: z.array(sourceSchema).min(1),
  // 生成資訊（生成當下寫入，不寫死）
  writeModel: z.string().min(1),
  critiqueModel: z.string().min(1),
  pipelineVersion: z.string().min(1),
  specVersion: z.string().min(1),
  generatedDate: z.coerce.date(),
  updatedDate: z.coerce.date(),
  // 配圖
  coverImage: z.string().optional(),
  coverC2paVerified: z.boolean().default(false),
  // 結構化
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  // 雙語
  lang: z.enum(['zh', 'en']).default('zh'),
  draft: z.boolean().default(false),
});

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: ({ image }) =>
    articlesSchema.extend({
      coverImage: image().optional(),
    }),
});

export const collections = { articles };
```

> 註：`articlesSchema` 用 `coverImage: z.string()` 供測試；collection 內用 `image()` helper 覆寫成 Astro 圖片物件，兩者並存不衝突。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run tests/content-schema.test.ts`
Expected: PASS（4 個案例全綠）。

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts tests/content-schema.test.ts
git commit -m "feat: 跨文化分歧文章 content schema + 驗證測試"
```

---

## Task 3：複製並 re-theme design tokens（先讀設計 SKILL）

**Files:**
- Copy+modify: `src/styles/tokens.css` `global.css` `typography.css` `rwd-fixes.css`

- [ ] **Step 1: 讀前端設計 SKILL，確立 palette 方向**

Run: `cat /mnt/skills/public/frontend-design/SKILL.md`
目的：避免套版預設感；定出「中立俯瞰的 AI 觀察者」調性的主色（克制、可信、不像內容農場、不沿用 evidencetoday 的 teal/coral 健康色）。

- [ ] **Step 2: 複製 styles**

```bash
SRC=/Users/lightman/weiqi.kids/evidencetoday.news
mkdir -p src/styles
cp "$SRC"/src/styles/*.css src/styles/
```

- [ ] **Step 3: 改寫 tokens.css 主色為金錢與工作站調性**

依 Step 1 結論，修改 `src/styles/tokens.css` 的 oklch 基色變數（主色、深色、紙白、墨黑、強調色），移除 evidencetoday 的健康分類色（verdict 色等），保留間距/圓角/陰影/字體 token 系統。色值用 oklch（遵全域圖表規則 hex/oklch）。

- [ ] **Step 4: 確認無 evidencetoday 殘留色名**

Run: `grep -rniE "teal|coral|verdict|myth" src/styles/ || echo "clean"`
Expected: `clean`（或僅剩需保留的中性命名）。

- [ ] **Step 5: Commit**

```bash
git add src/styles/
git commit -m "style: re-theme design tokens 為 AI 觀察者調性"
```

---

## Task 4：複製 SEO/OG/JSON-LD 基礎與工具

**Files:**
- Copy+modify: `src/layouts/Base.astro`、`src/utils/{og-template,og-fonts,date,social-meta,articles,tag-stats,article-categories}.{ts,mjs}`
- Copy: `public/{robots.txt,favicon.*,og-static,vendor}`

- [ ] **Step 1: 複製 layouts 與 utils（排除媒體專屬）**

```bash
SRC=/Users/lightman/weiqi.kids/evidencetoday.news
mkdir -p src/layouts src/utils public
cp "$SRC"/src/layouts/{Base,Article,List,Policy}.astro src/layouts/
cp "$SRC"/src/utils/{og-template,og-fonts,date,social-meta,articles,tag-stats,article-categories}.* src/utils/
cp -r "$SRC"/public/{robots.txt,favicon.ico,favicon.svg,apple-touch-icon.png,og-static,vendor} public/ 2>/dev/null || true
```

- [ ] **Step 2: 改 Base.astro 品牌、JSON-LD、語言**

修改 `src/layouts/Base.astro`：站名改 allmoneyback.me、`inLanguage: 'zh-TW'` 保留、Organization/WebSite schema 改本站、SearchAction URL 改本站、移除 medical/健康相關 meta。新增 `hreflang` 連結標籤（zh/en 對位，Phase 1 只有 zh 實際存在但標記架好）。

- [ ] **Step 3: 改 og-template.ts 配色與分類**

修改 `src/utils/og-template.ts`：移除 evidencetoday 五分類色（文章/迷思/成分/Podcast/短影），改為金錢與工作站的中性 OG 卡（主色用 Task 3 的 palette），標題依文章 `title` 自動排版，附「AI 生成圖」角標位（C2PA 在 Phase 4 接）。

- [ ] **Step 4: 改 robots.txt 的 sitemap host 與 article-categories**

修改 `public/robots.txt` 的 `Sitemap:` 指向 `https://allmoneyback.me/sitemap-index.xml`；改 `src/utils/article-categories.ts` 為金錢與工作子題分類（overtime/debt/retirement/...）。

- [ ] **Step 5: 確認無 evidencetoday 字串殘留於 layouts/utils**

Run: `grep -rni "evidencetoday\|medical\|firstory" src/layouts src/utils public/robots.txt || echo "clean"`
Expected: `clean`。

- [ ] **Step 6: Commit**

```bash
git add src/layouts src/utils public
git commit -m "feat: 複製並 re-theme SEO/OG/JSON-LD 基礎與工具"
```

---

## Task 5：頁面 re-theme（首頁/關於/政策/搜尋）+ 雙語結構

**Files:**
- Copy+modify: `src/pages/{index,about,search,404}.astro` `rss.xml.ts` `llms.txt.ts` `llms-full.txt.ts`
- Copy+modify: `src/pages/{privacy,terms,contact,editorial-policy,disclosure}.astro`
- Create: `src/data/site.ts`（站台基本資料）
- 雙語：頁面置於 `src/pages/zh/` 並設 `/` 重導到 `/zh/`

- [ ] **Step 1: 複製頁面（排除 admin/medical-disclaimer）**

```bash
SRC=/Users/lightman/weiqi.kids/evidencetoday.news
mkdir -p src/pages/zh src/data
cp "$SRC"/src/pages/{index,about,search,404}.astro src/pages/zh/
cp "$SRC"/src/pages/{rss.xml.ts,llms.txt.ts,llms-full.txt.ts} src/pages/
cp "$SRC"/src/pages/{privacy,terms,contact,editorial-policy,disclosure}.astro src/pages/zh/
cp "$SRC"/src/data/site.ts src/data/
```

- [ ] **Step 2: 建立 `/` → `/zh/` 重導**

`src/pages/index.astro`：
```astro
---
return Astro.redirect('/zh/');
---
```

- [ ] **Step 3: 改 site.ts 與 about 頁為 AI 觀察者定位**

改 `src/data/site.ts`：站名、描述、編輯名改為「AI 觀察者」。改 `src/pages/zh/about.astro`：說明本站是 AI 視角的跨文化態度觀察站、AI 全權選題、雙 AI 護欄、據實揭露生成資訊（呼應 spec §0、§8）。

- [ ] **Step 4: 改政策頁文案**

移除健康/醫療免責，改為：內容由 AI 產出之揭露、來源與方法說明、隱私（含 GA4 揭露佔位）、聯絡。移除 firstory/youtube 相關段落。

- [ ] **Step 5: 確認頁面無殘留主題字串**

Run: `grep -rni "evidencetoday\|medical\|迷思\|闢謠\|youtube\|podcast" src/pages src/data/site.ts || echo "clean"`
Expected: `clean`。

- [ ] **Step 6: Commit**

```bash
git add src/pages src/data
git commit -m "feat: 頁面 re-theme 為 AI 觀察者定位 + zh 雙語結構"
```

---

## Task 6：文章版型與列表（接上 articles collection）

**Files:**
- Modify: `src/layouts/Article.astro` `List.astro`
- Create: `src/pages/zh/articles/[...slug].astro` `src/pages/zh/articles/index.astro`

- [ ] **Step 1: 改 Article.astro 顯示新 schema 欄位**

修改 `src/layouts/Article.astro`：頁首顯示 `title`；TLDR 區塊顯示 `tldr`（可摘錄答案句）；分歧區塊以並列/表格呈現 `anchorCulture` vs `comparedCultures`（標 `suspectCultures` 為存疑對照）；FAQ 區塊由 `faq[]` 產 FAQPage JSON-LD；頁尾**生成揭露署名**顯示 `writeModel`/`critiqueModel`/`generatedDate`/`sources`；Article+BreadcrumbList JSON-LD。

- [ ] **Step 2: 建文章動態路由頁**

`src/pages/zh/articles/[...slug].astro`：
```astro
---
import { getCollection, render } from 'astro:content';
import Article from '../../../layouts/Article.astro';

export async function getStaticPaths() {
  const posts = await getCollection('articles', (e) => e.data.lang === 'zh' && !e.data.draft);
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}
const { post } = Astro.props;
const { Content } = await render(post);
---
<Article frontmatter={post.data}>
  <Content />
</Article>
```

- [ ] **Step 3: 建文章列表頁**

`src/pages/zh/articles/index.astro`：用 `getCollection('articles')` 過濾 `lang==='zh' && !draft`，依 `generatedDate` 排序，套 `List.astro` 卡片版型。

- [ ] **Step 4: 暫無文章時 build 不應崩**

Run: `pnpm build 2>&1 | tail -20`
Expected: build 成功（articles 為空集合也能過；若報錯記錄並修正路徑/import）。

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Article.astro src/layouts/List.astro src/pages/zh/articles
git commit -m "feat: 文章版型與列表接上 articles collection"
```

---

## Task 7：手寫示範文章（exercise 全 schema）

**Files:**
- Create: `src/content/articles/_seed-overtime-asia-vs-nordic.md`

- [ ] **Step 1: 寫示範文章 frontmatter + 內文**

`src/content/articles/_seed-overtime-asia-vs-nordic.md`：
```markdown
---
title: "為什麼東亞把加班當責任、北歐當管理失敗"
description: "一個 AI 觀察者俯瞰加班態度的跨文化分歧——同一件事，兩種合理。"
tldr: "加班在東亞常被讀成責任與投入，在北歐常被讀成管理失敗；兩種看法都源於各自的勞動與制度處境，無關誰對誰錯。"
domainTopic: "overtime"
tags: ["加班", "勞動文化", "工時"]
anchorCulture: "Nordic"
comparedCultures: ["East Asia", "United States"]
suspectCultures: []
factCategory: "B"
stanceRiskLevel: "low"
sources:
  - title: "OECD Average annual hours actually worked"
    url: "https://data.oecd.org/emp/hours-worked.htm"
    region: "OECD"
    language: "en"
    credibility: "high"
  - title: "World Values Survey Wave 7 — Work attitudes"
    url: "https://www.worldvaluessurvey.org/"
    region: "Global"
    language: "en"
    credibility: "high"
writeModel: "seed-hand-authored"
critiqueModel: "seed-hand-authored"
pipelineVersion: "0.0.0-seed"
specVersion: "base-md-v1"
generatedDate: 2026-06-09
updatedDate: 2026-06-09
coverC2paVerified: false
faq:
  - q: "東亞的加班一定比北歐多嗎？"
    a: "從 OECD 工時資料看，部分東亞經濟體年均工時確實高於北歐，但本文重點不在多寡，而在『加班被賦予的意義』為何不同。"
  - q: "這是在說哪種文化比較好嗎？"
    a: "不是。我作為一個 AI 觀察者，只呈現不同處境下為何會合理地想得不一樣，不評判對錯。"
lang: "zh"
draft: false
---

> 註：此為 Phase 1 手寫示範文章，生成資訊欄位標為 seed；Phase 6 將以走完整 pipeline 的文章取代。

我作為一個不長在任何單一文化裡的觀察者，注意到「加班」這件事實本身沒有爭議——它就是在約定工時之外繼續工作。有爭議的，是不同處境的人賦予它的**意義**。

## 站在北歐的處境

在北歐的制度處境下，工時受集體協商與法規嚴格框定，準時下班被視為效率與信任的證明。於是加班傾向被讀成一個訊號：**是不是哪裡的管理或人力配置出了問題？**

## 站在東亞的處境

在東亞許多經濟體的處境下，快速工業化的歷史、團隊責任的倫理、以及以投入度衡量貢獻的職場慣例，使加班更容易被讀成**責任感與承擔**的表現。

## 站在這個分歧之上

兩種讀法各自在自己的處境裡都成立。我不需要選一邊——我注意到的是：同一個無爭議的事實，會因為制度與歷史的不同，長出兩種同樣合理的態度。
```

- [ ] **Step 2: build 並確認文章頁產出、schema 通過**

Run: `pnpm build 2>&1 | tail -20 && ls dist/zh/articles/`
Expected: build 成功，`dist/zh/articles/_seed-overtime-asia-vs-nordic/` 存在。

- [ ] **Step 3: Commit**

```bash
git add src/content/articles/_seed-overtime-asia-vs-nordic.md
git commit -m "content: 手寫示範文章（加班的跨文化分歧）exercise 全 schema"
```

---

## Task 8：部署 workflow 與挑刺腳本骨架

**Files:**
- Copy+modify: `.github/workflows/deploy.yml` `docs-sync-check.yml`
- Copy+modify: `scripts/audit-ai-tone.mjs` `scripts/generate-favicons.mjs`

- [ ] **Step 1: 複製 workflow 與腳本（排除 youtube/myth 專屬）**

```bash
SRC=/Users/lightman/weiqi.kids/evidencetoday.news
mkdir -p .github/workflows scripts
cp "$SRC"/.github/workflows/{deploy.yml,docs-sync-check.yml} .github/workflows/
cp "$SRC"/scripts/{audit-ai-tone.mjs,generate-favicons.mjs} scripts/
```

- [ ] **Step 2: 改 deploy.yml（移除 youtube sync 與 prebuild）**

修改 `.github/workflows/deploy.yml`：移除 `YOUTUBE_*` env、移除每小時 cron（Phase 3 再加引擎排程）、移除 `sync:youtube` 相關步驟，保留 pnpm build → pagefind postbuild → deploy-pages。site 改 allmoneyback.me。

- [ ] **Step 3: 改 audit-ai-tone.mjs 掃描範圍**

修改 `scripts/audit-ai-tone.mjs`：掃描路徑由 myths/ingredients 改為 `src/content/articles`；移除健康專屬模糊引用詞；保留 AI 感句型偵測（Phase 3 再擴充「本質化/嘲諷/偏向」立場事故偵測）。

- [ ] **Step 4: 本機跑挑刺腳本確認可執行**

Run: `pnpm run content:audit 2>&1 | tail -10`
Expected: 對示範文章執行完成（warning 模式不阻擋），無 crash。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows scripts
git commit -m "ci: 部署 workflow 與挑刺腳本骨架（移除媒體專屬流程）"
```

---

## Task 9：清理驗收、README/AGENTS、CNAME、最終 build

**Files:**
- Create: `README.md` `AGENTS.md`
- Modify: `public/CNAME`

- [ ] **Step 1: 寫 CNAME**

`public/CNAME`：
```
allmoneyback.me
```

- [ ] **Step 2: 寫 README.md 與 AGENTS.md**

`README.md`：專案定位（AI 跨文化觀察站・金錢與工作）、技術棧、本機開發指令、專案結構、Phase 路線圖、修改紀律（沿用 docs-sync）。
`AGENTS.md`：agent 紀律（pnpm、改功能須同步文件、後續 pipeline 任務指令佔位、嚴守 AI 觀察者人稱與 B 類選題）。

- [ ] **Step 3: 全域殘留掃描（驗收關卡）**

Run: `grep -rniE "evidencetoday|firstory|medical-disclaimer|迷思|闢謠|ingredient" src public scripts .github README.md AGENTS.md astro.config.mjs package.json | grep -v "node_modules" || echo "CLEAN"`
Expected: `CLEAN`（若有殘留，逐一清掉再重跑）。

- [ ] **Step 4: 跑全測試 + 全 build（最終驗收）**

Run: `pnpm vitest run && pnpm build 2>&1 | tail -25`
Expected: 測試全綠；build 成功；`dist/` 含 `zh/`、`zh/articles/`、`sitemap-index.xml`、`og`（OG 圖）、pagefind 索引。

- [ ] **Step 5: 確認 OG 圖實際產出**

Run: `ls dist/og/ 2>/dev/null && echo "OG ok" || echo "OG MISSING — 檢查 og-template 路由"`
Expected: `OG ok`。

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md public/CNAME
git commit -m "docs: README/AGENTS + CNAME，Phase 1 bootstrap 完成"
```

---

## Phase 1 驗收標準（DoD）

- [ ] `pnpm install` / `pnpm build` / `pnpm vitest run` 全綠。
- [ ] `dist/` 產出主題化首頁、`/zh/` 結構、文章頁、OG 圖、sitemap、pagefind 索引。
- [ ] 全域殘留掃描 `CLEAN`（無 evidencetoday/健康/媒體痕跡）。
- [ ] `articles` schema 拒絕 A 類（`factCategory` 只允許 B）、拒絕缺欄位，測試覆蓋。
- [ ] 示範文章人稱為 AI 觀察者、呈現分歧不評判、走過全 schema 欄位。
- [ ] 雙語結構（`/zh/` 實體 + hreflang 標記）就位，起步只發繁中。
- [ ] 設計 tokens re-theme，非 evidencetoday 健康色，呼應中立 AI 觀察者調性。

> Phase 1 完成後，依現實撰寫 Phase 2 計畫（選題/定錨/撰寫引擎 + 抓取層）。
