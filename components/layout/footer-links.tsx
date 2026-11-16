'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Accordion as AccordionPrimitive } from 'radix-ui';
import type { FooterLinkGroup } from '@/server/modules/menu/schema';
import { isSitePath } from '@/lib/navigation';

function FooterLink({
  label,
  href,
  className,
}: {
  label: string;
  href: string;
  className: string;
}) {
  if (isSitePath(href)) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <a href={href} className={className} rel="noopener noreferrer">
      {label}
    </a>
  );
}

/**
 * Footer link groups from the store settings. Phones get one row per group that opens in place
 * (the design's arrow rows); from `md` every group is listed in full.
 */
export function FooterLinks({ groups }: { groups: FooterLinkGroup[] }) {
  return (
    <nav aria-label="Footer">
      <AccordionPrimitive.Root type="multiple" className="divide-y divide-neutral-6 md:hidden">
        {groups.map((group) => (
          <AccordionPrimitive.Item key={group.title} value={group.title}>
            <AccordionPrimitive.Header asChild>
              <h2>
                <AccordionPrimitive.Trigger className="group flex h-12 w-full items-center justify-between text-left text-button-2 font-medium text-neutral-1">
                  {group.title}
                  <ChevronRight
                    className="size-5 text-neutral-3 transition-transform duration-200 group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                    aria-hidden
                  />
                </AccordionPrimitive.Trigger>
              </h2>
            </AccordionPrimitive.Header>
            <AccordionPrimitive.Content className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 motion-reduce:animate-none">
              <ul className="pb-3">
                {group.links.map((link) => (
                  <li key={`${link.label}-${link.href}`}>
                    <FooterLink
                      label={link.label}
                      href={link.href}
                      className="flex min-h-11 items-center text-body-4 text-muted-foreground hover:text-neutral-2"
                    />
                  </li>
                ))}
              </ul>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        ))}
      </AccordionPrimitive.Root>

      <div className="hidden gap-16 md:flex">
        {groups.map((group) => (
          <div key={group.title}>
            <h2 className="text-button-1 font-medium text-neutral-1">{group.title}</h2>
            <ul className="mt-4 space-y-4">
              {group.links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <FooterLink
                    label={link.label}
                    href={link.href}
                    className="inline-flex py-1 text-body-4 text-muted-foreground hover:text-neutral-2"
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
