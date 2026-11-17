import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import type { AddressDto } from '@/server/modules/addresses/schema';
import { AddressCard } from './address-card';

const home: AddressDto = {
  id: '01900000-0000-7000-8000-000000000001',
  kind: 'HOME',
  label: 'Home',
  line1: '12 Peterborough Street',
  line2: 'Apt 3',
  city: 'Boston, MA 02215',
  notes: 'Buzzer 3, leave at the door <script>',
  lat: 42.3467,
  lng: -71.0972,
  isDefault: true,
  createdAt: '2026-11-16T12:00:00.000Z',
  deliverable: true,
  distanceKm: 4.3,
};

const meta = {
  title: 'Account/AddressCard',
  component: AddressCard,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-[420px]">
        <Story />
      </div>
    ),
  ],
  args: {
    address: home,
    isDefault: true,
    canEdit: true,
    busy: false,
    onSetDefault: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof AddressCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default address; instructions are shown as typed, as text. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Default')).toBeVisible();
    await expect(canvas.getByText('Buzzer 3, leave at the door <script>')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Edit Home' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /^Set as default/ })).toBeNull();
  },
};

/** Another address: it can become the default. */
export const NotDefault: Story = {
  args: {
    address: {
      ...home,
      kind: 'WORK',
      label: 'Work',
      line1: '1 Faneuil Hall Square',
      line2: null,
      notes: null,
      isDefault: false,
    },
    isDefault: false,
  },
};

/** Saved while inside the area; the radius has since shrunk (S4.13). */
export const OutsideNow: Story = {
  args: { address: { ...home, deliverable: false, distanceKm: 8.6 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Outside our delivery area now')).toBeVisible();
  },
};

/** The shared demo account: shown, never changed (U2). */
export const ReadOnly: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByRole('button')).toHaveLength(0);
  },
};
