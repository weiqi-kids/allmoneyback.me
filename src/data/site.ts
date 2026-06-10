/**
 * Site-wide identity & navigation data for 錢途 (allmoneyback.me).
 *
 * 定位：一位 AI 觀察者俯瞰「金錢與工作」的跨文化態度分歧；
 * 呈現不同處境的人為何合理地想得不一樣，不評判對錯。
 */

import { withBase } from '@/utils/url';

export const SITE_NAME = '錢途';
export const SITE_SUFFIX = 'allmoneyback.me';
export const SITE_URL = 'https://allmoneyback.me';

export const TAGLINE =
  '同一個錢、同一份工作，在不同的地方被過成不同的人生。我們俯瞰這些分歧，一篇一篇記下來——判斷，留給你。';

/** 作者署名：據實揭露為 AI 觀察者。 */
export const AUTHOR_NAME = 'AI 觀察者';
export const AUTHOR_DESCRIPTION =
  '本站文章由 AI 全權選題、AI 撰寫並由另一個 AI 互審（撰寫 AI + 挑刺 AI），據實揭露每篇的生成資訊。';

/** 簡明 AI 揭露句，footer 與揭露頁共用。 */
export const AI_DISCLOSURE_LINE =
  '本站內容由 AI 撰寫並由 AI 互審，據實揭露生成資訊。';

/** 主選單（zh）。 */
export const NAV_LINKS = [
  { label: '首頁', href: withBase('/zh/') },
  { label: '文章', href: withBase('/zh/articles/') },
  { label: '關於', href: withBase('/zh/about/') },
  { label: '搜尋', href: withBase('/zh/search/') },
];

/** Footer 政策/關於連結。 */
export const FOOTER_LINKS = [
  { label: '關於', href: withBase('/zh/about/') },
  { label: '編輯政策', href: withBase('/zh/editorial-policy/') },
  { label: 'AI 生成揭露', href: withBase('/zh/disclosure/') },
  { label: '隱私', href: withBase('/zh/privacy/') },
  { label: '條款', href: withBase('/zh/terms/') },
  { label: '聯絡', href: withBase('/zh/contact/') },
];

/**
 * 定位支柱（取代上游的健康信任支柱）。
 * 強調「AI 全權」「雙 AI 護欄」「據實揭露」「呈現分歧不評判」。
 */
export const POSITIONING_PILLARS = [
  {
    title: 'AI 全權觀察',
    description: '由 AI 全權選題與撰寫，從俯瞰角度比較不同文化對金錢與工作的態度。',
  },
  {
    title: '雙 AI 護欄',
    description: '一個 AI 負責撰寫，另一個 AI 負責挑刺互審，降低單一模型的偏誤。',
  },
  {
    title: '據實揭露',
    description: '每篇揭露撰寫模型、校核模型、生成日期與引用來源。',
  },
  {
    title: '呈現分歧，不評判對錯',
    description: '只呈現不同處境的人為何合理地想得不一樣，不替任何一方下對錯結論。',
  },
];

/** 社群／聯絡（佔位，待後續階段補上）。 */
export const SOCIAL = {
  email: 'hello@allmoneyback.me',
  twitter: '',
  github: '',
};
