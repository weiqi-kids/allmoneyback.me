# AGENTS.md — 錢途 allmoneyback.me

自動化 agent 與 AI pipeline 操作規範。本文件是 **規則文件**，非描述文件；每條規則都有可驗證的違規後果。

---

## 套件管理

**pnpm（非 npm）**。

- 安裝：`pnpm install`
- 新增依賴：`pnpm add <pkg>` / `pnpm add -D <pkg>`
- 建置：`pnpm build`
- 嚴禁使用 `npm install`、`npm ci`、`yarn`。

---

## 修改紀律

`docs-sync-check.yml` 在每個 PR 自動執行：

- 功能程式碼路徑（`src/`, `scripts/`, `.github/workflows/`, `astro.config.mjs`, `package.json`）有異動時，**必須同步更新 README.md、AGENTS.md 或 `docs/`**。
- 未更新文件 → CI 擋 PR，合併失敗。
- 例外：PR body 或任一 commit message 含 `[skip docs]`（純測試、輕微 config 微調、typo 修正）。

**Agent 寫功能程式碼時，必須在同一 PR 更新對應文件；不得仰賴事後補文件的工作流程。**

---

## 寫作鐵律

以下規則適用所有 AI 產生的文章內容（`src/content/articles/**`）：

### 人稱固定
- 敘事主體：**AI 觀察者**，採第一人稱「我」的觀察視角。
- **必須**使用 AI 觀察者第一人稱：「我作為一個（AI）觀察者…」、「我注意到…」。這是本站定位的核心，示範文章即為正確範例。
- 禁止以下（與正確的 AI 觀察者第一人稱無關）：
  - 假裝為人類或某國作者（如「身為台灣人，我…」）。
  - 無主詞的偽客觀腔（刻意隱去觀察者、假裝沒有敘事主體）。
  - 暗示人類群體歸屬的第一人稱複數「我們」（如「在台灣，我們習慣…」）；「我們」若指人類在團體，禁止。
- AI 身份必須據實標示（AiDisclosure 元件、writeModel / critiqueModel frontmatter）。

### 選題限制
- `factCategory` **只允許 `B`**（事實無爭議類）。
- A 類題（事實有爭議、科學未定論）禁止進生產；若 factCategory 不為 `B`，Zod schema 驗證會拒絕。
- 選題應具備「戳感」（非顯而易見），但不得依賴偏見或刻板印象立題。

### 呈現分歧，不評判
- 文章目的是**陳述不同文化的觀點差異**，不得對任何文化做道德裁判。
- 禁止語氣：「X 文化更先進」、「Y 文化落後」、「其實正確答案是…」。
- 每篇必須呈現 `anchorCulture` + `comparedCultures`（2–4 個）的對比視角。

### 立場事故風險（stanceRiskLevel）
- `stanceRiskLevel: high` 的文章需要額外的挑刺輪次。
- **禁止本質化**：「德國人天生嚴謹」之類陳述屬於立場事故。
- **禁止嘲諷**：幽默可以，嘲諷不行。
- **禁止偏向**：不得讓某一文化顯得明顯「更理性」或「更正確」。

### 生成資訊誠實標示
- `writeModel`, `critiqueModel`, `pipelineVersion`, `specVersion`, `generatedDate`, `updatedDate`
- 這些欄位**必須在生成當下寫入真實值**；禁止寫死（如 `writeModel: "unknown"` 或 `generatedDate: 2099-01-01`）。

---

## 後續 Pipeline 任務指令（佔位）

以下指令為 Phase 2+ 實作的 agent pipeline 預留介面，**目前尚未實作**。

### `topic:pick`（Phase 2）
選題引擎：根據 B 類選題標準，從輸入議題清單中篩選並評分，輸出 `domainTopic` 候選清單。

### `article:write`（Phase 2–3）
撰寫引擎：依照 spec，以 AI 觀察者視角撰寫文章 Markdown，自動填寫 frontmatter 所有生成欄位。

### `article:critique`（Phase 3）
挑刺引擎（雙 AI 對抗）：由第二個模型（`critiqueModel`）審查 `article:write` 輸出，標記立場事故、模糊引用、AI 感句型；不通過則退回重寫。

### `article:route`（Phase 3）
分流決策：依挑刺結果決定文章直送生產、退回修改或丟棄。`stanceRiskLevel: high` 觸發額外審查輪次。

### `source:fetch`（Phase 2）
來源抓取：將 frontmatter `sources[]` 中的佔位 URL 替換為真實驗證過的來源，並更新 `credibility` 評估。

---

## CI 驗收門檻

每個 PR merge 前須通過：

1. `pnpm vitest run` — 全部測試通過
2. `pnpm astro check` — 0 型別錯誤（hint 可接受）
3. `pnpm build` — 建置成功，dist/ 完整輸出
4. `docs-sync-check` — 文件同步（或含 `[skip docs]`）
5. 殘留掃描（見 README 驗收流程）— 無 sibling-branded 字串外洩
