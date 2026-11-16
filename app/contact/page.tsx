import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';

export const metadata: Metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <PageContainer className="pt-10 pb-15 md:pt-20 md:pb-20">
      <h1 className="text-center font-heading text-h4 leading-tight text-neutral-2 md:text-h2">
        Contact us
      </h1>
    </PageContainer>
  );
}
