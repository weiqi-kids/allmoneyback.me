import { describe, it, expect } from 'vitest';
import {
  validateComment,
  validateCommission,
  isValidSlug,
  contentFilter,
  countLinks,
  LIMITS,
} from './validate';

describe('slug', () => {
  it('accepts kebab-case lowercase alphanumeric', () => {
    expect(isValidSlug('side-hustle-tw-2025')).toBe(true);
    expect(isValidSlug('abc')).toBe(true);
  });
  it('rejects uppercase, spaces, leading/trailing dash, traversal', () => {
    expect(isValidSlug('Bad-Slug')).toBe(false);
    expect(isValidSlug('with space')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('../etc/passwd')).toBe(false);
  });
});

describe('content filter', () => {
  it('counts links', () => {
    expect(countLinks('see http://a.com and https://b.com')).toBe(2);
    expect(countLinks('no links here')).toBe(0);
  });
  it('rejects too many links', () => {
    const r = contentFilter('http://a.com http://b.com http://c.com');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('too_many_links');
  });
  it('rejects banned content', () => {
    expect(contentFilter('buy viagra now').ok).toBe(false);
    expect(contentFilter('來去賭場大撈一筆').ok).toBe(false);
  });
  it('rejects spam repetition', () => {
    expect(contentFilter('a'.repeat(25)).ok).toBe(false);
  });
  it('passes clean content', () => {
    expect(contentFilter('這是一段正常的留言，講我看過的賺錢方式。').ok).toBe(true);
  });
});

describe('validateComment', () => {
  it('accepts a valid comment', () => {
    const r = validateComment({ slug: 'a-b', nickname: '路人甲', body: '我覺得這篇記錄很真實。' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ slug: 'a-b', nickname: '路人甲', body: '我覺得這篇記錄很真實。' });
  });
  it('rejects oversized body with body_too_long', () => {
    const r = validateComment({ slug: 'a', nickname: 'n', body: 'x'.repeat(LIMITS.BODY_MAX + 1) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('body_too_long');
  });
  it('rejects oversized nickname', () => {
    const r = validateComment({ slug: 'a', nickname: 'x'.repeat(LIMITS.NICKNAME_MAX + 1), body: 'ok' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('nickname_too_long');
  });
  it('rejects missing/invalid fields', () => {
    expect(validateComment(null).error).toBe('invalid_body');
    expect(validateComment({ nickname: 'n', body: 'b' }).error).toBe('slug_required');
    expect(validateComment({ slug: 'Bad', nickname: 'n', body: 'b' }).error).toBe('slug_invalid');
    expect(validateComment({ slug: 'a', body: 'b' }).error).toBe('nickname_required');
    expect(validateComment({ slug: 'a', nickname: 'n' }).error).toBe('body_required');
  });
});

describe('validateCommission', () => {
  it('accepts methodDesc only', () => {
    const r = validateCommission({ methodDesc: '路邊賣雞蛋糕的攤販一個月能賺多少？' });
    expect(r.ok).toBe(true);
    expect(r.value?.methodDesc).toBe('路邊賣雞蛋糕的攤販一個月能賺多少？');
    expect(r.value?.regionHint).toBeUndefined();
  });
  it('accepts optional hints and nickname', () => {
    const r = validateCommission({
      methodDesc: '代購',
      regionHint: '台北',
      sourceHint: '臉書社團',
      nickname: '阿明',
    });
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ regionHint: '台北', sourceHint: '臉書社團', nickname: '阿明' });
  });
  it('rejects missing methodDesc', () => {
    expect(validateCommission({}).error).toBe('methodDesc_required');
  });
  it('rejects oversized optional hint', () => {
    const r = validateCommission({ methodDesc: 'ok', regionHint: 'x'.repeat(LIMITS.HINT_MAX + 1) });
    expect(r.error).toBe('regionHint_too_long');
  });
});
