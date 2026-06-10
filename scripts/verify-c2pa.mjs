/**
 * scripts/verify-c2pa.mjs
 * E13：build-time C2PA Content Credentials 驗證（manifest 存在性掃描）。
 *
 * 背景（spec §10.9）：
 *   AI 封面圖出廠即內嵌 C2PA Content Credentials（OpenAI gpt-image-1）。
 *   E12 已確保封面以 plain <img>（原封 bytes，不經 Astro optimizer）出貨到 dist，
 *   理論上 manifest 應完整保留。本步驟在 build 時「驗證」每張宣稱已驗證的封面
 *   （frontmatter.coverC2paVerified === true）確實仍帶 C2PA manifest；
 *   只要任一張缺憑證 → build 失敗（process.exit(1)），避免悄悄出貨無憑證圖。
 *
 * ⚠️ 限制（presence check，非完整密碼學驗證）：
 *   本實作為「存在性掃描」（presence heuristic）——只確認檔案 bytes 內出現
 *   C2PA / JUMBF 的特徵標記，並「不」做：
 *     - JUMBF 盒結構的完整 parse
 *     - manifest 簽章鏈（X.509）驗章
 *     - claim/assertion hash 與實際 bytes 的綁定校驗
 *   理由：c2pa-node / c2patool 為重量級 native binary，於本環境可能無法建置，
 *   刻意不引入以免 build 變脆。存在性掃描足以攔截「Astro 最佳化把整個
 *   manifest 剝掉」這個本任務最關心的退化情境。
 *   TODO(upgrade): 待環境支援時，改用 `c2pa-node` 做完整 cryptographic validation
 *   （驗簽 + hard-binding 校驗），取代下方 hasC2paManifest 的 byte 掃描。
 *
 * 掃描的確切標記（見 hasC2paManifest）：
 *   必要：ASCII 子字串 `c2pa`
 *   且至少一個：`jumb`（JUMBF superbox type）/ `jumd`（JUMBF description box type）
 *               / `cai`（C2PA/CAI label 前綴）/ `contentauth`（contentauthenticity URN 片段）
 *   兩者皆滿足才判定「帶 manifest」。
 *
 * 用法：
 *   node scripts/verify-c2pa.mjs        # 跑 verifyArticleCovers，印報告，缺憑證則 exit 1
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

/** C2PA 主標記：所有 C2PA manifest 必含的 ASCII 字串。 */
const C2PA_PRIMARY = 'c2pa';
/** JUMBF / CAI 次標記：滿足其一即可（連同 C2PA_PRIMARY 一起構成判定）。 */
const C2PA_SECONDARY = ['jumb', 'jumd', 'cai', 'contentauth'];

/**
 * C2PA manifest 存在性掃描（presence heuristic，非完整驗證——見檔頭限制）。
 *
 * 判定：buffer 的 latin1 視圖同時包含
 *   (1) `c2pa`，且
 *   (2) `jumb` / `jumd` / `cai` / `contentauth` 之一。
 *
 * C2PA 在 JPEG/PNG 以 JUMBF superbox 內嵌；superbox/description box 的 type 欄
 * 會出現 `jumb`/`jumd` 四字節 box type，manifest store 的 label 含 `c2pa`、
 * assertion/claim 標籤含 `c2pa.` 與 contentauthenticity URN 片段。以 latin1
 * 解讀 bytes 可直接子字串比對而不受 UTF-8 多字節影響。
 *
 * @param {Buffer} buf 影像檔 bytes
 * @returns {boolean}
 */
export function hasC2paManifest(buf) {
  if (!buf || buf.length === 0) return false;
  // latin1：1 byte ↔ 1 char，保證 ASCII 標記在 byte 流任意位置都能比中。
  const text = buf.toString('latin1');
  if (!text.includes(C2PA_PRIMARY)) return false;
  return C2PA_SECONDARY.some((marker) => text.includes(marker));
}

/** 解析 `---` fenced frontmatter，回傳物件（無 frontmatter → null）。 */
function parseFrontmatter(raw) {
  // 容忍開頭 BOM / 前導空白。
  const text = raw.replace(/^﻿/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const data = yaml.load(match[1]);
  return data && typeof data === 'object' ? data : null;
}

/** 收集 contentDir 下所有 .md / .mdx 檔（遞迴，跳過 _covers 等非文章子目錄亦無妨）。 */
function collectArticleFiles(contentDir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(contentDir, { withFileTypes: true });
  } catch {
    return out; // 目錄不存在 → 沒有文章，回空（current repo 仍可能命中真實目錄）。
  }
  for (const entry of entries) {
    const p = path.join(contentDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectArticleFiles(p));
      continue;
    }
    if (entry.isFile() && (p.endsWith('.md') || p.endsWith('.mdx'))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 在 distDir/_astro 下，找出 basename 以 <slug> 起頭的影像檔。
 * Astro 會把 image() 引用的資產輸出成 dist/_astro/<原basename>.<hash>.<ext>，
 * 保留原 basename 作為前綴，故可用 slug 前綴比對。回傳所有命中的絕對路徑。
 */
function findDistCovers(distDir, slug) {
  const astroDir = path.join(distDir, '_astro');
  let entries;
  try {
    entries = readdirSync(astroDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // <slug>.<hash>.<ext>：basename 去掉副檔名後，第一段（hash 前）需等於 slug。
    const name = entry.name;
    const firstDot = name.indexOf('.');
    const stem = firstDot === -1 ? name : name.slice(0, firstDot);
    if (stem === slug) out.push(path.join(astroDir, entry.name));
  }
  return out;
}

/**
 * 驗證所有「宣稱已驗證」（coverC2paVerified===true）的封面仍帶 C2PA manifest。
 *
 * 對每篇命中的文章：
 *   - 解析 coverImage 相對路徑，定位 SOURCE 圖（src/content/articles/ 下）。
 *     source 缺檔或缺 manifest → failure。
 *   - 若 distDir 存在對應的已建置封面（dist/_astro/<slug>.*），亦檢查其 bytes
 *     仍帶 manifest——這是 Astro 最佳化可能剝掉 manifest 的把關點。dist 命中但
 *     缺 manifest → failure；dist 無對應檔（尚未 build）→ 不視為 failure（只驗 source）。
 *
 * coverC2paVerified 非 true 或無 coverImage 的文章 → 跳過（未宣稱已憑證，無可驗）。
 *
 * @param {{contentDir?:string, distDir?:string}} [opts]
 * @returns {Promise<{ok:boolean, checked:number, failures:Array<{slug:string,reason:string}>}>}
 */
export async function verifyArticleCovers(opts = {}) {
  const contentDir = opts.contentDir ?? 'src/content/articles';
  const distDir = opts.distDir ?? 'dist';

  const files = collectArticleFiles(contentDir);
  const failures = [];
  let checked = 0;

  for (const file of files) {
    let fm;
    try {
      fm = parseFrontmatter(readFileSync(file, 'utf8'));
    } catch (err) {
      // frontmatter 壞掉不是本任務職責，但別讓它靜默吞掉——記為 failure。
      const slug = path.basename(file).replace(/\.(md|mdx)$/, '');
      failures.push({ slug, reason: `frontmatter 解析失敗：${err?.message ?? err}` });
      continue;
    }
    if (!fm) continue;

    const claimed = fm.coverC2paVerified === true;
    const coverImage = typeof fm.coverImage === 'string' ? fm.coverImage : undefined;

    // 未宣稱已憑證，或根本沒有 coverImage → 不需驗證，跳過。
    if (!claimed || !coverImage) continue;

    checked += 1;
    const slug = path.basename(file).replace(/\.(md|mdx)$/, '');

    // SOURCE 圖：coverImage 是相對於該 md 檔所在目錄的路徑。
    const sourcePath = path.resolve(path.dirname(file), coverImage);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      failures.push({ slug, reason: `來源封面檔不存在：${coverImage}` });
      continue;
    }
    if (!hasC2paManifest(readFileSync(sourcePath))) {
      failures.push({
        slug,
        reason: `來源封面缺少 C2PA manifest（presence check 失敗）：${coverImage}`,
      });
      continue;
    }

    // DIST 圖（若已 build）：把關 Astro 最佳化是否剝掉 manifest。
    const distCovers = findDistCovers(distDir, slug);
    for (const distPath of distCovers) {
      if (!hasC2paManifest(readFileSync(distPath))) {
        failures.push({
          slug,
          reason: `已建置封面缺少 C2PA manifest（疑似最佳化剝離）：${path.relative(distDir, distPath)}`,
        });
      }
    }
  }

  return { ok: failures.length === 0, checked, failures };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const result = await verifyArticleCovers();
  console.log('C2PA cover verification (presence check — see scripts/verify-c2pa.mjs header)');
  console.log(`Checked (claimed coverC2paVerified=true): ${result.checked}`);
  console.log(`Failures: ${result.failures.length}`);
  if (result.failures.length > 0) {
    for (const f of result.failures) {
      console.log(`- [${f.slug}] ${f.reason}`);
    }
    console.log('\n❌ C2PA verification failed — covers lost their Content Credentials.');
    process.exit(1);
  }
  console.log('✅ All claimed covers carry a C2PA manifest (or none claimed).');
}

// 僅在被當作可執行檔直接執行時跑 CLI（被 import 進測試時不跑）。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('verify-c2pa 執行錯誤：', err);
    process.exit(1);
  });
}
