import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canonicalDishSlug } from '@/server/modules/menu/urls';
import { loadDish } from '@/lib/storefront-data';

type Props = { params: Promise<{ slug: string }> };

/**
 * Titles the 404 only when the dish exists. When it does not, the dish layout answers 404 and
 * titles the page itself; a title set here as well would replace it without the " | Foodz" suffix.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const canonical = canonicalDishSlug((await params).slug);
  const dish = canonical ? await loadDish(canonical) : null;
  return dish ? { title: 'Dish not found', robots: { index: false } } : {};
}

/**
 * Nothing lives below a dish page (old /menu/<cuisine>/<id> links are redirected in next.config).
 * This route sits outside the (dish) group so the dish skeleton never starts streaming first;
 * otherwise the not-found page would be sent with status 200.
 */
export default function NothingBelowDish(): never {
  notFound();
}
