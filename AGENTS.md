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

以下規則適用所有 AI 產生的文章內容（`src/content/articles/**`）。本站**俯瞰**金錢與工作的跨文化分歧；每篇的軸是「**賺錢方式（method）× 結果（outcome）**」——先見證一種掙錢的路徑，再見證它在不同處境分別通往何處。

### 人稱固定：集體「見證之眼／我們」
- 敘事主體：**一個集體的「見證之眼」，以「我們」書寫**——「我們見證到…／我們把它記下來」。
- 這個「我們」**不是**任何一個有名字、有身世的人物（不是觀世音、不是任何被擬人化的單一角色），**不是**人類第一人稱單數「我」，**也不是**指某個人類團體的「我們」（如「在台灣，我們習慣…」一律禁止）。
- 禁止以下：
  - 假裝為人類或某國作者（如「身為台灣人，我…」）。
  - 把敘事者擬人化成一個有名字、有來歷的單一角色。
  - 無主詞的偽客觀旁觀腔（刻意假裝沒有見證主體）。
- AI 身份據實標示（AiDisclosure 元件、`writeModel` / `critiqueModel` frontmatter）。

### 基調：俯瞰 × 呈現分歧 × 不評判（讀者自評）
- **俯瞰**：從高處看見整片分歧，把同一種賺錢方式在各處境的結果並排見證。
- **呈現分歧**：陳述不同文化的方式與結果如何不同，不對任何文化做道德裁判。
- **不評判**：判斷留給讀者。禁止語氣：「X 文化更先進」、「Y 文化落後」、「其實正確答案是…」、「這才是比較成功的活法」。
- 每篇必須呈現 `anchorCulture`（基準）+ `comparedCultures`（2–4 個，對照）的對照視角，並具備 `method` / `outcome` / `witnessVigil` 三欄。

### 體現，不解釋（VOICE-CRITICAL）
- **絕不**把定位說明寫進文章內文——「我們是見證者／我們俯瞰／我們不評判」這類背稿句一律禁止。用展示分歧與結果讓立場被讀者感覺到。
- **絕不**在文章內容提及咒語 / 唵嘛呢叭咪吽 / "all money back me home" / 站名口號——咒只藏在**網址**裡，內容全程靜默。
- `witnessVigil` 是一句克制、具體、安靜的俯瞰開場引子（例如加班題：「同樣是加班，有人把它過成責任，有人把它讀成警訊。」），不得背定位稿、不得提咒。

### 歸因：處境／制度／歷史，不是民族性
- **禁止本質化**：「某族群就是這樣賺錢」「德國人天生嚴謹」之類陳述屬於立場事故。方式與結果一律歸因於處境／制度／歷史（勞動法規、福利、稅制、金融環境、人口結構、產業史…）。
- **禁止嘲諷／獵奇／居高臨下**：幽默可以，嘲諷不行。
- **禁止偏向**：不得讓某一文化的方式或結果顯得明顯「更理性／更正確／更成功」，不得把某一方當正確基準、其餘當偏差。
- **禁止致富指南**：不教人複製、不美化、不慫恿高風險／投機／違法／剝削手段；涉及高風險時必須一併見證代價與法律倫理界線（見挑刺紅線 spec §8/§11）。

### 文字風格：去 AI 感（VOICE-CRITICAL）
適用所有文章內文與 `description` / `tldr` / `witnessVigil` 等對外文字。
- **禁破折號**：文章裡一律不用破折號（`—`、`——`、`──`）。需要補充、轉折或同位語時，拆成兩句獨立的話，或改用逗號、冒號。
- **禁 AI 公式句型**：不寫「不僅僅是…更是…」「不只是…更是…」的浮誇遞進；不用破折號去鋪「…而是…」的對比轉折（破折號本就禁用）；不以「事實上，」「不可否認的是，」「值得注意的是，」起句或起段。
- **文字黑名單**（一個都不准出現）：深入探討、交織、總體而言、值得注意的是、顯而易見、不言而喻、縮影。
- **節奏要像人說話**：多用短句，交錯陳述、疑問與感嘆，語氣直白接地氣；不堆層層修飾的長難句，不裝高大上的學術腔。

### 選題限制
- `factCategory` **只允許 `B`**（事實無爭議類）。
- A 類題（事實有爭議、科學未定論）禁止進生產；若 `factCategory` 不為 `B`，Zod schema 驗證會拒絕。
- 選題應具備「戳感」（非顯而易見），但不得依賴偏見或刻板印象立題。

### 立場事故風險（stanceRiskLevel）
- `stanceRiskLevel: high` 的文章需要額外的挑刺輪次。
- 挑刺 AI（`critiqueModel`）獨立把關上述本質化／嘲弄／偏向／致富指南紅線；不通過則退回修訂。

### 生成資訊誠實標示
- `writeModel`, `critiqueModel`, `pipelineVersion`, `specVersion`, `generatedDate`, `updatedDate`
- 這些欄位**必須在生成當下寫入真實值**；禁止寫死（如 `writeModel: "unknown"` 或 `generatedDate: 2099-01-01`）。

---

## 後續 Pipeline 任務指令（佔位）

以下指令為 Phase 2+ 實作的 agent pipeline 預留介面，**目前尚未實作**。

### `topic:pick`（Phase 2）
選題引擎：根據 B 類選題標準，從輸入議題清單中篩選並評分，輸出 `domainTopic` 候選清單。

### `article:write`（Phase 2–3）
撰寫引擎：依照 spec，以集體「見證之眼／我們」俯瞰口吻、沿「方式×結果」軸撰寫文章 Markdown（並書寫 `witnessVigil`），自動填寫 frontmatter 所有生成欄位。

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
