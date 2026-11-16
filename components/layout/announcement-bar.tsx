'use client';

import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Button } from '@/components/ui/button';
import { splitByCode } from '@/lib/format';
import { prefersReducedMotion } from '@/lib/motion';
import { PageContainer } from './page-container';
import { ANNOUNCEMENT_COOKIE } from './announcement';

export interface AnnouncementBarProps {
  campaignId: string;
  title: string;
  subtitle: string | null;
  code: string | null;
}

function CodeChip({ code }: { code: string }) {
  return <span className="font-semibold tracking-wider text-brand select-all">{code}</span>;
}

function WithCode({ text, code }: { text: string; code: string | null }) {
  if (!code) return text;
  return splitByCode(text, code).map((part) =>
    part.isCode ? <CodeChip key={part.start} code={part.text} /> : part.text,
  );
}

/**
 * The site-wide offer strip. Rendered on the server with the page, so it never pushes content
 * down after load. Closing it sets a session cookie, so it stays closed for the rest of the visit.
 */
export function AnnouncementBar({ campaignId, title, subtitle, code }: AnnouncementBarProps) {
  const [open, setOpen] = useState(true);
  const barRef = useRef<HTMLElement>(null);

  if (!open) return null;

  const close = () => {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${ANNOUNCEMENT_COOKIE}=${encodeURIComponent(campaignId)}; path=/; samesite=lax${secure}`;
    // Focus would otherwise fall back to the top of the page.
    document.querySelector<HTMLElement>('header a')?.focus();
    const bar = barRef.current;
    if (!bar || prefersReducedMotion()) {
      setOpen(false);
      return;
    }
    gsap.to(bar, {
      opacity: 0,
      duration: 0.16,
      ease: 'power2.in',
      onComplete: () => setOpen(false),
    });
  };

  const showsCodeInSubtitle = Boolean(code && subtitle && splitByCode(subtitle, code).length > 1);

  return (
    <section ref={barRef} aria-label="Announcement" className="bg-neutral-1 text-neutral-8">
      <PageContainer className="flex min-h-10 items-center gap-2 py-2">
        <p className="line-clamp-2 flex-1 text-body-5 md:line-clamp-1 md:text-center">
          <span className="md:hidden">
            {title}
            {code ? (
              <>
                {' '}
                <CodeChip code={code} />
              </>
            ) : null}
          </span>
          <span className="hidden md:inline">
            {title}
            {subtitle ? (
              <>
                {' · '}
                <WithCode text={subtitle} code={code} />
              </>
            ) : null}
            {code && !showsCodeInSubtitle ? (
              <>
                {' '}
                <CodeChip code={code} />
              </>
            ) : null}
          </span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label="Close announcement"
          onClick={close}
          className="shrink-0 text-neutral-8 hover:bg-neutral-2 hover:text-neutral-8 focus-visible:outline-neutral-8"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </PageContainer>
    </section>
  );
}
