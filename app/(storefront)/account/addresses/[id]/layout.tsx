import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { loadAddress } from './load-address';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const address = await loadAddress((await params).id);
  return address
    ? { title: 'Edit address' }
    : { title: 'Address not found', robots: { index: false } };
}

/**
 * Settles the address before anything streams, so a made-up id and another customer's id both
 * answer 404 with the same page (S4.14). The page's skeleton sits below this layout.
 */
export default async function AddressLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  if (!(await loadAddress((await params).id))) notFound();
  return children;
}
