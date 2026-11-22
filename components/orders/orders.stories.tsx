import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { SavedCardRow } from '@/components/cards/saved-cards';
import { moneyNotices, type OrderState, orderStateOf } from '@/lib/order-text';
import { MoneyNotices, OrderHero, OrderNumber, OrderStatusCard, Receipt } from './order-parts';
import { OrderRow } from './order-row';
import {
  orderSummaryFixture,
  orderViewFixture,
  paidCardOrder,
  savedCardFixture,
  VISA,
} from './orders.fixtures';

/*
 * The order page in each of its states (F4 design 3.9), the orders list's rows (4.2, 4.3) and a
 * saved card's row (5.2).
 */

const meta = {
  title: 'Orders/Order page',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[375px] max-w-full bg-neutral-8 p-4 md:w-[600px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const NOW = Date.parse('2026-11-20T00:30:00.000Z');

const STATES: { name: string; view: ReturnType<typeof orderViewFixture>; confirming?: boolean }[] =
  [
    {
      name: 'Confirming',
      view: paidCardOrder({ status: 'PENDING_PAYMENT', placedAt: null }),
      confirming: true,
    },
    { name: 'Placed', view: orderViewFixture() },
    {
      name: 'Waiting for payment',
      view: paidCardOrder({
        status: 'PENDING_PAYMENT',
        payable: true,
        expiresAt: '2026-11-20T00:42:30.000Z',
        payment: { method: 'card', status: 'UNPAID', card: null, decline: null },
      }),
    },
    {
      name: 'Failed',
      view: paidCardOrder({
        status: 'FAILED',
        payment: {
          method: 'card',
          status: 'UNPAID',
          card: VISA,
          decline: { code: 'card_declined', declineCode: 'insufficient_funds' },
        },
      }),
    },
    {
      name: 'Expired',
      view: paidCardOrder({
        status: 'CANCELLED',
        cancelReason: 'payment-expired',
        payment: { method: 'card', status: 'UNPAID', card: null, decline: null },
      }),
    },
    {
      name: 'Cancelled, paid card',
      view: paidCardOrder({ status: 'CANCELLED', cancelReason: 'customer' }),
    },
    {
      name: 'Cancelled, cash',
      view: orderViewFixture({ status: 'CANCELLED', cancelReason: 'customer' }),
    },
    {
      name: 'Refunded in part, dispute open',
      view: paidCardOrder({
        payment: { method: 'card', status: 'PARTIALLY_REFUNDED', card: VISA, decline: null },
        refunds: {
          refundedCents: 500,
          entries: [{ amountCents: 500, at: '2026-11-20T15:00:00.000Z' }],
        },
        dispute: { status: 'OPEN', openedAt: '2026-11-21T15:00:00.000Z', closedAt: null },
      }),
    },
    {
      name: 'Amount mismatch refunded',
      view: paidCardOrder({
        status: 'FAILED',
        flags: { revivedAfterLatePayment: false, lateRefund: false, mismatchRefund: true },
      }),
    },
  ];

function Hero({
  view,
  confirming = false,
}: {
  view: ReturnType<typeof orderViewFixture>;
  confirming?: boolean;
}) {
  const state: OrderState = orderStateOf(view, confirming);
  return (
    <div className="space-y-2">
      <OrderHero view={view} state={state} play={false} slow={false} now={NOW} />
      <MoneyNotices notices={moneyNotices(view, state)} />
    </div>
  );
}

export const HeroStates: Story = {
  render: () => (
    <div className="space-y-16">
      {STATES.map((item) => (
        <section key={item.name} aria-label={item.name}>
          <Hero view={item.view} confirming={item.confirming} />
        </section>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Order placed' })).toBeVisible();
    await expect(canvas.getByText('Waiting for payment · 12 min left')).toBeVisible();
  },
};

export const PlacedWithReceipt: Story = {
  render: () => {
    const view = paidCardOrder({
      breakdown: {
        subtotalCents: 4797,
        promo: { code: 'KBBQ5', foodDiscountCents: 500, freeDelivery: false },
        deliveryFeeCents: 264,
        deliveryDiscountCents: 0,
        tax: { rateBps: 700, cents: 301 },
        tipCents: 720,
        tipChoice: '15',
        totalCents: 5582,
      },
    });
    return (
      <div>
        <OrderHero view={view} state="placed" play={false} slow={false} now={NOW} />
        <OrderNumber number={view.number} />
        <OrderStatusCard view={view} state="placed" now={new Date(NOW)} />
        <Receipt view={view} state="placed" />
      </div>
    );
  },
};

export const OrderRows: Story = {
  render: () => {
    const now = new Date(NOW);
    const rows = [
      orderSummaryFixture({
        statusWord: 'waitingForPayment',
        status: 'PENDING_PAYMENT',
        method: 'card',
      }),
      orderSummaryFixture({ id: 'a2', number: '1041' }),
      orderSummaryFixture({
        id: 'a3',
        number: '1040',
        statusWord: 'delivered',
        status: 'DELIVERED',
        method: 'card',
        moneyFlag: 'partlyRefunded',
      }),
      orderSummaryFixture({
        id: 'a4',
        number: '1039',
        statusWord: 'cancelled',
        status: 'CANCELLED',
        method: 'card',
        moneyFlag: 'refunded',
      }),
      orderSummaryFixture({
        id: 'a5',
        number: '1038',
        statusWord: 'expired',
        status: 'CANCELLED',
        moneyFlag: 'disputed',
      }),
      orderSummaryFixture({
        id: 'a6',
        number: '1037',
        dishes: [
          { title: 'Spicy stir-fried glass noodles with seasonal vegetables', quantity: 3 },
          { title: 'Vietnamese grilled lemongrass pork vermicelli bowl', quantity: 1 },
          { title: 'Thai green curry', quantity: 2 },
        ],
        moreCount: 2,
      }),
    ];
    return (
      <ul className="space-y-3">
        {rows.map((order) => (
          <li key={order.id}>
            <OrderRow order={order} now={now} timeZone="America/New_York" />
          </li>
        ))}
      </ul>
    );
  },
};

export const SavedCardRows: Story = {
  render: () => (
    <ul className="divide-y divide-neutral-6 rounded-2xl border border-neutral-6 bg-white p-5">
      <SavedCardRow card={savedCardFixture()} onRemove={() => {}} />
      <SavedCardRow
        card={savedCardFixture({
          id: 'pm_card_old_0005',
          last4: '0005',
          label: 'Visa •••• 0005',
          spoken: 'Visa ending in 0005',
          expired: true,
          expiry: '08/26',
        })}
        onRemove={() => {}}
      />
    </ul>
  ),
};
