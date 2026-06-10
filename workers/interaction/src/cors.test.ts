import { describe, it, expect } from 'vitest';
import {
  parseAllowedOrigins,
  isOriginAllowed,
  corsHeaders,
  handlePreflight,
} from './cors';

const ALLOWED = 'https://allmoneyback.me,https://weiqi-kids.github.io';

describe('cors', () => {
  it('parses comma-separated allowlist and trims', () => {
    expect(parseAllowedOrigins(' https://a.com , https://b.com ')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it('allows an origin on the allowlist', () => {
    const allowed = parseAllowedOrigins(ALLOWED);
    expect(isOriginAllowed('https://allmoneyback.me', allowed)).toBe(true);
    expect(isOriginAllowed('https://weiqi-kids.github.io', allowed)).toBe(true);
  });

  it('rejects an origin not on the allowlist and null origin', () => {
    const allowed = parseAllowedOrigins(ALLOWED);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  it('returns Allow-Origin for allowed origin and never uses *', () => {
    const allowed = parseAllowedOrigins(ALLOWED);
    const h = corsHeaders('https://allmoneyback.me', allowed);
    expect(h['Access-Control-Allow-Origin']).toBe('https://allmoneyback.me');
    expect(h['Access-Control-Allow-Origin']).not.toBe('*');
    expect(h['Vary']).toBe('Origin');
  });

  it('omits Allow-Origin for disallowed origin', () => {
    const allowed = parseAllowedOrigins(ALLOWED);
    const h = corsHeaders('https://evil.example', allowed);
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('preflight: 204 for allowed, 403 for disallowed', () => {
    const allowed = parseAllowedOrigins(ALLOWED);
    const ok = handlePreflight('https://allmoneyback.me', allowed);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://allmoneyback.me');

    const bad = handlePreflight('https://evil.example', allowed);
    expect(bad.status).toBe(403);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
