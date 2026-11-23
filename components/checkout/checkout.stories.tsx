import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Clock, Info } from 'lucide-react';
import { expect, within } from 'storybook/test';
import type { Quote } from '@/server/modules/cart/schema';
import { quoteQ2 } from '@/components/cart/cart.fixtures';
import { savedCardFixture } from '@/components/orders/orders.fixtures';
import { NOTICE_ICONS, NoticeList } from './checkout-notices';
import { PayBar } from './pay-bar';
import { PaymentAlert, PaymentMethod } from './payment-method';
import { TipPicker } from './tip-picker';
import { CardName, ExpiredChip } from './card-section';

/*
 * Checkout's parts in their states (F4 design 2.11 to 2.18). The figures are the story's worked
 * totals (Priya, cart A, Work 1.3 km).
 */

const quote: Quote = { ...quoteQ2, tipCents: 720, totalCents: 6117 };

const meta = {
  title: 'Checkout/Parts',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[375px] max-w-full bg-neutral-8 p-4 md:w-[526px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ------------------------------------------------------------------ tip (2.11)

const tipArgs = {
  onTile: () => {},
  otherText: '',
  onOtherText: () => {},
  onOtherBlur: () => {},
  otherError: null,
  otherCents: null,
  quote,
  failed: false,
  dim: false,
};

export const TipNone: Story = {
  render: () => <TipPicker {...tipArgs} tile={{ kind: 'none' }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('radio', { name: 'No tip' })).toBeChecked();
  },
};

export const TipFifteen: Story = {
  render: () => <TipPicker {...tipArgs} tile={{ kind: 'percent', percent: 15 }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('radio', { name: '15 %, $7.20' })).toBeChecked();
  },
};

export const TipOtherAmount: Story = {
  render: () => <TipPicker {...tipArgs} tile={{ kind: 'other' }} otherText="5" otherCents={500} />,
};

export const TipOtherNotAnAmount: Story = {
  render: () => (
    <TipPicker
      {...tipArgs}
      tile={{ kind: 'other' }}
      otherText="5.555"
      otherError="Enter an amount in dollars and cents, like 5.50."
    />
  ),
};

export const TipOtherOverLimit: Story = {
  render: () => (
    <TipPicker
      {...tipArgs}
      tile={{ kind: 'other' }}
      otherText="120"
      otherError="Tips can be up to $100.00."
    />
  ),
};

export const TipLoading: Story = {
  render: () => <TipPicker {...tipArgs} quote={null} tile={{ kind: 'none' }} />,
};

// ------------------------------------------------------------------ payment method (2.12)

const methodArgs = {
  onMethod: () => {},
  cardBlocked: null,
  cashBlocked: null,
  alert: null,
  totalCents: 5397,
  tipCents: 0,
  card: <p className="mt-6 text-body-5 text-neutral-3">(card section)</p>,
};

export const MethodCard: Story = {
  render: () => <PaymentMethod {...methodArgs} method="card" />,
};

export const MethodCash: Story = {
  render: () => <PaymentMethod {...methodArgs} method="cash" totalCents={6117} tipCents={720} />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        'Pay $61.17 in cash when your order arrives, tip included. Please have the exact amount ready if you can.',
      ),
    ).toBeVisible();
  },
};

export const MethodCashOverLimit: Story = {
  render: () => (
    <PaymentMethod
      {...methodArgs}
      method="card"
      cashBlocked="Cash is available for orders up to $100.00. This one is $270.03, so please pay by card."
      alert={{
        key: 'switched',
        variant: 'info',
        icon: Info,
        text: 'Your total is now over $100.00, so we switched to card. Cash is available for orders up to $100.00.',
      }}
    />
  ),
};

export const MethodNoKeys: Story = {
  render: () => (
    <PaymentMethod
      {...methodArgs}
      method="cash"
      cardBlocked="Card payments aren't set up on this computer."
    />
  ),
};

export const MethodPaused: Story = {
  render: () => (
    <PaymentMethod
      {...methodArgs}
      method="cash"
      cardBlocked="Paused until 8:40 pm"
      alert={{
        key: 'paused',
        variant: 'warning',
        icon: Clock,
        text: 'Too many declined payments. You can try a card again at 8:40 pm, or pay with cash.',
      }}
    />
  ),
};

// ------------------------------------------------------------------ declines (2.18)

const DECLINES = [
  'Your card was declined. Try another card, or pay with cash.',
  'Your card was declined for insufficient funds. Try another card, or pay with cash.',
  'This card has expired. Check the date, or use another card.',
  "The CVC doesn't match this card. Check the 3 digits on the back.",
  "We couldn't reach your bank. Try again in a moment.",
  "Your bank couldn't confirm it's you, so the payment didn't go through. Try again, or use another card.",
  'Your Visa •••• 4242 was declined. Use another card, or pay with cash.',
];

export const PaymentAlerts: Story = {
  render: () => (
    <div className="space-y-2">
      {DECLINES.map((text) => (
        <PaymentAlert key={text} alert={{ key: text, variant: 'error', text }} />
      ))}
    </div>
  ),
};

export const SavedCardNames: Story = {
  render: () => {
    const card = savedCardFixture();
    const expired = savedCardFixture({ expired: true, expiry: '08/26' });
    return (
      <div className="space-y-3 text-body-4 text-neutral-1">
        <p>
          <CardName card={card} /> · Expires {card.expiry}
        </p>
        <div>
          <CardName card={expired} />
          <div>
            <ExpiredChip expiry={expired.expiry} />
          </div>
        </div>
      </div>
    );
  },
};

// ------------------------------------------------------------------ pay bar (2.16)

const bar = { onPay: () => {}, notice: null, typing: false };

export const PayReady: Story = {
  render: () => (
    <div className="relative h-40 [&_[data-pay-bar]]:static">
      <PayBar
        {...bar}
        content={{
          kind: 'button',
          label: 'Pay $53.97',
          pendingLabel: null,
          blocked: false,
          reason: null,
          reasonText: null,
        }}
      />
    </div>
  ),
};

export const PayCashReady: Story = {
  render: () => (
    <div className="[&_[data-pay-bar]]:static">
      <PayBar
        {...bar}
        content={{
          kind: 'button',
          label: 'Place order · $53.97',
          pendingLabel: null,
          blocked: false,
          reason: null,
          reasonText: null,
        }}
      />
    </div>
  ),
};

const blockedRows: [string, string][] = [
  ['unpaid', 'Finish paying for order 1042, or cancel it, first.'],
  ['offline', "You're offline. Your order hasn't been sent, and everything you've chosen is kept."],
  ['soldOut', 'Remove sold-out dishes to check out.'],
  ['address', 'Choose an address we deliver to.'],
  [
    'noWay',
    "This order is over the $100.00 cash limit, and card payments aren't set up on this computer.",
  ],
  ['cardFailed', 'Load the card form, or choose cash.'],
  ['limit', "You've tried to order several times in a short while. You can try again at 8:12 pm."],
];

export const PayBlocked: Story = {
  render: () => (
    <div className="space-y-6 [&_[data-pay-bar]]:static">
      {blockedRows.map(([key, reason]) => (
        <PayBar
          key={key}
          {...bar}
          content={{
            kind: 'button',
            label: 'Pay $53.97',
            pendingLabel: null,
            blocked: true,
            reason,
            reasonText: reason,
          }}
        />
      ))}
      <PayBar
        {...bar}
        content={{
          kind: 'button',
          label: 'Ordering opens at 11 am',
          pendingLabel: null,
          blocked: true,
          reason: null,
          reasonText: 'Ordering opens at 11 am',
        }}
      />
      <PayBar
        {...bar}
        content={{
          kind: 'button',
          label: 'Loading card form…',
          pendingLabel: null,
          blocked: true,
          reason: null,
          reasonText: 'Loading card form…',
        }}
      />
    </div>
  ),
};

export const PayPressing: Story = {
  render: () => (
    <div className="[&_[data-pay-bar]]:static">
      <PayBar
        {...bar}
        content={{
          kind: 'button',
          label: 'Pay $53.97',
          pendingLabel: 'Waiting for your bank…',
          blocked: false,
          reason: null,
          reasonText: null,
        }}
      />
    </div>
  ),
};

export const PaySlow: Story = {
  render: () => (
    <div className="[&_[data-pay-bar]]:static">
      <PayBar
        {...bar}
        content={{ kind: 'status', offline: false, checking: false, onCheck: () => {} }}
      />
    </div>
  ),
};

export const PayEmailGate: Story = {
  render: () => (
    <div className="[&_[data-pay-bar]]:static">
      <PayBar {...bar} content={{ kind: 'email', email: 'unconfirmed.customer@foodz.example' }} />
    </div>
  ),
};

export const PayDemoGate: Story = {
  render: () => (
    <div className="[&_[data-pay-bar]]:static">
      <PayBar {...bar} content={{ kind: 'demo', onCreateAccount: () => {} }} />
    </div>
  ),
};

// ------------------------------------------------------------------ summary notices (2.6.4)

export const SummaryNotices: Story = {
  render: () => (
    <NoticeList
      notices={[
        {
          key: 'price',
          variant: 'info',
          icon: NOTICE_ICONS.price,
          text: 'Your total changed from $53.97 to $56.11 because Gimbap is now $13.99 (was $12.99). Check the summary, then press Pay $56.11 to continue.',
        },
        {
          key: 'soldOut',
          variant: 'error',
          icon: NOTICE_ICONS.soldOut,
          text: 'Naengmyeon sold out while you were checking out. Remove it to continue, or go back to your cart.',
        },
        {
          key: 'promo',
          variant: 'warning',
          icon: NOTICE_ICONS.promo,
          text: 'Sorry, LASTONE has run out.',
        },
      ]}
    />
  ),
};
