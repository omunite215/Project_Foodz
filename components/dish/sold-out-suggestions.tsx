import type { Cuisine } from '@/server/db/enums';
import type { DishCard as Dish } from '@/server/modules/menu/schema';
import { CUISINE_LABELS } from '@/lib/format';
import { DishCard } from './dish-card';

/** Up to three available dishes of the same cuisine, under a sold-out dish. */
export function SoldOutSuggestions({ cuisine, dishes }: { cuisine: Cuisine; dishes: Dish[] }) {
  if (dishes.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-title" className="mt-12">
      <h2 id="suggestions-title" className="font-heading text-title-2 text-neutral-2">
        More {CUISINE_LABELS[cuisine]} dishes
      </h2>
      <ul className="mt-4 grid gap-4 md:grid-cols-3">
        {dishes.map((dish) => (
          <li key={dish.id}>
            <DishCard dish={dish} layout="compact" className="h-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}
