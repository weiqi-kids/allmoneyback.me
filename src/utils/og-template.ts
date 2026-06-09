import satori from 'satori';
import { loadFonts } from './og-fonts';

/**
 * OG card generator for allmoneyback.me.
 *
 * Restrained palette mirroring the design tokens (hex equivalents of the OKLCH
 * tokens — satori renders in sRGB):
 *   navy   = oklch(0.27 0.025 255)  ≈ #1e2733  (background)
 *   paper  = oklch(0.97 0.008 85)   ≈ #f8f5ef  (title text on navy)
 *   accent = oklch(0.52 0.07 75)    ≈ #816339  (bronze emphasis rule / label)
 *   meta   = oklch(0.75 0.01 220)   ≈ #a7b0b2  (footer text)
 *
 * NOTE: a fixed "AI 生成圖" label area is reserved here. C2PA manifest wiring
 * arrives in Phase 4 — for now this is just the visible label/space.
 */
const NAVY_HEX = '#1e2733';
const PAPER_HEX = '#f8f5ef';
const ACCENT_HEX = '#816339';
const META_HEX = '#a7b0b2';

const SITE_LABEL = '錢途 allmoneyback.me';
const AI_LABEL = 'AI 生成圖';

// Satori doesn't support -webkit-line-clamp. Truncate title to ~2 lines.
// At 56px font, ~1040px usable width, CJK chars ~56px each → ~18 chars/line → ~36 for 2 lines.
function truncateTitle(title: string, maxLen = 40): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + '…';
}

export async function generateOgSvg(title: string): Promise<string> {
  const fonts = await loadFonts();
  const displayTitle = truncateTitle(title);

  const markup = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '1200px',
        height: '630px',
        backgroundColor: NAVY_HEX,
        padding: '60px 80px',
      },
      children: [
        // Top: "AI 生成圖" label (C2PA verification wired in Phase 4).
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              marginBottom: '28px',
            },
            children: {
              type: 'span',
              props: {
                style: {
                  border: `1px solid ${ACCENT_HEX}`,
                  color: ACCENT_HEX,
                  padding: '6px 18px',
                  borderRadius: '9999px',
                  fontSize: '20px',
                  fontWeight: 400,
                },
                children: AI_LABEL,
              },
            },
          },
        },
        // Accent rule above the title for restrained emphasis.
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: '64px',
              height: '4px',
              backgroundColor: ACCENT_HEX,
              borderRadius: '9999px',
              marginBottom: '24px',
            },
            children: [],
          },
        },
        // Title.
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              color: PAPER_HEX,
              fontSize: '56px',
              fontWeight: 700,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
            children: displayTitle,
          },
        },
        // Footer: site brand.
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              marginTop: 'auto',
              borderTop: `1px solid ${META_HEX}40`,
              paddingTop: '20px',
            },
            children: {
              type: 'span',
              props: {
                style: {
                  color: META_HEX,
                  fontSize: '24px',
                  fontWeight: 400,
                },
                children: SITE_LABEL,
              },
            },
          },
        },
      ],
    },
  };

  // `as any` required because Satori's generic expects a ReactNode, but we use plain VDOM objects.
  return satori(markup as any, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Noto Sans TC',
        data: fonts.regular,
        weight: 400,
        style: 'normal' as const,
      },
      {
        name: 'Noto Sans TC',
        data: fonts.bold,
        weight: 700,
        style: 'normal' as const,
      },
    ],
  });
}
