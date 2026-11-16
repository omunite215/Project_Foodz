import { notFound } from 'next/navigation';

/**
 * Nothing lives below a dish page (old /menu/<cuisine>/<id> links are redirected in next.config).
 * This route sits outside the (dish) group so the dish skeleton never starts streaming first;
 * otherwise the not-found page would be sent with status 200.
 */
export default function NothingBelowDish(): never {
  notFound();
}
