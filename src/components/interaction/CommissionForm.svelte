<script lang="ts">
  // 委託投題島（C4）—「帶一樁賺錢的事來」。
  //
  // 優雅降級是強制要求：apiBase 為空/未設定時，只渲染一句安靜的
  // 「投題功能尚未啟用」提示，絕不 fetch、絕不出表單、絕不報錯。
  //
  // 後端（C3 Worker）形狀：
  //   POST /api/commissions {methodDesc, regionHint?, sourceHint?, nickname?}
  //     → 201 { id, status:'pending' }；錯誤統一 { error: <code> }；429 速率限制。

  // 與後端 validate.ts 對齊的長度上限。
  const METHOD_DESC_MAX = 2000;
  const HINT_MAX = 200;
  const NICKNAME_MAX = 40;

  const { apiBase = '' }: { apiBase?: string } = $props();

  const enabled = typeof apiBase === 'string' && apiBase.trim().length > 0;
  const base = apiBase.trim().replace(/\/+$/, '');

  let methodDesc = $state('');
  let regionHint = $state('');
  let sourceHint = $state('');
  let nickname = $state('');

  let submitState = $state<'idle' | 'submitting' | 'success' | 'error'>('idle');
  let submitMsg = $state('');

  function friendlyError(code: string | undefined): string {
    switch (code) {
      case 'methodDesc_required':
        return '請先說說那是一種什麼樣的賺錢方式。';
      case 'methodDesc_too_long':
        return `說明請勿超過 ${METHOD_DESC_MAX} 字。`;
      case 'regionHint_too_long':
      case 'sourceHint_too_long':
        return `補充欄位請勿超過 ${HINT_MAX} 字。`;
      case 'nickname_too_long':
        return `署名請勿超過 ${NICKNAME_MAX} 字。`;
      case 'too_many_links':
        return '內容中的連結過多，請減少後再送出。';
      case 'banned_content':
      case 'spam_repetition':
        return '這則內容看起來不太對勁，請調整後再送出。';
      default:
        return '送出時出了點狀況，請稍後再試。';
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!enabled || submitState === 'submitting') return;

    const method = methodDesc.trim();
    if (!method) {
      submitState = 'error';
      submitMsg = '請先說說那是一種什麼樣的賺錢方式。';
      return;
    }

    submitState = 'submitting';
    submitMsg = '';

    const payload: Record<string, string> = { methodDesc: method };
    const region = regionHint.trim();
    const source = sourceHint.trim();
    const nick = nickname.trim();
    if (region) payload.regionHint = region;
    if (source) payload.sourceHint = source;
    if (nick) payload.nickname = nick;

    try {
      const res = await fetch(`${base}/api/commissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        submitState = 'error';
        submitMsg = '你送出得有點快，請稍候再試。';
        return;
      }
      if (!res.ok) {
        let code: string | undefined;
        try {
          code = ((await res.json()) as { error?: string }).error;
        } catch {
          code = undefined;
        }
        submitState = 'error';
        submitMsg = friendlyError(code);
        return;
      }

      submitState = 'success';
      submitMsg = '收到了，我們會看著辦——若立案見證，會出現在文章列表。';
      methodDesc = '';
      regionHint = '';
      sourceHint = '';
      nickname = '';
    } catch {
      submitState = 'error';
      submitMsg = '送出時出了點狀況，請稍後再試。';
    }
  }
</script>

{#if !enabled}
  <p class="commission__note">投題功能尚未啟用。</p>
{:else}
  <form class="commission-form" onsubmit={submit} novalidate>
    <div class="field">
      <label for="commission-method">那是一種什麼樣的賺錢方式？</label>
      <textarea
        id="commission-method"
        name="methodDesc"
        bind:value={methodDesc}
        maxlength={METHOD_DESC_MAX}
        rows="5"
        required
        aria-describedby="commission-method-hint"
      ></textarea>
      <span id="commission-method-hint" class="field__hint">
        說給我們——你見過的、聽過的、或想知道的一種活法。怎麼進來的、怎麼換成錢的，都可以寫。
      </span>
    </div>

    <div class="field">
      <label for="commission-region">在哪裡見到的？（選填）</label>
      <input
        id="commission-region"
        name="regionHint"
        type="text"
        bind:value={regionHint}
        maxlength={HINT_MAX}
        placeholder="地區、國家或文化圈"
      />
    </div>

    <div class="field">
      <label for="commission-source">有可查的線索嗎？（選填）</label>
      <input
        id="commission-source"
        name="sourceHint"
        type="text"
        bind:value={sourceHint}
        maxlength={HINT_MAX}
        placeholder="報導、報告或你聽說的出處"
      />
    </div>

    <div class="field">
      <label for="commission-nickname">怎麼稱呼你？（選填）</label>
      <input
        id="commission-nickname"
        name="nickname"
        type="text"
        bind:value={nickname}
        maxlength={NICKNAME_MAX}
        autocomplete="nickname"
      />
    </div>

    {#if submitMsg}
      <p
        class="commission-form__msg"
        class:commission-form__msg--ok={submitState === 'success'}
        class:commission-form__msg--err={submitState === 'error'}
        role="status"
        aria-live="polite"
      >
        {submitMsg}
      </p>
    {/if}

    <button type="submit" class="commission-form__submit" disabled={submitState === 'submitting'}>
      {submitState === 'submitting' ? '送出中…' : '帶來給我們'}
    </button>
    <p class="commission-form__hint">
      委託是一個「候選」——能不能立案見證，仍要先過事實與分歧的判斷。
    </p>
  </form>
{/if}

<style>
  .commission__note {
    font-size: var(--text-body);
    line-height: 1.7;
    color: color-mix(in oklch, var(--color-ink) 60%, transparent);
    margin: 0;
  }

  .commission-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    border: 1px solid var(--color-fog);
    border-radius: var(--radius-card);
    padding: 1.5rem;
    background-color: var(--color-paper);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field label {
    font-family: var(--font-ui);
    font-size: var(--text-body);
    font-weight: 600;
    color: var(--color-ink);
  }

  .field__hint {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    line-height: 1.6;
    color: color-mix(in oklch, var(--color-ink) 55%, transparent);
  }

  .field input,
  .field textarea {
    font-family: inherit;
    font-size: var(--text-body);
    line-height: 1.6;
    color: var(--color-ink);
    background-color: var(--color-paper);
    border: 1px solid var(--color-fog);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.75rem;
    width: 100%;
    box-sizing: border-box;
  }

  .field textarea {
    resize: vertical;
    min-height: 7rem;
  }

  .field input:focus-visible,
  .field textarea:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  .commission-form__msg {
    margin: 0;
    font-size: var(--text-meta);
    line-height: 1.6;
  }

  .commission-form__msg--ok {
    color: var(--color-accent-hover);
  }

  .commission-form__msg--err {
    color: oklch(0.52 0.16 25);
  }

  .commission-form__submit {
    align-self: flex-start;
    font-family: var(--font-ui);
    font-size: var(--text-body);
    color: var(--color-paper);
    background-color: var(--color-accent);
    border: none;
    border-radius: var(--radius-pill);
    padding: 0.6rem 1.5rem;
    cursor: pointer;
  }

  .commission-form__submit:hover:not(:disabled) {
    background-color: var(--color-accent-hover);
  }

  .commission-form__submit:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .commission-form__hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    line-height: 1.6;
    color: color-mix(in oklch, var(--color-ink) 55%, transparent);
  }
</style>
