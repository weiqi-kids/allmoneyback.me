// 引擎用的極簡結構化 logger。
// 刻意不在 module top-level 呼叫 Date.now()/new Date()，而是在每次 log 呼叫時
// 取當下時間 —— 這樣 import 此模組不會有副作用，且時間戳反映實際發生時刻。

type Meta = Record<string, unknown> | undefined;

function ts(): string {
  // ISO-like 標籤；在函式內取時間是安全的（Node）。
  return new Date().toISOString();
}

function fmt(scope: string, level: string, msg: string, meta: Meta): string {
  const base = `[${ts()}] [${level}] [${scope}] ${msg}`;
  if (meta === undefined) return base;
  // 把 meta 以 JSON 附在後面，方便機器解析（CI/cron log）。
  return `${base} ${JSON.stringify(meta)}`;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  /** 明確標記 STUB 活動（無 API key 時的離線替身），方便在 log 裡一眼辨識。 */
  stub(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    info(msg, meta) {
      console.log(fmt(scope, 'INFO', msg, meta));
    },
    warn(msg, meta) {
      console.warn(fmt(scope, 'WARN', msg, meta));
    },
    error(msg, meta) {
      console.error(fmt(scope, 'ERROR', msg, meta));
    },
    stub(msg, meta) {
      console.log(fmt(scope, 'STUB', msg, meta));
    },
  };
}
