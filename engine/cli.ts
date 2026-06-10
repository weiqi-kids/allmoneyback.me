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
import { isLlmStubMode } from './lib/llm.js';
import { createLogger } from './lib/log.js';

const log = createLogger('cli');

const COMMANDS = ['run-pipeline', 'fetch', 'help'] as const;

function printHelp(): void {
  console.log(
    [
      '引擎 CLI — 用法：pnpm engine <command>',
      '',
      '可用指令：',
      '  run-pipeline   跑整條管線（fetch→select→evidence→anchor→write），產出草稿並印摘要',
      '  fetch          只跑抓取層（依白名單產生來源樣品），印摘要',
      '  help           顯示本說明',
      '',
      `模式：${isLlmStubMode() ? 'STUB（未設 ANTHROPIC_API_KEY，使用離線替身）' : 'REAL（已設 ANTHROPIC_API_KEY）'}`,
    ].join('\n'),
  );
}

async function cmdRunPipeline(): Promise<void> {
  const result = await runPipeline();

  console.log('');
  console.log('── run-pipeline 摘要 ──');
  console.log(`狀態：${result.status}`);
  console.log(`模式：${result.stub ? 'STUB' : 'REAL'}`);

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
  console.log('');
  // 實際寫入 src/content 屬 Phase 3（E10）；此處先把 markdown 印到 stdout。
  console.log('── 草稿 markdown（尚未寫檔；檔案寫入屬 Phase 3 E10）──');
  console.log(draft.markdown);
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

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';

  switch (command) {
    case 'run-pipeline':
      await cmdRunPipeline();
      break;
    case 'fetch':
      await cmdFetch();
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
