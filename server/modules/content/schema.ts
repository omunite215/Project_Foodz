import { z } from 'zod';

export const LEGAL_SLUGS = ['terms', 'privacy', 'partner-terms'] as const;
export const legalSlugSchema = z.enum(LEGAL_SLUGS);
export type LegalSlug = z.infer<typeof legalSlugSchema>;

export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    level: z.union([z.literal(2), z.literal(3)]),
    text: z.string(),
  }),
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  z.object({ type: z.literal('list'), items: z.array(z.string()) }),
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const legalPageSchema = z.object({
  slug: legalSlugSchema,
  title: z.string(),
  version: z.int().positive(),
  publishedAt: z.iso.datetime(),
  blocks: z.array(contentBlockSchema),
});
export type LegalPage = z.infer<typeof legalPageSchema>;

// ------------------------------------------------------------------ stored editor document

// The subset of the editor's JSON (TipTap / ProseMirror) that public pages render. Anything else
// in a stored document is dropped rather than rendered.
interface EditorNode {
  type?: unknown;
  text?: unknown;
  attrs?: { level?: unknown } | null;
  content?: unknown;
}

const nodesOf = (value: unknown): EditorNode[] =>
  Array.isArray(value)
    ? value.filter((node): node is EditorNode => typeof node === 'object' && node !== null)
    : [];

/** The plain text of a node: its text children joined, marks ignored. */
function textOf(node: EditorNode): string {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  return nodesOf(node.content).map(textOf).join('');
}

/** Turns a stored document into the blocks a page renders as plain elements. */
export function toContentBlocks(document: unknown): ContentBlock[] {
  const root = typeof document === 'object' && document !== null ? (document as EditorNode) : {};
  const blocks: ContentBlock[] = [];
  for (const node of nodesOf(root.content)) {
    if (node.type === 'heading') {
      const level = node.attrs?.level === 3 ? 3 : 2;
      const text = textOf(node).trim();
      if (text) blocks.push({ type: 'heading', level, text });
    } else if (node.type === 'paragraph') {
      const text = textOf(node).trim();
      if (text) blocks.push({ type: 'paragraph', text });
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      const items = nodesOf(node.content)
        .map((item) => textOf(item).trim())
        .filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
    }
  }
  return blocks;
}
