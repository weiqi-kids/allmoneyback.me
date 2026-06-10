// engine/publish/publish.test.ts
//
// E10 落地（publish/quarantine + slug）測試。全部用 engine/data 底下的 TEMP 目錄
// （engine/data 已 gitignore），afterEach 清掉——絕不碰真實 src/content。

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  publishArticle,
  quarantineDraft,
  slugForDraft,
} from './index.js';
import { writeArticle, type DraftArticle } from '../write/index.js';
import type { Selection, AnchorResult, EvidenceResult } from '../schemas.js';

delete process.env.ANTHROPIC_API_KEY; // 確保 write 走 STUB

// TEMP 目錄都在 engine/data 底下（gitignore），不污染 src。
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const TEST_CONTENT = path.join(DATA_DIR, 'test-content-publish');
const TEST_REVIEW = path.join(DATA_DIR, 'test-review-publish');

afterEach(() => {
  for (const d of [TEST_CONTENT, TEST_REVIEW]) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

function makeSelection(over?: Partial<Selection>): Selection {
  return {
    title: '加班是責任還是異常？東亞與北歐的工時態度分歧',
    description:
      '同樣面對長工時這個有統計數據的事實，東亞傾向把加班理解為盡責，北歐傾向視之為制度失靈。',
    domainTopic: 'overtime',
    factCategory: 'B',
    stanceRiskLevel: 'low',
    anchorSuggestion: 'Nordic（北歐）',
    comparedSuggestions: ['East Asia（東亞）', 'United States（美國）'],
    reason: '工時長短有 OECD 統計支撐，差異源於勞動制度與歷史處境。',
    ...over,
  };
}

async function makeDraft(over?: Partial<Selection>): Promise<DraftArticle> {
  const anchor: AnchorResult = {
    status: 'ok',
    anchorCulture: 'Nordic（北歐）',
    comparedCultures: ['East Asia（東亞）', 'United States（美國）'],
    suspectCultures: [],
  };
  const evidence: EvidenceResult = {
    status: 'ok',
    sources: [
      {
        title: 'OECD Hours Worked',
        url: 'https://data.oecd.org/emp/hours-worked.htm',
        region: 'OECD',
        language: 'en',
        credibility: 'high',
      },
    ],
  };
  const { draft } = await writeArticle({
    selection: makeSelection(over),
    anchor,
    evidence,
    now: '2026-06-10T08:30:00.000Z',
  });
  return draft;
}

describe('slugForDraft', () => {
  it('確定性：同一份草稿 → 同一個 slug', async () => {
    const a = await makeDraft();
    const b = await makeDraft();
    expect(slugForDraft(a)).toBe(slugForDraft(b));
  });

  it('ASCII 安全：無非 ASCII、無空白、僅 [a-z0-9-]', async () => {
    const draft = await makeDraft();
    const slug = slugForDraft(draft);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    // 中文標題不該洩漏進 slug。
    // eslint-disable-next-line no-control-regex
    expect(slug).not.toMatch(/[^\x00-\x7f]/);
    expect(slug).not.toContain(' ');
  });

  it('形如 <domainTopic>-<8hex>', async () => {
    const draft = await makeDraft();
    expect(slugForDraft(draft)).toMatch(/^overtime-[0-9a-f]{8}$/);
  });

  it('不同標題 → 不同 slug 尾段', async () => {
    const a = await makeDraft();
    const b = await makeDraft({ title: '完全不同的標題以改變 hash' });
    expect(slugForDraft(a)).not.toBe(slugForDraft(b));
  });
});

describe('publishArticle', () => {
  it('寫進 contentDir/<slug>.md，內容含 markdown', async () => {
    const draft = await makeDraft();
    const res = publishArticle(draft, { contentDir: TEST_CONTENT });

    expect(res.action).toBe('published');
    expect(res.path).toBe(path.join(TEST_CONTENT, `${res.slug}.md`));
    expect(fs.existsSync(res.path)).toBe(true);
    expect(fs.readFileSync(res.path, 'utf8')).toBe(draft.markdown);
  });

  it('同名但內容不同 → 不覆寫，改用數字後綴', async () => {
    const draft = await makeDraft();
    const first = publishArticle(draft, { contentDir: TEST_CONTENT });

    // 偽造一份「同 slug 但內容不同」的草稿：手動改 markdown。
    const mutated: DraftArticle = { ...draft, markdown: draft.markdown + '\n<!-- 改過 -->' };
    const second = publishArticle(mutated, { contentDir: TEST_CONTENT });

    expect(second.path).not.toBe(first.path);
    expect(second.path).toMatch(/-2\.md$/);
    // 原檔未被覆寫。
    expect(fs.readFileSync(first.path, 'utf8')).toBe(draft.markdown);
  });

  it('同一份草稿重跑 → idempotent，不產生第二個檔', async () => {
    const draft = await makeDraft();
    const a = publishArticle(draft, { contentDir: TEST_CONTENT });
    const b = publishArticle(draft, { contentDir: TEST_CONTENT });
    expect(a.path).toBe(b.path);
    const mdFiles = fs.readdirSync(TEST_CONTENT).filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);
  });

  it('不做 git 副作用（純寫檔）', async () => {
    // 此函式不 import child_process / 不呼叫 git；以「無 .git 變更觸發」為間接保證——
    // 這裡僅斷言寫檔行為本身完成且回傳結構正確（無從寫檔函式內部觸發 git）。
    const draft = await makeDraft();
    const res = publishArticle(draft, { contentDir: TEST_CONTENT });
    expect(res.action).toBe('published');
    expect(fs.existsSync(path.join(TEST_CONTENT, '.git'))).toBe(false);
  });
});

describe('quarantineDraft', () => {
  it('寫進 reviewDir/<slug>.md，action=quarantined', async () => {
    const draft = await makeDraft();
    const res = quarantineDraft(draft, { reviewDir: TEST_REVIEW });

    expect(res.action).toBe('quarantined');
    expect(res.path).toBe(path.join(TEST_REVIEW, `${res.slug}.md`));
    expect(fs.existsSync(res.path)).toBe(true);
    expect(fs.readFileSync(res.path, 'utf8')).toBe(draft.markdown);
  });
});
