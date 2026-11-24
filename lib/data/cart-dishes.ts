import {
  collectionOptions,
  type DbClient,
  localStorageCollectionOptions,
  type Parser,
  type StorageApi,
  type StorageEventApi,
  useDbClient,
  useLiveQuery,
} from '@tanstack/react-db';
import { z } from 'zod';
import { useHydrated } from '@/lib/use-hydrated';

/*
 * What the cart shows for a dish before the server has answered (F3 S2.10, B8, design D7): its
 * name, page, photo and the last unit price the customer was shown. It is written when a dish is
 * added (the dish page and the taste picker know these) and refreshed by every quote.
 *
 * Display only: nothing here is ever sent to the server, and every figure that counts comes from
 * the quote. The last shown price is kept only to say "Now $13.99 (was $12.99)" (S3.3).
 */

export const cartDishSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  /** A path on this site, never another origin (anyone can edit localStorage). */
  image: z
    .string()
    .max(500)
    .regex(/^\/(?![/\\])\S*$/)
    .nullable(),
  /** The last unit price shown to the customer. */
  priceCents: z.int().min(0),
  /**
   * The extras the dish offered when last seen. Only says whether an extra the server takes off
   * was once offered ("isn't offered … any more", S3.4) or never was (S1.16).
   */
  flavorsOffered: z.array(z.string().min(1).max(40)).max(30).optional(),
});
export type CartDish = z.infer<typeof cartDishSchema>;

const storedSchema = z.object({ versionKey: z.string(), data: cartDishSchema });

const parser: Parser = {
  stringify: (value) => JSON.stringify(value),
  parse(raw) {
    try {
      const saved: unknown = JSON.parse(raw);
      if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {};
      return Object.fromEntries(
        Object.entries(saved).filter(([key, entry]) => {
          const dish = storedSchema.safeParse(entry);
          return dish.success && key.replace(/^s:/, '') === dish.data.data.id;
        }),
      );
    } catch {
      return {};
    }
  },
};

export const cartDishesCollection = collectionOptions('cartDishes', (client) =>
  localStorageCollectionOptions({
    id: 'cartDishes',
    storageKey: 'foodz.cart.dishes.v1',
    schema: cartDishSchema,
    getKey: (dish) => dish.id,
    parser,
    startSync: true,
    storage: client.getDependency<StorageApi>('storage'),
    storageEventApi: client.getDependency<StorageEventApi>('storageEvents'),
  }),
);

/** What the server said about a dish in a quote. */
export interface QuotedDish {
  id: string;
  title: string;
  slug: string;
  image: string | null;
  unitPriceCents: number;
  flavorsOffered: readonly string[];
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether the dish offered every one of these extras the last time it was seen. False when it
 * never did, or when nothing is known about it (an older saved entry).
 */
export function wereOffered(dish: CartDish | undefined, flavors: readonly string[]): boolean {
  const offered = dish?.flavorsOffered;
  return offered !== undefined && flavors.every((flavor) => offered.includes(flavor));
}

export function cartDishActions(client: DbClient) {
  const dishes = client.collection(cartDishesCollection);

  const put = (dish: CartDish) => {
    const parsed = cartDishSchema.safeParse(dish);
    if (!parsed.success) return;
    const current = dishes.get(dish.id);
    if (!current) {
      dishes.insert(parsed.data);
      return;
    }
    const flavorsOffered = parsed.data.flavorsOffered ?? current.flavorsOffered;
    if (
      current.title === dish.title &&
      current.slug === dish.slug &&
      current.image === dish.image &&
      current.priceCents === dish.priceCents &&
      sameList(current.flavorsOffered, flavorsOffered)
    ) {
      return;
    }
    dishes.update(dish.id, (draft) => {
      draft.title = parsed.data.title;
      draft.slug = parsed.data.slug;
      draft.image = parsed.data.image;
      draft.priceCents = parsed.data.priceCents;
      if (flavorsOffered) draft.flavorsOffered = [...flavorsOffered];
    });
  };

  return {
    /** A dish was just added: the customer saw this price. */
    remember(dish: CartDish) {
      put(dish);
    },

    /**
     * Fills in what a quote says. Names and photos follow the server at once; a price already
     * shown stays until it is acknowledged, so the change can be pointed out.
     */
    learn(quoted: readonly QuotedDish[]) {
      for (const dish of quoted) {
        const current = dishes.get(dish.id);
        put({
          id: dish.id,
          title: dish.title,
          slug: dish.slug,
          image: dish.image,
          priceCents: current ? current.priceCents : dish.unitPriceCents,
          flavorsOffered: [...dish.flavorsOffered],
        });
      }
    },

    /** The new prices have been seen (notice dismissed or cart closed): they are "last shown" now. */
    acknowledgePrices(prices: ReadonlyMap<string, number>) {
      for (const [id, priceCents] of prices) {
        const current = dishes.get(id);
        if (current && current.priceCents !== priceCents) put({ ...current, priceCents });
      }
    },

    /** Keeps only the dishes still in the cart. */
    keepOnly(ids: ReadonlySet<string>) {
      const gone = [...dishes.keys()].filter((id) => !ids.has(id));
      if (gone.length > 0) dishes.delete(gone);
    },
  };
}

export type CartDishActions = ReturnType<typeof cartDishActions>;

/** Empty while the page hydrates, as on the server (see `useCart`). */
export function useCartDishes(): ReadonlyMap<string, CartDish> {
  const hydrated = useHydrated();
  const { data } = useLiveQuery({ query: (q) => q.from({ dish: cartDishesCollection }) });
  return new Map((hydrated ? (data ?? []) : []).map((dish) => [dish.id, dish]));
}

export function useCartDishActions(): CartDishActions {
  return cartDishActions(useDbClient());
}
