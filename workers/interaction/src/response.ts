// 統一 JSON 回應 helper。錯誤一律回 { error: <code> }，永不洩漏內部堆疊/實作細節。

export function json(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

/** 標準錯誤回應：{ error: code }。code 為對使用者安全的短代碼。 */
export function errorJson(
  code: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return json({ error: code }, status, extraHeaders);
}
