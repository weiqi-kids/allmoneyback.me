// engine/cli.ts
//
// 引擎 CLI：由 `pnpm engine <command>`（tsx engine/cli.ts <command>）派發。
//
// 指令：
//   run-pipeline  跑整條管線（fetch→select→evidence→anchor→write），印人類可讀摘要。
//   fetch         只跑抓取層，印摘要。
//   help（預設）  列出指令。
//
// 紀律：不在 module top-level 呼叫 Date.now()/new Date()；時間由各層內部於執行當下取得。
//   錯誤一律 fail loud：log 後設 process.exitCode = 1，不靜默吞錯。

import { runPipeline } from './pipeline.js';
import { runFetch } from './fetch/index.js';
import { getReviewQueueCount } from './route/index.js';
import { buildOwnerReport } from './analytics/ga4.js';
import { extractGoodTopicSignals } from './analytics/feedback.js';
import { isLlmStubMode } from './lib/llm.js';
import { createLogger } from './lib/log.js';

const log = createLogger('cli');

const COMMANDS = ['run-pipeline', 'fetch', 'report', 'help'] as const;

function printHelp(): void {
  console.log(
    [
      '引擎 CLI — 用法：pnpm engine <command>',
      '',
      '可用指令：',
      '  run-pipeline [--publish]   跑整條管線（fetch→…→write→critique→route）並印摘要',
      '                             不帶 --publish → DRY-RUN：含批判，但「不寫任何檔」',
      '                             帶 --publish   → 真的落地（發布上線或隔離待審）',
      '  fetch                      只跑抓取層（依白名單產生來源樣品），印摘要',
      '  report                     印站長報告（流量摘要 + 異常訊號 + 待審件數 + 好題偏好）',
      '  help                       顯示本說明',
      '',
      `模式：${isLlmStubMode() ? 'STUB（未設 ANTHROPIC_API_KEY，使用離線替身）' : 'REAL（已設 ANTHROPIC_API_KEY）'}`,
    ].join('\n'),
  );
}

async function cmdRunPipeline(): Promise<void> {
  // --publish 旗標：不帶 → DRY-RUN（不寫檔）；帶 → 真的落地。
  const publish = process.argv.includes('--publish');
  const result = await runPipeline({ publish });

  console.log('');
  console.log('── run-pipeline 摘要 ──');
  console.log(`狀態：${result.status}`);
  console.log(`模式：${result.stub ? 'STUB' : 'REAL'}`);
  console.log(`落地：${publish ? 'PUBLISH（真的寫檔）' : 'DRY-RUN（不寫任何檔）'}`);

  if (result.status === 'rejected') {
    console.log(`被擋階段：${result.stage ?? '（未知）'}`);
    console.log(`原因：${result.rejectReason ?? '（未提供）'}`);
    console.log('');
    console.log('（管線在閘門前誠實退回，未產出文章——這是預期行為，非錯誤。）');
    return;
  }

  // published-draft
  const draft = result.draft!;
  console.log(`標題：${draft.frontmatter.title}`);
  console.log(`定錨文化：${draft.frontmatter.anchorCulture}`);
  console.log(`對照文化：${draft.frontmatter.comparedCultures.join('、')}`);
  console.log(`writeModel：${result.model?.write ?? '（未知）'}`);
  console.log(`來源數：${draft.frontmatter.sources.length}`);
  console.log(`本文長度：${draft.body.length} 字`);

  // 批判摘要（抵達 published-draft 必有）。
  const c = result.critique;
  console.log('');
  console.log('── 批判（E9）摘要 ──');
  if (c) {
    console.log(`批判輪數：${c.rounds}`);
    console.log(`過關（pass）：${c.verdictPass}`);
    console.log(`立場風險：${c.stanceRiskLevel}`);
    console.log(`分流待審（routedToReview）：${c.routedToReview}`);
    console.log(`critiqueModel：${c.critiqueModel}`);
  } else {
    console.log('（無批判摘要——不應發生）');
  }

  console.log('');
  if (publish) {
    // 真的落地：印 routeAndPublish 結果。
    console.log('── 落地（E10 route + publish）結果 ──');
    const pr = result.publishResult;
    if (pr) {
      console.log(`動作：${pr.action === 'published' ? 'published（上線）' : 'quarantined（隔離待審）'}`);
      console.log(`路徑：${pr.path}`);
      console.log(`slug：${pr.slug}`);
      if (pr.issue) {
        console.log(
          `待審 issue：${pr.issue.created ? `已開立（${pr.issue.ref ?? '無 ref'}）` : pr.issue.stub ? 'STUB（無 GITHUB_TOKEN，未開）' : '開立失敗（草稿已隔離）'}`,
        );
      }
    } else {
      console.log('（無 publishResult——不應發生於 publish 模式）');
    }
    console.log(`待審佇列計數：${getReviewQueueCount()}`);
  } else {
    // DRY-RUN：只說明「若落地會怎麼走」，不寫任何檔。
    console.log('── DRY-RUN：未寫任何檔 ──');
    console.log(
      result.critique?.routedToReview
        ? '若帶 --publish：此草稿會被「隔離待審」（quarantined，寫進 _review/ 並開 issue），不會上線。'
        : '若帶 --publish：此草稿會被「發布上線」（published，寫進 src/content/articles/）。',
    );
  }
}

async function cmdFetch(): Promise<void> {
  const result = await runFetch();

  console.log('');
  console.log('── fetch 摘要 ──');
  console.log(`新增來源筆數：${result.added}`);
  console.log(`產生總筆數：${result.records.length}`);
  console.log(`stub 來源：${result.stubbed.length} 個 — ${result.stubbed.join(', ') || '（無）'}`);
  console.log(
    `real-pending 來源：${result.realPending.length} 個 — ${result.realPending.join(', ') || '（無）'}`,
  );
}

/**
 * 站長報告（E16 / 規格 §10.8）：流量摘要 + 熱門文章 + 異常訊號 + 待審件數 + 好題偏好。
 * 純文字輸出（無 markdown 表格），方便直接讀／貼。STUB 時明確標註。
 */
async function cmdReport(): Promise<void> {
  const owner = await buildOwnerReport();
  const prefs = await extractGoodTopicSignals();

  const { report, anomalies, reviewQueueCount, stub } = owner;
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

  // 本期 vs 前期變化%（前期為 0 則標 n/a，避免除零）。
  const prev = report.prevTotals.sessions;
  const deltaPct =
    prev > 0 ? `${(((report.totals.sessions - prev) / prev) * 100).toFixed(1)}%` : 'n/a';

  console.log('');
  console.log('══ 站長報告 ══');
  if (stub) {
    console.log('【STUB】未設 GA4 憑證（GA4_PROPERTY_ID + 服務帳戶），以下為離線替身數字，非真實流量。');
  }

  console.log('');
  console.log(`── 流量摘要（近 ${report.rangeDays} 天）──`);
  console.log(`本期工作階段：${report.totals.sessions}（互動率 ${pct(report.totals.engagementRate)}）`);
  console.log(`前期工作階段：${prev}　變化：${deltaPct}`);

  console.log('');
  console.log('── 熱門文章（依工作階段）──');
  const topBySessions = [...report.articles].sort((a, b) => b.sessions - a.sessions).slice(0, 10);
  if (topBySessions.length === 0) {
    console.log('（無文章流量資料）');
  } else {
    for (const a of topBySessions) {
      console.log(
        `  ${a.slug}　工作階段 ${a.sessions}　互動率 ${pct(a.engagementRate)}　自然搜尋 ${a.organicSessions}`,
      );
    }
  }

  console.log('');
  console.log('── 異常訊號 ──');
  if (anomalies.length === 0) {
    console.log('無異常');
  } else {
    for (const s of anomalies) {
      console.log(`  [${s.severity}] ${s.kind}：${s.detail}`);
    }
  }

  console.log('');
  console.log(`── 待審件數 ──`);
  console.log(`${reviewQueueCount}`);

  console.log('');
  console.log('── 好題偏好（來自流量回饋，僅供參考）──');
  if (prefs.topSubtopics.length === 0 && prefs.topAnchors.length === 0) {
    console.log('（尚無足夠流量訊號可萃取好題偏好）');
  } else {
    if (prefs.topSubtopics.length > 0) {
      console.log(
        `  表現好的子題：${prefs.topSubtopics.map((s) => `${s.domainTopic}(${s.weight})`).join('、')}`,
      );
    }
    if (prefs.topAnchors.length > 0) {
      console.log(
        `  表現好的定錨文化：${prefs.topAnchors.map((a) => `${a.culture}(${a.weight})`).join('、')}`,
      );
    }
    if (prefs.sampleTitles.length > 0) {
      console.log(`  範本文章：${prefs.sampleTitles.join('；')}`);
    }
  }

  if (stub) {
    console.log('');
    console.log('【STUB】以上為離線替身報告。設定 GA4 憑證後即為真實流量。');
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';

  switch (command) {
    case 'run-pipeline':
      await cmdRunPipeline();
      break;
    case 'fetch':
      await cmdFetch();
      break;
    case 'report':
      await cmdReport();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.log(`未知指令：${command}`);
      console.log(`可用指令：${COMMANDS.join(', ')}`);
      printHelp();
      process.exitCode = 1;
      break;
  }
}

main().catch((err) => {
  log.error('CLI 執行失敗', { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
