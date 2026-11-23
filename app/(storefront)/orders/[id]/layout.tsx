import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActor } from '@/server/auth/session';
import { authPageHref } from '@/lib/auth-links';
import { loadOrder } from './load-order';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const order = await loadOrder((await params).id);
  return order
    ? { title: `Order ${order.number}`, robots: { index: false } }
    : { title: 'Order not found', robots: { index: false } };
}

/**
 * Settles the order before anything streams (F4 design 3.1, 3.12): signed out goes to sign in
 * and back; another customer's id, a made-up id and an order number all answer the same 404.
 */
export default async function OrderLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if ((await getActor()).kind !== 'user') redirect(authPageHref('/sign-in', `/orders/${id}`));
  if (!(await loadOrder(id))) notFound();
  return children;
}
