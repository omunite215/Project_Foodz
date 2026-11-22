import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { PROMO_UNAVAILABLE } from '@/server/modules/cart/promo-text';
import { compareSide, tooManyCodesText } from '@/lib/cart-text';
import {
  offersFixture,
  quoteQ1FreeDelivery,
  quoteQ1Kbbq5,
  quoteQ4,
  quoteQ5,
} from './cart.fixtures';
import {
  CartOffers,
  PromoChip,
  PromoCompare,
  type PromoMessage,
  PromoMessageLine,
} from './promo-parts';

/*
 * The promo code section (F3 design 2.10 to 2.14). R1 to R8 read as field errors, R9 as a
 * neutral status; the word "invalid" is never used.
 */

const meta = {
  title: 'Cart/Promo',
  component: PromoChip,
  parameters: { layout: 'padded', nextjs: { appDirectory: true } },
  args: {
    code: 'KBBQ5',
    promo: { status: 'applied', description: '$5 off Korean dishes over $25', reason: null },
    onRemove: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-[392px] bg-neutral-8 p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PromoChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Attached and in the total. */
export const ChipApplied: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Applied')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Remove KBBQ5' })).toBeVisible();
  },
};

/** Under its minimum (R9): attached, and applies by itself once the cart reaches it. */
export const ChipNotAppliedYet: Story = {
  args: {
    promo: {
      status: 'notApplied',
      description: '$5 off Korean dishes over $25',
      reason: {
        code: 'minimumNotReached',
        rule: 'R9',
        minSubtotalCents: 2500,
        eligibleCents: 699,
        shortfallCents: 1801,
        cuisines: ['KOREAN'],
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Add $18.01 of Korean dishes to use it.'),
    ).toBeVisible();
  },
};

const MESSAGES: PromoMessage[] = [
  { tone: 'success', text: 'KBBQ5 applied. You save $5.00.' },
  {
    tone: 'error',
    invalid: true,
    text: "We couldn't find the code NOPE. Check the spelling, or try another code.",
  },
  {
    tone: 'error',
    invalid: true,
    text: 'NEXTWEEK starts on Friday, November 27. You can use it from then.',
  },
  {
    tone: 'error',
    invalid: true,
    text: "SUMMER25 ended on October 21, so it can't be used any more.",
  },
  { tone: 'error', invalid: true, text: 'Sorry, FIRST100 has run out.' },
  {
    tone: 'error',
    invalid: true,
    signInCode: 'WELCOME10',
    text: "Sign in to use WELCOME10. It's one per customer, so we need to know it's you.",
  },
  { tone: 'error', invalid: true, text: "You've already used WELCOME10. It's one per customer." },
  {
    tone: 'error',
    invalid: true,
    text: "WELCOME10 is on hold for your unpaid order 1042. It frees up if that order isn't paid within 15 minutes.",
  },
  {
    tone: 'error',
    invalid: true,
    text: 'KBBQ5 is for Korean dishes. Add a Korean dish to use it.',
  },
  { tone: 'neutral', text: 'WELCOME10 needs a subtotal of $15.00. Add $8.01 more to use it.' },
  { tone: 'error', invalid: false, text: PROMO_UNAVAILABLE },
  { tone: 'limited', text: tooManyCodesText(600) },
  { tone: 'offline', text: "You're offline. We'll check the code when you're back online." },
];

/** Every answer under the field: applied, R1 to R9, checker down, too many tries, offline. */
export const Messages: Story = {
  render: () => (
    <div className="space-y-2">
      {MESSAGES.map((message, index) => (
        <PromoMessageLine
          key={message.text}
          id={`message-${index}`}
          message={message}
          signInHref="/sign-in?reason=promo"
        />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(canvas.queryByText(/invalid/i)).toBeNull();
  },
};

/** One code per order (S4.7): the cheaper one first, tagged "Saves more". */
export const CompareCheaperFirst: Story = {
  render: () => (
    <PromoCompare
      state={{
        status: 'ready',
        current: compareSide('KBBQ5', quoteQ4),
        next: compareSide('FREEDELIVERY', quoteQ5),
        nextQuote: quoteQ5,
      }}
      onKeep={() => {}}
      onUse={() => {}}
      onRetry={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'One promo code per order' })).toBeVisible();
    const buttons = canvas.getAllByRole('button');
    await expect(buttons[0]).toHaveTextContent('Keep KBBQ5');
  },
};

/** Both give the same total: no "Saves more", keeping is first. */
export const CompareEqual: Story = {
  render: () => (
    <PromoCompare
      state={{
        status: 'ready',
        current: compareSide('KBBQ5', quoteQ4),
        next: compareSide('TRY5', quoteQ4),
        nextQuote: quoteQ5,
      }}
      onKeep={() => {}}
      onUse={() => {}}
      onRetry={() => {}}
    />
  ),
};

/**
 * A guest with no address yet (D5): KBBQ5's total leaves delivery out, FREEDELIVERY's has it
 * free. The fee decides which is cheaper, so neither is tagged and the card says so.
 */
export const CompareBeforeDelivery: Story = {
  render: () => (
    <PromoCompare
      state={{
        status: 'ready',
        current: compareSide('KBBQ5', quoteQ1Kbbq5),
        next: compareSide('FREEDELIVERY', quoteQ1FreeDelivery),
        nextQuote: quoteQ1FreeDelivery,
      }}
      onKeep={() => {}}
      onUse={() => {}}
      onRetry={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/\$45\.98 before delivery\..*depends on your delivery fee/),
    ).toBeVisible();
    await expect(canvas.queryByText('Saves more')).toBeNull();
    await expect(canvas.getAllByRole('button')[0]).toHaveTextContent('Keep KBBQ5');
  },
};

/** The two totals failed to come back: nothing is swapped. */
export const CompareFailed: Story = {
  render: () => (
    <PromoCompare
      state={{ status: 'failed', code: 'FREEDELIVERY' }}
      onKeep={() => {}}
      onUse={() => {}}
      onRetry={() => {}}
    />
  ),
};

/** Running campaigns with a public code, each one tap away (S4.10). */
export const Offers: Story = {
  render: () => <CartOffers offers={offersFixture} appliedCode="KBBQ5" onApply={() => {}} />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Apply FREEDELIVERY' }),
    ).toBeVisible();
  },
};
