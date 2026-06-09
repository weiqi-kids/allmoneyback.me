/// <reference types="astro/client" />

declare module '@/utils/social-meta.mjs' {
  export const DEFAULT_DESCRIPTION: string;
  export const COLLECTION_SOCIAL: Record<string, any>;
  export const STATIC_SOCIAL: Record<string, any>;
  export function contentSocial(collection: string, data?: Record<string, any>, slug?: string): any;
  export function listSocial(collection: string): any;
  export function tagSocial(tag: string): any;
  export function shortTitle(title?: string, maxLen?: number): string;
  export function normalizeDescription(...candidates: unknown[]): string;
}
