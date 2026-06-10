# allmoneyback.me 引擎 Phase 2–6 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Anthropic 整合一律遵 claude-api skill（model `claude-opus-4-8`、adaptive thinking、`messages.parse()`+zod 結構化輸出）。

**Goal:** 建出 spec 的半無人 pipeline 全部引擎程式（抓取→選題→定錨→撈證據→撰寫→挑刺→風險分流→配圖→發布→監測），無外部金鑰時走清楚標記的 stub，有金鑰走真 API；最後交 OPERATIONS.md + 一篇走完整 pipeline 的示範文。

**交付邊界（spec §10.1）：** 完整可端到端跑通的 codebase，非已上線自轉服務。Anthropic（文字）、OpenAI Image 2（圖）、GA4 Data API、GSC、真實來源抓取——金鑰/外部服務不可得處做 stub + TODO。

**技術：** TypeScript 引擎置於 repo 根 `engine/`（Node，CI/cron 執行），用 `tsx` 跑、`vitest` 測試。新增依賴：`@anthropic-ai/sdk`、`openai`、`tsx`。資料存 `engine/data/*.json`（起步 JSON，需語意檢索再加向量庫）。引擎輸出 Markdown 進 `src/content/articles/`。

---

## 引擎模組結構

```
engine/
  lib/
    llm.ts          # Anthropic provider 包裝：messages.parse()+zod；STUB 模式（無 ANTHROPIC_API_KEY 回確定性 canned）；每步模型可設；回傳實際用的 model
    image.ts        # OpenAI Image 2 包裝：STUB 模式（無 OPENAI_API_KEY 回佔位 PNG）；保留 C2PA
    store.ts        # JSON 資料存取（sources / processed / review-queue / feedback）
    git.ts          # commit & push 包裝（CI 用）
    log.ts          # 結構化 log
  config/
    domain.ts       # 金錢與工作 子題範圍 + 選題領域 scope
    sources.ts      # 來源白名單（Pew/WVS/OECD/各國統計局/學術/多語論述）每筆 region/lang/credibility/access(real|stub)
    criteria.ts     # B/A 判準+範例、立場事故風險判準、選題評分權重、發布節奏、好題判準
  fetch/index.ts    # 抓白名單→結構化 store + metadata；real 或 stub+TODO
  select/index.ts   # AI 觀察者視角偵測分歧→結構化（題目+B/A+風險+錨點/對照建議）；B/A 保守
  anchor/index.ts   # 資料可得性定錨演算法；湊不出穩定錨點→退回「資料不足」
  evidence/index.ts # 限白名單撈證據；不足→退回；禁杜撰
  write/index.ts    # 撰寫 AI：固定模板+AI 觀察者人稱+題目張力+嚴守中立→markdown+frontmatter（生成資訊當下寫入）
  critique/index.ts # 挑刺 AI：獨立指令、攻擊本質化/嘲諷/偏向→迴圈修訂直到通過
  route/index.ts    # 風險分流：low→發布；high→_review/ + 開 GitHub issue
  publish/index.ts  # 寫 markdown 進 src/content/articles + commit
  analytics/
    ga4.ts          # GA4 Data API 讀取（STUB 無金鑰）→ 流量報告 + 異常訊號
    feedback.ts     # 好題特徵萃取→回灌 select 偏好
  pipeline.ts       # 編排 fetch→select→anchor→evidence→write→critique→route
  cli.ts            # 指令入口：run-pipeline / fetch / report 等
  schemas.ts        # 引擎用 zod schemas（選題輸出、證據、定錨結果、挑刺結果）
```

設定原則：所有金鑰走 env，不入 repo。STUB 模式由「金鑰是否存在」自動切換，並在 log 與產物明確標記 stub。

---

## Phase 2：抓取/選題/定錨/撈證據/撰寫（產出草稿）

- **E1**：依賴與骨架（`@anthropic-ai/sdk`/`openai`/`tsx`）、`engine/lib/llm.ts`（含 STUB）、`engine/lib/store.ts`、`engine/lib/log.ts`、`engine/schemas.ts`。TDD：llm STUB 確定性、store 讀寫、schema 驗證。
- **E2**：`config/{domain,sources,criteria}.ts` + 來源白名單起始資料 + 驗證測試。
- **E3**：`fetch/index.ts`——對 access=real 來源做真實抓取（能合法穩定者，如有公開 API/資料集），其餘 stub+TODO 產樣品資料進 store；標 metadata。TDD：stub 抓取產出結構正確、不爬 ToS 疑慮源。
- **E4**：`select/index.ts`——掃 store 新資料，LLM（觀察者視角）偵測「夠戳但事實無爭議」分歧→結構化輸出（題目+B/A+風險+錨點/對照建議）。B/A 保守（A 或不確定→丟棄）。TDD（STUB）：A 類被丟、輸出符 schema、去重。
- **E5**：`anchor/index.ts`——依各文化資料豐度/可信度算錨點；資料黑箱→存疑對照；湊不出穩定錨點→「資料不足」。TDD：純函式演算法多案例。
- **E6**：`evidence/index.ts`——限白名單撈證據，多元不足→「資料不足」退回。TDD。
- **E7**：`write/index.ts`——撰寫 AI 產 markdown+frontmatter（生成資訊：writeModel 實際值、pipelineVersion、specVersion、生成日期）。STUB 產可過 schema 的草稿。TDD：frontmatter 通過 articlesSchema、人稱為 AI 觀察者。
- **E8**：`pipeline.ts`（fetch→select→anchor→evidence→write 串起，產草稿物件）+ `cli.ts run-pipeline`。整合測試（STUB 端到端產一篇草稿）。

## Phase 3：挑刺對抗 + 風險分流 + 發布 + Actions 排程

- **E9**：`critique/index.ts`——獨立指令挑刺（本質化/嘲諷/偏向），迴圈修訂直到通過或判高風險。critiqueModel 寫入 frontmatter。TDD（STUB）：迴圈收斂、輸出裁決 schema。
- **E10**：`route/index.ts` + `publish/index.ts`——low→寫進 `src/content/articles/` 並（CI）commit；high→寫 `_review/` 草稿 + 開 GitHub issue（gh CLI / API，stub 當無 token）。TDD：分流邏輯、待審計數。
- **E11**：pipeline 接上 critique+route；`.github/workflows/engine.yml` cron 排程跑 pipeline（dry-run 預設，金鑰由 secret 注入）。

## Phase 4：配圖 + C2PA

- **E12**：`lib/image.ts`——OpenAI Image 2 生文章配圖（STUB 佔位），保留出廠 C2PA+SynthID；AI 圖可見標記。
- **E13**：Astro 圖片最佳化保留/重簽 C2PA + **build 時逐張驗證憑證**（憑證遺失→build 失敗/退回）。`scripts/verify-c2pa.mjs` + 接 build。TDD：驗證腳本對有/無憑證圖的判定。

## Phase 5：GA4 監測 + 好題回饋

- **E14**：GA4 埋點——Measurement ID 由 env 注入 Base.astro `<head>`（無 ID 不輸出）。
- **E15**：`analytics/ga4.ts`——GA4 Data API 讀取（service account，STUB 無金鑰）→站長流量報告 + 異常訊號（互動率異常、流量驟降；GSC 列 OPERATIONS）+ 待審件數。
- **E16**：`analytics/feedback.ts`——好題特徵（子題/錨點/對照/風險級）萃取→回灌 select 偏好（可調判準）。`cli.ts report` 輸出報告。TDD：異常計算、好題評分、回饋寫入。

## Phase 6：OPERATIONS + 驗收 + 全 pipeline 示範文

- **E17**：`OPERATIONS.md`——DNS、API 金鑰與 GitHub secrets、GA4 建立與授權、GSC、排程器主機、DEPLOY_TARGET 上線切換。
- **E18**：以 STUB 模式跑完整 pipeline 產一篇「走完整 pipeline」示範文（標生成資訊為 pipeline-stub），驗證端到端；更新 README 引擎章節。全測試+build 綠收尾。

---

## 驗收標準（全引擎）
- 引擎在無金鑰下 STUB 端到端跑通；有金鑰走真 API（程式同一路徑）。
- B/A 保守（A 類丟棄）、湊不出錨點/證據→退回「資料不足」、不杜撰。
- 挑刺對抗迴圈獨立指令；高立場事故風險→`_review/`+issue，不裸奔。
- 生成資訊每篇生成當下寫入 frontmatter，不寫死。
- C2PA build 時逐張驗證；AI 圖可見標記。
- GA4 埋點+讀取+異常+好題回饋為可交付程式。
- 一篇走完整 pipeline 示範文 + OPERATIONS.md。
