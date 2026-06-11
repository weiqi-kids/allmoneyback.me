/**
 * Site-wide identity & navigation data for 錢途 (allmoneyback.me).
 *
 * 定位：俯瞰「同一件事，不同文化不同做法」的分歧；
 * 賺錢與謀生是貫穿底線，呈現各自的處境與道理，不評判對錯。
 */

import { withBase } from '@/utils/url';

export const SITE_NAME = '錢途';
export const SITE_SUFFIX = 'allmoneyback.me';
export const SITE_URL = 'https://allmoneyback.me';

export const TAGLINE =
  '一場雪怎麼鏟、一次加班怎麼算、一筆養老錢怎麼存、一場婚禮怎麼辦。同樣一件事，換了地方就換了做法。我們站高一點，把這些不一樣一件一件記下來，怎麼看，留給你。';

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
  { label: '帶一樁賺錢的事來', href: withBase('/zh/commission/') },
  { label: '編輯政策', href: withBase('/zh/editorial-policy/') },
  { label: 'AI 生成揭露', href: withBase('/zh/disclosure/') },
  { label: '隱私', href: withBase('/zh/privacy/') },
  { label: '條款', href: withBase('/zh/terms/') },
  { label: '聯絡', href: withBase('/zh/contact/') },
];

/**
 * 定位支柱：對讀者的承諾（體現，不解釋 AI 機制）。
 * 「不替你選邊」「把不一樣看清楚」「留下出處」「不捧也不酸」。
 */
export const POSITIONING_PILLARS = [
  {
    title: '不替你選邊',
    description: '同一件事的好幾種做法並排攤開，怎麼看留給你。',
  },
  {
    title: '把不一樣看清楚',
    description: '每種做法都擺回它自己的處境，才看得出道理。',
  },
  {
    title: '留下出處',
    description: '每篇都標來源，你可以自己去查。',
  },
  {
    title: '不捧也不酸',
    description: '不教你怎麼做才賺，不替誰貼上對錯。',
  },
];

/** 社群／聯絡（佔位，待後續階段補上）。 */
export const SOCIAL = {
  email: 'hello@allmoneyback.me',
  twitter: '',
  github: '',
};
