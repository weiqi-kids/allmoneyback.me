import { describe, it, expect } from 'vitest';
import { clientIp, hashIp } from './identity';

describe('clientIp', () => {
  it('prefers CF-Connecting-IP', () => {
    const req = new Request('https://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });
  it('falls back to first X-Forwarded-For', () => {
    const req = new Request('https://x/', { headers: { 'X-Forwarded-For': '9.9.9.9, 8.8.8.8' } });
    expect(clientIp(req)).toBe('9.9.9.9');
  });
  it('returns unknown when no IP headers', () => {
    expect(clientIp(new Request('https://x/'))).toBe('unknown');
  });
});

describe('hashIp', () => {
  it('produces a 64-char hex SHA-256 digest', async () => {
    const h = await hashIp('1.2.3.4', 'salt');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is deterministic for same ip+salt and never equals raw ip', async () => {
    const a = await hashIp('1.2.3.4', 'salt');
    const b = await hashIp('1.2.3.4', 'salt');
    expect(a).toBe(b);
    expect(a).not.toContain('1.2.3.4');
  });
  it('changes with salt', async () => {
    const a = await hashIp('1.2.3.4', 'salt1');
    const b = await hashIp('1.2.3.4', 'salt2');
    expect(a).not.toBe(b);
  });
});
