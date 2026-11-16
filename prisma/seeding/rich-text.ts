/**
 * Builds seeded rich text in the editor's document format (TipTap / ProseMirror JSON) together
 * with the matching HTML, from one simple description.
 */

export type Block = { h2: string } | { h3: string } | { p: string } | { list: string[] };

// Type aliases (not interfaces) so the result is assignable to Prisma's JSON input type.
type TextNode = { type: 'text'; text: string };
type ElementNode = {
  type: string;
  attrs?: Record<string, string | number>;
  content?: Array<ElementNode | TextNode>;
};

export interface RichText {
  json: { type: 'doc'; content: ElementNode[] };
  html: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const text = (value: string): TextNode => ({ type: 'text', text: value });
const paragraph = (value: string): ElementNode => ({ type: 'paragraph', content: [text(value)] });

export function richText(blocks: Block[]): RichText {
  const content: ElementNode[] = [];
  const html: string[] = [];

  for (const block of blocks) {
    if ('h2' in block || 'h3' in block) {
      const level = 'h2' in block ? 2 : 3;
      const value = 'h2' in block ? block.h2 : block.h3;
      content.push({ type: 'heading', attrs: { level }, content: [text(value)] });
      html.push(`<h${level}>${escapeHtml(value)}</h${level}>`);
    } else if ('p' in block) {
      content.push(paragraph(block.p));
      html.push(`<p>${escapeHtml(block.p)}</p>`);
    } else {
      content.push({
        type: 'bulletList',
        content: block.list.map((item) => ({ type: 'listItem', content: [paragraph(item)] })),
      });
      html.push(
        `<ul>${block.list.map((item) => `<li><p>${escapeHtml(item)}</p></li>`).join('')}</ul>`,
      );
    }
  }

  return { json: { type: 'doc', content }, html: html.join('') };
}
