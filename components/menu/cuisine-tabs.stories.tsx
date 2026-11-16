import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import type { Cuisine } from '@/server/db/enums';
import { CUISINES } from '@/server/modules/menu/urls';
import { menuCounts, menuDishes } from '@/components/storefront.fixtures';
import { CuisineTabs, type CuisineTabsProps } from './cuisine-menu';

function ControlledTabs({
  dishes,
  counts,
  value: initial,
}: Omit<CuisineTabsProps, 'onValueChange'>) {
  const [value, setValue] = useState<Cuisine>(initial);
  return (
    <CuisineTabs
      dishes={dishes}
      counts={counts}
      value={value}
      onValueChange={(next) => setValue(CUISINES.find((cuisine) => cuisine === next) ?? value)}
    />
  );
}

const meta = {
  title: 'Storefront/CuisineTabs',
  component: ControlledTabs,
  parameters: { layout: 'padded', nextjs: { appDirectory: true } },
  args: { dishes: menuDishes, counts: menuCounts, value: 'KOREAN' },
} satisfies Meta<typeof ControlledTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Korean, Thai and Vietnamese with their counts; the grid shows the selected cuisine. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Korean, 8 dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await userEvent.click(canvas.getByRole('tab', { name: /^Thai/ }));
    await expect(canvas.getByRole('tab', { name: 'Thai, 3 dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(canvas.getByRole('heading', { name: 'Thai dishes' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: /^Pad Thai, \$21\.99/ })).toBeVisible();
  },
};

/** Opened from a shared link: /menu?cuisine=vietnamese. */
export const Vietnamese: Story = {
  args: { value: 'VIETNAMESE' },
};

/** A cuisine with nothing on it yet: the tab stays, with an empty state and a way out. */
export const EmptyCuisine: Story = {
  args: {
    dishes: menuDishes.filter((dish) => dish.cuisine !== 'THAI'),
    counts: { ...menuCounts, THAI: 0 },
    value: 'THAI',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'No Thai dishes yet' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'See Korean dishes' }));
    await expect(canvas.getByRole('tab', { name: 'Korean, 8 dishes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};
