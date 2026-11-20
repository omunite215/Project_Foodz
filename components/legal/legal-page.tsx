import type { ContentBlock, LegalPage as LegalPageData } from '@/server/modules/content/schema';
import { PageContainer } from '@/components/layout/page-container';

const published = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/New_York',
});

/** Stable keys from the content itself; a repeated text gets a counter. */
function keyed<T>(items: readonly T[], textOf: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = textOf(item);
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return { item, key: count ? `${text}#${count}` : text };
  });
}

const blockText = (block: ContentBlock) =>
  `${block.type}:${block.type === 'list' ? block.items.join('|') : block.text}`;

/**
 * Terms and Privacy Policy, from the seeded content (Figma Blog detail type, design 6). The
 * blocks are plain text, rendered as elements: nothing from the content becomes markup.
 */
export function LegalPage({ page }: { page: LegalPageData }) {
  return (
    <PageContainer>
      <article className="mx-auto max-w-[662px] pt-10 pb-15 md:pt-15 md:pb-20">
        <h1 className="font-sans text-body-2 font-medium text-neutral-3 md:text-h4 xl:text-h3">
          {page.title}
        </h1>
        <p className="mt-2 text-body-5 font-medium text-muted-foreground md:text-body-2">
          Version {page.version} · Updated {published.format(new Date(page.publishedAt))}
        </p>
        {keyed(page.blocks, blockText).map(({ item: block, key }) => {
          if (block.type === 'heading') {
            const Heading = block.level === 3 ? 'h3' : 'h2';
            return (
              <Heading
                key={key}
                className={
                  block.level === 3
                    ? 'mt-8 text-body-4 font-semibold text-neutral-3'
                    : 'mt-10 text-body-3 font-medium text-neutral-3 md:text-body-1'
                }
              >
                {block.text}
              </Heading>
            );
          }
          if (block.type === 'paragraph') {
            return (
              <p key={key} className="mt-4 text-body-4 text-neutral-3">
                {block.text}
              </p>
            );
          }
          return (
            <ul key={key} className="mt-4 list-disc space-y-2 pl-6 text-body-4 text-neutral-3">
              {keyed(block.items, (item) => item).map(({ item, key: itemKey }) => (
                <li key={itemKey}>{item}</li>
              ))}
            </ul>
          );
        })}
      </article>
    </PageContainer>
  );
}
