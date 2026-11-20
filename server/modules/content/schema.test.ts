import { describe, expect, it } from 'vitest';
import { legalSlugSchema, toContentBlocks } from './schema';

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] });

describe('toContentBlocks', () => {
  it('keeps headings, paragraphs and lists as plain text', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Using Foodz')] },
        {
          type: 'paragraph',
          content: [
            text('Keep your '),
            { type: 'text', text: 'password', marks: [{ type: 'bold' }] },
            text(' private.'),
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph('One')] },
            { type: 'listItem', content: [paragraph('Two')] },
          ],
        },
        { type: 'heading', attrs: { level: 3 }, content: [text('Small')] },
      ],
    };
    expect(toContentBlocks(document)).toEqual([
      { type: 'heading', level: 2, text: 'Using Foodz' },
      { type: 'paragraph', text: 'Keep your password private.' },
      { type: 'list', items: ['One', 'Two'] },
      { type: 'heading', level: 3, text: 'Small' },
    ]);
  });

  it('drops unknown or malformed nodes instead of rendering them', () => {
    const document = {
      content: [
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        paragraph('<script>alert(1)</script>'),
        { type: 'heading', attrs: { level: 1 }, content: [text('Big')] },
        'not a node',
        null,
        { type: 'paragraph', content: 'oops' },
      ],
    };
    expect(toContentBlocks(document)).toEqual([
      // Kept as text; React renders it escaped.
      { type: 'paragraph', text: '<script>alert(1)</script>' },
      { type: 'heading', level: 2, text: 'Big' },
    ]);
    expect(toContentBlocks(null)).toEqual([]);
    expect(toContentBlocks('doc')).toEqual([]);
  });
});

describe('legalSlugSchema', () => {
  it('accepts only the two legal pages', () => {
    expect(legalSlugSchema.safeParse('terms').success).toBe(true);
    expect(legalSlugSchema.safeParse('privacy').success).toBe(true);
    for (const slug of ['faq', 'Terms', '../terms', '']) {
      expect(legalSlugSchema.safeParse(slug).success).toBe(false);
    }
  });
});
