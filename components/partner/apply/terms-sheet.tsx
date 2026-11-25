'use client';

import { X } from 'lucide-react';
import { useRef } from 'react';
import type { ContentBlock, LegalPage } from '@/server/modules/content/schema';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { termsVersionLine } from '@/lib/partner/text';

/*
 * The Partner Terms (F6 design 4.8): a bottom sheet from step 4, inside the partner root so it
 * keeps the theme; the same content as `/partner/terms`. Plain text blocks rendered as
 * elements: nothing from the content becomes markup.
 */

const keyOf = (block: ContentBlock, index: number) =>
  `${index}:${block.type === 'list' ? block.items.join('|') : block.text}`;

export function TermsProse({ blocks }: { blocks: readonly ContentBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Heading = block.level === 3 ? 'h4' : 'h3';
          return (
            <Heading
              key={keyOf(block, index)}
              className={
                block.level === 3
                  ? 'mt-6 text-body-4 font-semibold text-strong'
                  : 'mt-8 text-body-3 font-semibold text-strong first:mt-0'
              }
            >
              {block.text}
            </Heading>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p key={keyOf(block, index)} className="mt-3 text-body-4 text-foreground">
              {block.text}
            </p>
          );
        }
        return (
          <ul
            key={keyOf(block, index)}
            className="mt-3 list-disc space-y-2 pl-6 text-body-4 text-foreground"
          >
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      })}
    </>
  );
}

export const TERMS_UNAVAILABLE = "We couldn't load the Partner Terms. Try again.";

export function PartnerTermsSheet({
  open,
  terms,
  timeZone,
  onOpenChange,
  onCloseFocus,
}: {
  open: boolean;
  terms: LegalPage | null;
  timeZone: string;
  onOpenChange: (open: boolean) => void;
  onCloseFocus: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="inset-x-0 bottom-0 mx-auto h-[92dvh] max-w-md rounded-t-2xl bg-card text-foreground data-[state=open]:slide-in-from-bottom-6 motion-reduce:data-[state=open]:slide-in-from-bottom-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseFocus();
        }}
      >
        <div className="flex items-start gap-3 border-b border-border px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle
              ref={titleRef}
              tabIndex={-1}
              className="font-heading text-title-2 text-strong outline-none"
            >
              Foodz Partner Terms
            </SheetTitle>
            <SheetDescription className="mt-1 text-body-5 text-muted-foreground">
              {terms
                ? termsVersionLine(terms.version, terms.publishedAt, timeZone)
                : 'Partner Terms'}
            </SheetDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-kitchen"
            aria-label="Close"
            className="-mt-1 -mr-2 text-strong"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-6" aria-hidden />
          </Button>
        </div>
        {/* The terms scroll on their own: a Tab stop lets keyboard users scroll them too. */}
        <section
          aria-label="Partner Terms text"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-5 focus-visible:-outline-offset-2"
        >
          {terms ? (
            <TermsProse blocks={terms.blocks} />
          ) : (
            <p className="rounded-xl bg-danger-soft px-4 py-3 text-body-4 text-strong">
              {TERMS_UNAVAILABLE}
            </p>
          )}
        </section>
        <div className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" size="dock" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
