import type { ReactNode } from 'react';
import { StorefrontChrome } from '@/components/layout/storefront-chrome';

/** Every customer-facing page: the storefront's header, notices and footer around it. */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return <StorefrontChrome>{children}</StorefrontChrome>;
}
