<script lang="ts">
  // 文章留言島（C4）。
  //
  // 優雅降級是強制要求：apiBase 為空/未設定時，只渲染一句安靜的
  // 「留言功能尚未啟用」提示，絕不 fetch、絕不出表單、絕不報錯。
  //
  // 後端（C3 Worker）形狀：
  //   GET  /api/comments?slug=<slug> → { comments: [{id,nickname,body,created_at}] }（只回 approved）
  //   POST /api/comments {slug,nickname,body} → 201 { id, status:'pending' }
  //     錯誤統一 { error: <code> }；429 為速率限制。
  // 顯示克制：時間序、無讚數、無演算法排序（§9.1）。

  interface Comment {
    id: string;
    nickname: string;
    body: string;
    created_at: string;
  }

  // 與後端 validate.ts 對齊的長度上限。
  const NICKNAME_MAX = 40;
  const BODY_MAX = 2000;

  const { slug, apiBase = '' }: { slug: string; apiBase?: string } = $props();

  const enabled = typeof apiBase === 'string' && apiBase.trim().length > 0;
  const base = apiBase.trim().replace(/\/+$/, '');

  let comments = $state<Comment[]>([]);
  let loadState = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  let nickname = $state('');
  let body = $state('');
  let submitState = $state<'idle' | 'submitting' | 'success' | 'error'>('idle');
  let submitMsg = $state('');

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // 在地化日期（無秒），純為閱讀，不參與排序。
    return d.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  async function loadComments() {
    if (!enabled) return;
    loadState = 'loading';
    try {
      const res = await fetch(`${base}/api/comments?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error('bad_status');
      const data = (await res.json()) as { comments?: Comment[] };
      // 後端已時間序，但仍在前端保險地依 created_at 排序（克制，無其他排序）。
      comments = (data.comments ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      loadState = 'loaded';
    } catch {
      // 不洩漏內部；安靜地標記載入失敗。
      loadState = 'error';
    }
  }

  // 對應後端錯誤碼的使用者友善訊息（永不暴露內部細節）。
  function friendlyError(code: string | undefined): string {
    switch (code) {
      case 'nickname_required':
      case 'body_required':
        return '請填寫暱稱與留言內容。';
      case 'nickname_too_long':
        return `暱稱請勿超過 ${NICKNAME_MAX} 字。`;
      case 'body_too_long':
        return `留言請勿超過 ${BODY_MAX} 字。`;
      case 'too_many_links':
        return '留言中的連結過多，請減少後再送出。';
      case 'banned_content':
      case 'spam_repetition':
        return '這則留言看起來不太對勁，請調整後再送出。';
      default:
        return '送出時出了點狀況，請稍後再試。';
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!enabled || submitState === 'submitting') return;

    const nick = nickname.trim();
    const text = body.trim();
    if (!nick || !text) {
      submitState = 'error';
      submitMsg = '請填寫暱稱與留言內容。';
      return;
    }

    submitState = 'submitting';
    submitMsg = '';
    try {
      const res = await fetch(`${base}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, nickname: nick, body: text }),
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

      // 成功：留言預設 pending（待審不裸奔），清空欄位。
      submitState = 'success';
      submitMsg = '你的留言已送出，待審後顯示。';
      nickname = '';
      body = '';
    } catch {
      submitState = 'error';
      submitMsg = '送出時出了點狀況，請稍後再試。';
    }
  }

  $effect(() => {
    if (enabled) loadComments();
  });
</script>

<section class="comments" aria-labelledby="comments-heading">
  <h2 id="comments-heading" class="comments__title">留言</h2>

  {#if !enabled}
    <p class="comments__note">留言功能尚未啟用。</p>
  {:else}
    {#if loadState === 'loading'}
      <p class="comments__note">載入留言中…</p>
    {:else if loadState === 'error'}
      <p class="comments__note">留言暫時讀取不到，稍後再回來看看。</p>
    {:else if comments.length === 0}
      <p class="comments__note">還沒有留言。第一個說點什麼吧。</p>
    {:else}
      <ul class="comments__list">
        {#each comments as c (c.id)}
          <li class="comment">
            <div class="comment__head">
              <span class="comment__nick">{c.nickname}</span>
              <time class="comment__time" datetime={c.created_at}>{fmtTime(c.created_at)}</time>
            </div>
            <p class="comment__body">{c.body}</p>
          </li>
        {/each}
      </ul>
    {/if}

    <form class="comment-form" onsubmit={submit} novalidate>
      <h3 class="comment-form__title">留下你的看法</h3>

      <div class="field">
        <label for="comment-nickname">暱稱</label>
        <input
          id="comment-nickname"
          name="nickname"
          type="text"
          bind:value={nickname}
          maxlength={NICKNAME_MAX}
          required
          autocomplete="nickname"
        />
      </div>

      <div class="field">
        <label for="comment-body">留言內容</label>
        <textarea
          id="comment-body"
          name="body"
          bind:value={body}
          maxlength={BODY_MAX}
          rows="4"
          required
        ></textarea>
      </div>

      {#if submitMsg}
        <p
          class="comment-form__msg"
          class:comment-form__msg--ok={submitState === 'success'}
          class:comment-form__msg--err={submitState === 'error'}
          role="status"
          aria-live="polite"
        >
          {submitMsg}
        </p>
      {/if}

      <button type="submit" class="comment-form__submit" disabled={submitState === 'submitting'}>
        {submitState === 'submitting' ? '送出中…' : '送出留言'}
      </button>
      <p class="comment-form__hint">留言送出後需經審核才會顯示。</p>
    </form>
  {/if}
</section>

<style>
  .comments {
    border-top: 1px solid var(--color-fog);
    padding-top: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .comments__title {
    font-family: var(--font-sans);
    font-size: var(--text-h3);
    color: var(--color-ink);
    margin: 0;
  }

  .comments__note {
    font-size: var(--text-body);
    line-height: 1.7;
    color: color-mix(in oklch, var(--color-ink) 60%, transparent);
    margin: 0;
  }

  .comments__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .comment {
    border: 1px solid var(--color-fog);
    border-radius: var(--radius-card);
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .comment__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .comment__nick {
    font-weight: 600;
    font-size: var(--text-body);
    color: var(--color-ink);
  }

  .comment__time {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: color-mix(in oklch, var(--color-ink) 55%, transparent);
  }

  .comment__body {
    margin: 0;
    font-size: var(--text-body);
    line-height: 1.7;
    color: var(--color-ink);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .comment-form {
    border: 1px solid var(--color-fog);
    border-radius: var(--radius-card);
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .comment-form__title {
    font-family: var(--font-sans);
    font-size: var(--text-body);
    font-weight: 600;
    color: var(--color-ink);
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field label {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: color-mix(in oklch, var(--color-ink) 70%, transparent);
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
    min-height: 6rem;
  }

  .field input:focus-visible,
  .field textarea:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  .comment-form__msg {
    margin: 0;
    font-size: var(--text-meta);
    line-height: 1.6;
  }

  .comment-form__msg--ok {
    color: var(--color-accent-hover);
  }

  .comment-form__msg--err {
    color: oklch(0.52 0.16 25);
  }

  .comment-form__submit {
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

  .comment-form__submit:hover:not(:disabled) {
    background-color: var(--color-accent-hover);
  }

  .comment-form__submit:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .comment-form__hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    color: color-mix(in oklch, var(--color-ink) 55%, transparent);
  }
</style>
