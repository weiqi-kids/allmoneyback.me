// Anthropic LLM provider 包裝層。
//
// 兩種模式：
//   STUB 模式（無 ANTHROPIC_API_KEY）：用 opts.stub() 產生離線替身，
//     並對 schema 驗證（失敗就 throw，fail loud）。不會發任何網路請求。
//   真實模式：呼叫 client.messages.parse(...) / client.messages.stream(...)。
//
// 依專案 claude-api 標準：
//   - 預設模型 claude-opus-4-8（精確字串，無日期後綴）
//   - thinking: { type: 'adaptive' }
//   - 結構化輸出用 output_config.format = zodOutputFormat(schema)，
//     解析結果在 response.parsed_output（null 則 throw）
//   - 不傳 temperature/top_p/top_k/budget_tokens（opus-4-8 會 400）
//   - 長文用 streaming + finalMessage()
//   - client 延遲建構（呼叫時才 new Anthropic()），避免 import 時就需要 key

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodSchema } from 'zod';
import { createLogger } from './log';

const log = createLogger('llm');

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 16000;

// 延遲建構並快取單例：import 時不需 key，真實模式下多步呼叫共用同一 client。
let _client: Anthropic | undefined;
function getClient(): Anthropic {
  return (_client ??= new Anthropic());
}

export type Effort = 'low' | 'medium' | 'high' | 'max';

/** 無 ANTHROPIC_API_KEY（未設或空字串）時為 STUB 模式。 */
export function isLlmStubMode(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return key === undefined || key === '';
}

interface StructuredOpts<T> {
  step: string;
  system: string;
  prompt: string;
  schema: ZodSchema<T>;
  stub: () => T;
  model?: string;
  effort?: Effort;
}

interface TextOpts {
  step: string;
  system: string;
  prompt: string;
  stub: () => string;
  model?: string;
  effort?: Effort;
}

/** 結構化輸出（zod schema 驗證）。 */
export async function llmStructured<T>(
  opts: StructuredOpts<T>,
): Promise<{ data: T; model: string; stub: boolean }> {
  if (isLlmStubMode()) {
    // STUB：產生替身並驗證 —— 替身若不符 schema 必須 fail loud。
    const data = opts.schema.parse(opts.stub());
    log.stub(`structured ${opts.step}（STUB 模式，未發 API）`, { step: opts.step });
    return { data, model: 'stub', stub: true };
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const client = getClient();
  log.info(`structured ${opts.step}`, { step: opts.step, model });

  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: opts.effort ?? 'high',
      // zodOutputFormat 的型別簽章來自 zod/v4（SDK 內部），本專案 schemas 用 zod v3 API
      // （zod 3.25 同時提供兩者，執行期相容）。此處在邊界以 any 轉接，避開 v3/v4 型別恆等差異。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(opts.schema as any),
    },
    system: opts.system,
    messages: [{ role: 'user', content: opts.prompt }],
  });

  if (response.parsed_output === null || response.parsed_output === undefined) {
    throw new Error(`llmStructured(${opts.step}): parsed_output 為 null（解析失敗）`);
  }

  return { data: response.parsed_output as T, model, stub: false };
}

/** 長文文字生成（write 步驟用 streaming）。 */
export async function llmText(
  opts: TextOpts,
): Promise<{ text: string; model: string; stub: boolean }> {
  if (isLlmStubMode()) {
    const text = opts.stub();
    log.stub(`text ${opts.step}（STUB 模式，未發 API）`, { step: opts.step });
    return { text, model: 'stub', stub: true };
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const client = getClient();
  log.info(`text ${opts.step}`, { step: opts.step, model });

  const message = await client.messages
    .stream({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort ?? 'high' },
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }],
    })
    .finalMessage();

  // 串接所有 text block。
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return { text, model, stub: false };
}
