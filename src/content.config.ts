import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { articlesSchema } from './schemas/articles';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: ({ image }) =>
    articlesSchema.extend({
      coverImage: image().optional(),
    }),
});

export const collections = { articles };
