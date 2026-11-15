import { createCn } from 'cn/config';

/**
 * Merges Tailwind classes, letting later classes win. The design tokens add font sizes
 * (text-h1, text-body-2, ...) that the merger would otherwise mistake for text colors and drop
 * the real color class.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'hero',
            'h1',
            'h2',
            'h3',
            'h4',
            'title-1',
            'title-2',
            'title-3',
            'price',
            'body-1',
            'body-2',
            'body-3',
            'body-4',
            'body-5',
            'caption',
            'button-1',
            'button-2',
          ],
        },
      ],
    },
  },
});
