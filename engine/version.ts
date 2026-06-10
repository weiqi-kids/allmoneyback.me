// engine/version.ts
//
// 引擎版本常數。寫進每篇文章的 frontmatter（pipelineVersion / specVersion），
// 由生成端在「生成當下」讀取——這些是「程式碼版本」，不是 per-article 的硬寫資料，
// 升級引擎時集中改這裡即可，不必逐篇改文章。

/** pipeline 程式碼版本（語意化版號）。 */
export const PIPELINE_VERSION = '0.1.0';

/** 內容規格版本（base markdown v1）。 */
export const SPEC_VERSION = 'base-md-v1';
