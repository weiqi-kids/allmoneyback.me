# allmoneyback.me — AI 跨文化分歧觀察站（金錢與工作）設計文件

- 領域：金錢與工作
- 網址：https://allmoneyback.me
- 規格版本：base-md v1 + 本設計
- 日期：2026-06-09

---

## 0. 定位（不可動搖的靈魂）

敘事主體是 **AI 本身**——一個不長在任何單一文化、站在所有人群看法之上俯瞰分歧的觀察者。這是唯一無法被人類部落客複製的護城河。

- 寫作人稱固定為 **AI 觀察者**：「我觀察到」「在 A 文化的處境下，傾向於……」「站在這個分歧之上，我注意到……」。不假裝國籍人類作者，不用無主詞客觀腔。
- 每篇：**事實無爭議、態度因文化處境而異、不評判誰對誰錯**。
- 核心句型：「A 文化因為（某種處境／歷史／經濟結構），傾向這樣想；B 文化因為（另一種處境），傾向那樣想。」
- 策略：**選題盡量戳（張力拉滿）、寫法嚴格中立（零立場事故）**。爭議分兩種——「話題張力」是金礦（要追求，來自選題），「立場事故」是地雷（要避免，來自寫法）。

### B 類 vs A 類（選題生死線）
- **B 類（要做）**：事實無爭議，態度因文化／處境不同。例：對加班、負債、退休的態度。
- **A 類（禁止）**：事實本身有爭議（數據真偽、衝突敘事、科學否認）→ 會逼出假平衡、被降權。
- 任何選題進生產前必過 B/A 判定；判為 A 或無法確定 → 直接丟棄。**判定保守，寧可錯殺。**

---

## 1. 三個定案決策（本次 build 的前提）

1. **程式起點 = fork 姊妹站 `evidencetoday.news`**：複製其已驗證資產為模板，但 allmoneyback.me 為**完全獨立 repo，與 evidencetoday.news 零關聯**（不做 monorepo、不互相耦合、移除所有 evidencetoday 品牌/健康/YouTube/Podcast 痕跡）。
2. **獨立 repo，不做 monorepo**：md 10.7 的「三站共用引擎」以「可複製前進的模板 + 領域設定檔」精神落地，不強行把姊妹站搬進 monorepo。
3. **pipeline 觸發 = GitHub Actions 排程驅動**：沿用姊妹站「cron 排程 + Actions 跑腳本」模式，外部 API 不可得處用標記清楚的 stub。

---

## 2. 程式起點：fork 哪些、改哪些、建哪些

來源專案：`/Users/lightman/weiqi.kids/evidencetoday.news`（Astro 5 靜態站、GitHub Pages 部署、pnpm、satori OG、pagefind 搜尋、JSON-LD/llms.txt、content-audit 挑刺腳本、docs-sync 紀律、oklch design tokens + Noto Serif/Sans TC）。

### 2.1 直接沿用（複製後僅改 site URL / 品牌）
- Astro 5 靜態骨架、`astro.config.mjs` 結構、`@astrojs/sitemap`（filter 排除 admin）、`@astrojs/mdx`、`@astrojs/svelte`。
- satori OG 圖生成（`og-template.ts` / `og-fonts.ts`）、TTF 自託管字型。
- pagefind 站內搜尋（postbuild）。
- GitHub Pages 部署 workflow（`deploy.yml` 結構：pnpm build → lychee 連結檢查 → lighthouse → deploy-pages）。
- JSON-LD 元件、llms.txt / llms-full.txt、各內容頁 `.txt` endpoint（AI 爬蟲友善）、robots.txt（含 AI bot 白名單）。
- `docs-sync-check.yml` 修改紀律、playbook 文件結構。
- oklch design token 系統、fluid clamp 間距、卡片元件語言。

### 2.2 改主題
- Content collection：由健康/迷思型改為「跨文化分歧文章」型（見 §3）。
- 撰寫/挑刺腳本：禁詞與檢測項改為金錢與工作 + 立場事故維度（見 §5）。
- 配色 palette、品牌文案、政策頁、about 頁（AI 觀察者定位）。
- 抓取設定檔的查詢與來源白名單（見 §4.1）。

### 2.3 完全新建（姊妹站沒有）
- 自主**選題引擎**（AI 觀察者視角偵測分歧）。
- **資料可得性定錨**演算法。
- **雙 AI 挑刺對抗**迴圈（撰寫/挑刺指令分離）。
- **立場事故風險分流**（`_review/` + 自動開 GitHub issue）。
- **GA4** 埋點 + Data API 讀取 + 異常訊號 + 好題回饋。
- **C2PA** 保留 + build 時逐張驗證。
- **zh/en 雙語架構**（hreflang，起步只發繁中）。
- 每篇**生成資訊 frontmatter** 在生成當下自動寫入。

---

## 3. Content collection + frontmatter schema

主 collection：`articles`（跨文化分歧文章）。所有引擎判定與生成資訊欄位由 pipeline **在生成當下自動寫入**，**絕不寫死在模板**。

| 群組 | 欄位 | 說明 |
|---|---|---|
| 內容 | `title` `description` `tldr` `domainTopic` `tags` | `tldr`=可摘錄答案句；`domainTopic`=金錢與工作子題 |
| 引擎判定 | `anchorCulture` `comparedCultures[]` `suspectCultures[]` `factCategory` `stanceRiskLevel` `sources[]` | `comparedCultures` 2–4 個；`suspectCultures`=資料黑箱存疑對照；`factCategory`=B/A 標籤；`stanceRiskLevel`=low/high；`sources[]` 每筆含地區/語言/可信度 |
| 生成資訊（不寫死） | `writeModel` `critiqueModel` `pipelineVersion` `specVersion` `generatedDate` `updatedDate` | 生成當下捕捉真正使用的引擎 |
| 配圖 | `coverImage` `coverC2paVerified` | C2PA 驗證旗標 |
| 結構化 | `faq[]` | 服務 FAQPage rich result |

退回狀態：湊不出穩定錨點或證據不足 → 標「資料不足」退回，不進生產。

---

## 4. 九層 pipeline（GitHub Actions 排程驅動）

cron 觸發，Actions 跑各層腳本。文字引擎預設 Anthropic（Claude，多步可分工不同模型），圖像用 OpenAI Image 2。金鑰一律走環境變數 / GitHub secret。

1. **抓取層**：定期抓「來源白名單」→ 存結構化資料 + metadata（地區/語言/來源可信度）。
   - 白名單起點：Pew Research、World Values Survey、OECD 社會與勞動調查、各國統計局家計/勞動調查、可信跨文化學術研究、授權多語論述。再依金錢與工作增補。
   - **抓取現實邊界（md 10.5）**：能合法穩定取得者做真實抓取；其餘做**標記清楚的 stub + TODO**，不假裝能爬；不爬有 ToS/著作權疑慮來源。
   - 起步資料存 JSON/SQLite，需語意檢索再加向量庫。
2. **選題引擎（大腦）**：AI 以觀察者視角掃新進多語資料，偵測「夠戳但事實無爭議」的分歧 → 結構化輸出（題目 + B/A 標籤 + 風險標籤 + 錨點/對照建議）。**B/A 判定保守。**
3. **定錨**：**錨點是算出來的，不是選出來的**——依該題各文化資料豐度/可信度，自動挑「資料最穩、最一手」者當錨點，其餘可信者當對照，資料黑箱者標「存疑對照」（無資格當錨點）。湊不出穩定錨點 → 退回標「資料不足」。
4. **撈證據**：只能從白名單撈，不足 → 退回標「資料不足」，禁杜撰。
5. **撰寫 AI**：固定模板 + AI 主體人稱，題目寫出張力 + 嚴守中立。
6. **挑刺 AI**：見 §5。
7. **風險分流**：見 §5。
8. **配圖**：見 §7。
9. **發布**：輸出 Markdown + frontmatter（含生成資訊）→ git commit & push → Actions build & deploy。
10. **監測**：見 §8。

---

## 5. 雙 AI 對抗 + 風險分流

- **撰寫 AI 與挑刺 AI 用完全不同指令**，不共用盲點。撰寫 AI：題目張力滿 + 嚴守中立模板。挑刺 AI：扮演攻擊者，專找「把文化本質化／嘲諷某方／偏向某方」。迴圈修訂直到挑刺 AI 通過，全自動。
- **風險分流對象 = 立場事故風險（寫法），不是題目戳度**：
  - 立場事故風險 **低** → 直接進發布，站長不用看。
  - 立場事故風險 **高**（碰宗教/族群/政治化敏感維度且寫法可能出包）→ 寫進 repo `_review/` 草稿夾 **且自動開一則 GitHub issue 標記待審**（md 10.6）。
- 流量報告固定附「待審件數」，確保高風險不無聲堆積。

---

## 6. 前端設計

- 沿用姊妹站克制、可信、不像內容農場的 design token 系統與 Noto Serif/Sans TC 字體。
- **換主色 palette** 成金錢與工作站的中立專業調性；動工前先讀 `/mnt/skills/public/frontend-design/SKILL.md` 再定色，避免套版預設感。
- 調性呼應「中立俯瞰的 AI 觀察者」——克制、清晰、可信，不花俏。
- 比較式內容用清楚並列/表格結構（同時服務 AEO）。

---

## 7. 配圖 + C2PA（強制）

- OpenAI Image 2 生圖，出廠即帶 **C2PA Content Credentials + SynthID**，pipeline 首要任務是**完整保留、不洗掉**。
- **關鍵陷阱**：Astro 圖片最佳化（webp/avif/壓縮/resize）極可能剝除 C2PA manifest。最佳化流程必須**保留或重新簽署** C2PA，**build 時逐張驗證憑證仍在**；憑證遺失 = build 失敗 / 退回，不發布無溯源 AI 圖。
- OG 圖同屬程式產出，附可辨識「AI 產生」標記與（可行時）C2PA。
- **可見標記**：AI 配圖頁面上以圖說/角標明示「AI 生成圖（OpenAI）」。
- **文字**：C2PA 對純文字未成熟，以生成資訊揭露（frontmatter + 可見署名 + JSON-LD）為強制揭露。

---

## 8. SEO / AEO / JSON-LD / OG + 生成揭露 + 雙語

SEO 是命脈，全自動、不靠人工逐篇補：

- **技術 SEO**：每頁自動 title/meta description/canonical；`sitemap.xml`（@astrojs/sitemap）；robots.txt；語意化 HTML + 正確標題階層；自動內部連結（同題不同文化、相關議題互連）。
- **結構化資料**：每篇 `Article` + `BreadcrumbList`；適用時加 `FAQPage`/`QAPage`。作者欄位 = AI 觀察者本身，據實標示 AI 產出。
- **AEO**：問題式標題、每段開頭給簡潔可摘錄答案句再展開、比較用表格/並列；JSON-LD 同時服務答案引擎。
- **OG/社群卡**：每頁自動 og:title/description/type、twitter:card；**og:image build 時依標題自動生圖**（satori），不靠人工。
- **AI 作者與生成揭露**：about 頁說明 AI 觀察者定位；揭露兩層——①讀者可見（頁尾署名顯示撰寫模型、生成日期、校核模型、來源）；②機器可讀（JSON-LD author/publisher 據實標 AI）。生成資訊**生成當下寫入 frontmatter，不寫死**。
- **雙語架構（md 10.2 已定案）**：第一次 build 即架好 `/zh/`、`/en/` 子目錄結構 + hreflang + 內容模型，**但起步只發繁中**。日後開英文版時，挑刺 AI 須對每個語言版本各跑一次。

---

## 9. GA4 監測 + 好題回饋（必須是可交付程式）

1. **埋點**：GA4 Measurement ID（`G-XXXXXXXX`）透過環境變數/設定檔注入 Astro `<head>`，全站上報。ID 由站長建立後填入，不寫死。
2. **讀取＋分析模組**：GA4 Data API（service account 認證，金鑰走 secret）定期拉資料 → 站長流量報告（整站趨勢、熱門文章、每篇曝光與互動）+ 異常訊號：
   - **互動異常**：用 engagement rate（互動率異常偏低），非傳統 bounce。
   - **流量驟降**：降權早期警報。
   - **降權準確訊號**建議併接 Google Search Console（曝光/點擊/平均排名）為主來源（列 OPERATIONS 手動項）。
   - 報告固定附「待審件數」。
3. **好題回饋**：從表現好文章萃取 frontmatter 特徵（子題、錨點文化、對照組合、風險級別）回灌選題引擎當偏好訊號。「表現好」判準寫成可調設定（互動率 + 停留 + 自然搜尋流量綜合分）。

---

## 10. 交付邊界（md 10.1 已定案）

一次 build = **可端到端跑通的完整 codebase**（非已上線自轉服務）：
- Astro 站台骨架 + 部署設定（含 GitHub Actions workflow）
- 共用引擎全部程式（抓取/選題/定錨/撈證據/撰寫/挑刺/分流/發布/監測；抓取層與外部 API 可為 stub）
- 流量分析機制（GA4 埋點 + 讀取分析 + 好題回饋）
- SEO/AEO/JSON-LD/OG 各層（含自動 sitemap、結構化資料、自動 OG 圖）
- 設定檔（領域範圍、來源白名單、判準與範例）
- **一篇走完整 pipeline 的示範文章**
- 一份 `OPERATIONS.md`（上線必做手動步驟）

發布節奏（md 10.4）：刻意慢、品質優先，起步每週 2–3 篇，寫成可調設定值。

---

## 11. 不在本次 build 範圍的手動項（寫入 OPERATIONS.md）

- **網域 DNS**：registrar 設定 allmoneyback.me 指向 GitHub Pages（build 只產 CNAME 檔）。
- **API 金鑰與 GitHub secrets**：Anthropic、OpenAI、部署 token。
- **GA4 建立與授權**：建 GA4 property 取 Measurement ID；Google Cloud 啟用 GA4 Data API → service account → JSON 金鑰 → GA4 加檢視者 → 存 GitHub secret。
- **Google Search Console**（建議，降權偵測主來源）：驗證擁有權 → 授權同一 service account。
- **排程器主機**：抓取/選題/流量讀取的定期觸發跑在哪（GitHub Actions 排程為預設）。

---

## 12. 驗收標準

- 站長只看流量報告與異常訊號，不逐篇審稿。
- 高立場事故風險文章自動進待審佇列（`_review/` + issue），不裸奔發布。
- 每篇「題目戳 + 寫法穩」，人稱 AI 主體，呈現分歧不評判對錯。
- 無任何 A 類題目混入。
- 引擎參數化、與站名/領域無關，換 `<領域>`+`<URL>` 可長出下一站。
- C2PA 在 build 時逐張驗證通過；生成資訊每篇據實自動寫入。
