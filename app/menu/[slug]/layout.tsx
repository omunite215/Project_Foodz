import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { canonicalDishSlug, dishHref } from '@/server/modules/menu/urls';
import { loadDish } from '@/lib/storefront-data';

/** The tab title of the dish-not-found page; the dish page sets its own. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const canonical = canonicalDishSlug((await params).slug);
  const dish = canonical ? await loadDish(canonical) : null;
  return dish ? {} : { title: 'Dish not found', robots: { index: false } };
}

/**
 * Settles the address before anything streams, so the status code is right: unknown dishes
 * answer 404 and "/menu/BULGOGI" moves permanently to "/menu/bulgogi". (The page's loading
 * skeleton sits below this layout; a check inside the page would already have answered 200.)
 */
export default async function DishLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const canonical = canonicalDishSlug(slug);
  if (!canonical) notFound();
  if (canonical !== slug) permanentRedirect(dishHref(canonical));
  if (!(await loadDish(canonical))) notFound();
  return children;
}
