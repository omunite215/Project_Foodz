import type { Metadata } from 'next';
import { getActor } from '@/server/auth/session';
import { getMyFavorites } from '@/server/modules/favorites/service';
import { FavoritesList } from '@/components/favorites/favorites-list';

export const metadata: Metadata = { title: 'Favorites' };

/** The dishes she has hearted, newest first (F3 S5.4 to S5.7). */
export default async function FavoritesPage() {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  const favorites = await getMyFavorites(actor);
  return <FavoritesList dishes={favorites.dishes} />;
}
