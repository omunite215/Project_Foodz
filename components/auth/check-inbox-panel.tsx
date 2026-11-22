'use client';

import Image from 'next/image';
import { type ReactNode, useEffect, useRef } from 'react';
import { FadeIn } from '@/components/forms/feedback';

/**
 * Replaces a form, title block included, once its email is on the way ("Check your inbox",
 * "Check your email"), so its heading is the page's h1. It takes focus, so the result is read at
 * once (S7.6, S7.7).
 */
export function CheckInboxPanel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <FadeIn className="text-center">
      <Image
        src="/illustrations/mobile-inbox.svg"
        alt=""
        width={200}
        height={148}
        unoptimized
        className="mx-auto h-auto w-40 md:w-50"
      />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-6 font-heading text-title-1 text-neutral-2 focus:outline-none"
      >
        {title}
      </h1>
      <p className="mt-3 text-body-4 text-neutral-3 [overflow-wrap:anywhere]">{children}</p>
      <div className="mt-8 flex flex-col gap-3">{actions}</div>
    </FadeIn>
  );
}
