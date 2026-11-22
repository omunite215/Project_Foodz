import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** F1's "Go back" bar (Figma Checkout): shown at every size on account sub-pages. */
export function BackLink({ href, children }: { href: Route; children: string }) {
  return (
    <Button
      asChild
      variant="outline"
      size="touch"
      className="border-brand-strong bg-transparent text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
    >
      <Link href={href}>
        <ArrowLeft className="size-6" aria-hidden />
        {children}
      </Link>
    </Button>
  );
}
