import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { bulgogi, gimbap } from '@/components/storefront.fixtures';
import { DishCard } from '@/components/dish/dish-card';
import { FavoriteButton } from './favorite-button';
import { FavoritesContext, type FavoritesValue } from './favorites-context';

/** Hearts kept in the story only: nothing is sent anywhere. */
function LocalFavorites({ initial, children }: { initial: string[]; children: React.ReactNode }) {
  const [ids, setIds] = useState(initial);
  const value: FavoritesValue = {
    signedIn: true,
    isFavorite: (id) => ids.includes(id),
    toggle: (dish) => {
      setIds((current) =>
        current.includes(dish.id) ? current.filter((id) => id !== dish.id) : [...current, dish.id],
      );
      return true;
    },
    set: (dish, on) =>
      setIds((current) => (on ? [...current, dish.id] : current.filter((id) => id !== dish.id))),
  };
  return <FavoritesContext value={value}>{children}</FavoritesContext>;
}

/** The story's saved dishes, from `parameters.favorites`. */
const savedIn = (parameters: Record<string, unknown>): string[] => {
  const saved: unknown = parameters.favorites;
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
};

const meta = {
  title: 'Favorites/FavoriteButton',
  component: FavoriteButton,
  parameters: { layout: 'padded', nextjs: { appDirectory: true } },
  args: { dish: { id: bulgogi.id, title: bulgogi.title } },
  decorators: [
    (Story, { parameters }) => (
      <LocalFavorites initial={savedIn(parameters)}>
        <div className="bg-neutral-8 p-4">
          <Story />
        </div>
      </LocalFavorites>
    ),
  ],
} satisfies Meta<typeof FavoriteButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Not saved: the outlined heart. Its name never changes; `aria-pressed` says the state. */
export const Off: Story = {
  play: async ({ canvasElement }) => {
    const heart = within(canvasElement).getByRole('button', { name: 'Favorite Bulgogi' });
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(heart);
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
  },
};

/** Saved: pink on its white circle. */
export const On: Story = { parameters: { favorites: [bulgogi.id] } };

/** The solid focus ring, 2 px offset. */
export const Focus: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('button')).toHaveFocus();
  },
};

/** Beside a card's link, never inside it: the card stays one link (D20). */
export const OnCards: Story = {
  parameters: { favorites: [gimbap.id] },
  render: () => (
    <div className="grid w-[700px] grid-cols-2 gap-6">
      <DishCard dish={bulgogi} layout="responsive" />
      <DishCard dish={gimbap} layout="compact" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nested = canvas
      .getAllByRole('link')
      .filter((link) => within(link).queryByRole('button') !== null);
    await expect(nested).toHaveLength(0);
    await expect(canvas.getByRole('button', { name: 'Favorite Gimbap' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};
