import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useRef, useState } from 'react';
import { expect, within } from 'storybook/test';
import { savedCardFixture } from '@/components/orders/orders.fixtures';
import { CardSection, type CardSectionProps, NEW_CARD } from './card-section';
import type { CardFieldsHandle, CardFormStatus } from './stripe-card';

/*
 * The card part of "Payment" (F4 design 2.13). Stripe's fields load Stripe.js from the network
 * when a story is opened (with a placeholder key nothing is charged to); offline, the fields stay
 * hidden and checkout shows its "couldn't load the card form" alert instead.
 */

const visa = savedCardFixture();
const mastercard = savedCardFixture({
  id: 'pm_card_mastercard_4444',
  brand: 'mastercard',
  brandLabel: 'Mastercard',
  last4: '4444',
  label: 'Mastercard •••• 4444',
  spoken: 'Mastercard ending in 4444',
  expiry: '03/31',
});
const expired = savedCardFixture({
  id: 'pm_card_visa_expired',
  last4: '0005',
  label: 'Visa •••• 0005',
  spoken: 'Visa ending in 0005',
  expMonth: 8,
  expYear: 2026,
  expired: true,
  expiry: '08/26',
});

type Args = Pick<CardSectionProps, 'savedCards' | 'demo' | 'testMode'> & { startWith?: string };

function Section({ savedCards, demo, testMode, startWith }: Args) {
  const fields = useRef<CardFieldsHandle>(null);
  const [choice, setChoice] = useState(
    startWith ?? savedCards.find((card) => !card.expired)?.id ?? NEW_CARD,
  );
  const [save, setSave] = useState(false);
  const [status, setStatus] = useState<CardFormStatus>('loading');
  return (
    <div data-status={status}>
      <CardSection
        savedCards={savedCards}
        savedCardLimit={5}
        choice={choice}
        onChoice={setChoice}
        saveCard={save}
        onSaveCard={setSave}
        publishableKey="pk_test_storybook"
        testMode={testMode}
        demo={demo}
        fieldsRef={fields}
        formAttempt={0}
        onFormStatus={setStatus}
        onRemoveCard={() => {}}
      />
    </div>
  );
}

const meta = {
  title: 'Checkout/CardSection',
  component: Section,
  parameters: { layout: 'padded' },
  args: { savedCards: [], demo: false, testMode: true },
  decorators: [
    (Story) => (
      <div className="w-[375px] max-w-full bg-neutral-8 p-4 md:w-[526px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A first card: the three fields, "Save this card" unticked (U4) and the test-mode note. */
export const NewCard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('Save this card for next time')).not.toBeChecked();
    await expect(canvas.getByText(/^Test mode: no real money moves\./)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Copy test card number' })).toBeVisible();
  },
};

/** Saved cards, the most recently used chosen; an expired one can't be chosen and offers Remove. */
export const SavedCards: Story = {
  args: { savedCards: [visa, mastercard, expired] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('radio', { name: 'Visa ending in 4242, expires 12/34' }),
    ).toBeChecked();
    await expect(
      canvas.getByRole('radio', { name: 'Visa ending in 0005, expired 08/26' }),
    ).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Remove Visa ending in 0005' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Manage saved cards' })).toHaveAttribute(
      'href',
      '/account/cards',
    );
  },
};

/** "Use a new card" chosen with five cards saved: the save box gives way to the limit line. */
export const FiveCardsSaved: Story = {
  args: {
    savedCards: [
      visa,
      mastercard,
      savedCardFixture({
        id: 'pm_3',
        last4: '1111',
        label: 'Visa •••• 1111',
        spoken: 'Visa ending in 1111',
      }),
      savedCardFixture({
        id: 'pm_4',
        last4: '2222',
        label: 'Visa •••• 2222',
        spoken: 'Visa ending in 2222',
      }),
      expired,
    ],
    startWith: NEW_CARD,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^You have 5 saved cards\./)).toBeVisible();
    await expect(canvas.queryByLabelText('Save this card for next time')).toBeNull();
  },
};

/** The shared demo account: fields shown but disabled, no saved cards, nothing to save (S1.4). */
export const Demo: Story = {
  args: { savedCards: [visa], demo: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('radio')).toBeNull();
    await expect(canvas.queryByLabelText('Save this card for next time')).toBeNull();
  },
};
