import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { type ReactNode, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { isStars, type OrderRatingView } from '@/server/modules/ratings/schema';
import { Providers } from '@/components/providers';
import type { ActionOutcome } from '@/lib/action-result';
import { OrderNoticeCard } from './order-notices';
import { OrderRow } from './order-row';
import { orderSummaryFixture } from './orders.fixtures';
import { RatingCard, type RatingClient } from './rating-card';

/*
 * F9's customer side (design 2): the rating card on the order page in each of its states, at
 * the order page's column widths (375 phone, the 1024 left column, the 1440 column), "Rate" and
 * "Rated" on the Orders list at 375 and 1280, and the reminder notice.
 */

const ORDER_ID = '7b0a1c2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d';
const GIMBAP = '1b6c3c35-6b6f-4c39-9a3e-3d0d0e0f1a41';
const PAD_THAI = '2b6c3c35-6b6f-4c39-9a3e-3d0d0e0f1a40';

function view(overrides: Partial<OrderRatingView> = {}): OrderRatingView {
  return {
    state: 'open',
    editable: true,
    closesAt: '2026-11-28T00:46:00.000Z',
    closesOnWords: 'Fri, Nov 27',
    closedOnWords: 'Nov 27',
    demo: false,
    dishes: [
      {
        menuItemId: GIMBAP,
        title: 'Gimbap',
        quantity: 2,
        imageUrl: '/Menu/Korean/gimbap.svg',
        stars: null,
        tags: [],
        comment: null,
        editedAt: null,
      },
      {
        menuItemId: PAD_THAI,
        title: 'Pad Thai',
        quantity: 1,
        imageUrl: null,
        stars: null,
        tags: [],
        comment: null,
        editedAt: null,
      },
    ],
    courier: {
      firstName: 'Luis',
      hasPhoto: false,
      stars: null,
      tags: [],
      comment: null,
      editedAt: null,
    },
    ...overrides,
  };
}

const RATED = view({
  state: 'rated',
  dishes: [
    { ...view().dishes[0]!, stars: 3, tags: ['cold'], comment: 'A bit cold when it came.' },
    { ...view().dishes[1]!, stars: 5, tags: ['tasty'] },
  ],
  courier: { ...view().courier!, stars: 5, tags: ['friendly', 'on-time'] },
});

const ok = (data: OrderRatingView): ActionOutcome<OrderRatingView> => ({ ok: true, data });
const never = () => new Promise<ActionOutcome<OrderRatingView>>(() => {});
const failing =
  (code: string, message: string, details?: Record<string, unknown>) =>
  async (): Promise<ActionOutcome<OrderRatingView>> => ({
    ok: false,
    error: { code, message, ...(details && { details }) },
  });

/** A client that answers as the server would: the sent stars come back as the rated view. */
const echo: RatingClient = {
  rate: async (input) => {
    const answer = view({ state: 'rated' });
    for (const dish of answer.dishes) {
      const sent = input.dishes?.find((row) => row.menuItemId === dish.menuItemId);
      if (sent && isStars(sent.stars)) dish.stars = sent.stars;
    }
    if (answer.courier && input.courier && isStars(input.courier.stars)) {
      answer.courier.stars = input.courier.stars;
    }
    return ok(answer);
  },
  skip: async () => ok(view({ state: 'skipped' })),
};

/** The card with its own copy of the view, as the order page keeps it. */
function Card({ rating, client = echo }: { rating: OrderRatingView; client?: RatingClient }) {
  const [current, setCurrent] = useState(rating);
  return (
    <RatingCard
      orderId={ORDER_ID}
      orderNumber="1042"
      rating={current}
      customerFirst="Priya"
      onChange={setCurrent}
      client={client}
    />
  );
}

/** The order page's column: 600 px at most, full width minus 24 px a side below that. */
function Widths({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-neutral-8 px-6 py-6">
      <div className="mx-auto max-w-[600px]">{children}</div>
    </div>
  );
}

const VIEWPORTS = {
  w375: { name: '375 phone', styles: { width: '375px', height: '667px' } },
  w1024: { name: '1024 tablet', styles: { width: '1024px', height: '768px' } },
  w1280: { name: '1280 laptop', styles: { width: '1280px', height: '800px' } },
  w1440: { name: '1440 desktop', styles: { width: '1440px', height: '900px' } },
};

const at = (value: keyof typeof VIEWPORTS) => ({ viewport: { value, isRotated: false } });

const meta = {
  title: 'Orders/Rating card',
  parameters: { layout: 'fullscreen', viewport: { options: VIEWPORTS } },
  globals: at('w375'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const firstCard = (canvasElement: HTMLElement) => within(canvasElement);

export const Fresh: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await expect(card.getByRole('heading', { name: 'How was order 1042?' })).toBeVisible();
    await expect(card.getByRole('group', { name: 'Rate Gimbap' })).toBeVisible();
    await expect(card.getByRole('group', { name: "Rate Luis's delivery" })).toBeVisible();
    await expect(card.getByText('Gimbap × 2')).toBeVisible();
  },
};

export const PartlyPicked: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    const gimbap = card.getByRole('group', { name: 'Rate Gimbap' });
    await userEvent.click(within(gimbap).getByRole('radio', { name: '4 stars, Good' }));
    await expect(within(gimbap).getByRole('radio', { name: '4 stars, Good' })).toBeChecked();
    await expect(card.getByText('What was good?')).toBeVisible();
  },
};

export const WithTags: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    const padThai = card.getByRole('group', { name: 'Rate Pad Thai' });
    await userEvent.click(within(padThai).getByRole('radio', { name: '2 stars, Poor' }));
    await userEvent.click(card.getByRole('button', { name: 'Cold' }));
    await expect(card.getByRole('button', { name: 'Cold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Crossing the 3 | 4 line swaps the set and clears the presses.
    await userEvent.click(within(padThai).getByRole('radio', { name: '5 stars, Great' }));
    await expect(card.queryByRole('button', { name: 'Cold' })).toBeNull();
    await userEvent.click(card.getByRole('button', { name: 'Tasty' }));
  },
};

export const WithComment: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    const padThai = card.getAllByRole('listitem')[1]!;
    await userEvent.click(within(padThai).getByRole('button', { name: /^Add a comment/ }));
    const field = card.getByLabelText('Comment about Pad Thai (optional)');
    await expect(field).toHaveFocus();
    await userEvent.click(field);
    await userEvent.paste('Lovely noodles. '.repeat(26).slice(0, 412));
    await expect(card.getByText('412/500')).toBeVisible();
  },
};

export const EmptySendError: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(card.getByRole('button', { name: 'Send ratings' }));
    await expect(card.getByText('Pick at least one star rating first.')).toBeVisible();
    await waitFor(() => expect(card.getAllByRole('radio')[0]).toHaveFocus());
  },
};

export const Sending: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} client={{ ...echo, rate: never }} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(card.getAllByRole('radio', { name: '5 stars, Great' })[0]!);
    await userEvent.click(card.getByRole('button', { name: 'Send ratings' }));
    await waitFor(() => expect(card.getByText('Sending…')).toBeVisible());
  },
};

export const SendError: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} client={{ ...echo, rate: failing('OFFLINE', '') }} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(card.getAllByRole('radio', { name: '4 stars, Good' })[0]!);
    await userEvent.click(card.getByRole('button', { name: 'Send ratings' }));
    await expect(
      await card.findByText("Couldn't send your ratings. Check your connection and try again."),
    ).toBeVisible();
    // Her picks stay.
    await expect(card.getAllByRole('radio', { name: '4 stars, Good' })[0]).toBeChecked();
  },
};

export const RateLimit: Story = {
  render: () => (
    <Widths>
      <Card
        rating={view()}
        client={{
          ...echo,
          rate: failing('RATE_LIMITED', "You've sent a lot of ratings. Try again in 20 minutes."),
        }}
      />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(card.getAllByRole('radio', { name: '3 stars, OK' })[0]!);
    await userEvent.click(card.getByRole('button', { name: 'Send ratings' }));
    await expect(
      await card.findByText("You've sent a lot of ratings. Try again in 20 minutes."),
    ).toBeVisible();
  },
};

export const Sent: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(
      within(card.getByRole('group', { name: 'Rate Gimbap' })).getByRole('radio', {
        name: '3 stars, OK',
      }),
    );
    await userEvent.click(
      within(card.getByRole('group', { name: "Rate Luis's delivery" })).getByRole('radio', {
        name: '5 stars, Great',
      }),
    );
    await userEvent.click(card.getByRole('button', { name: 'Send ratings' }));
    const heading = await card.findByRole('heading', { name: 'Your ratings' });
    await waitFor(() => expect(heading).toHaveFocus());
    await expect(
      card.getByText('Thanks, Priya. Every rating helps the kitchen and Luis.'),
    ).toBeVisible();
    await expect(card.getByText('Not rated')).toBeVisible();
  },
};

export const Rated: Story = {
  render: () => (
    <Widths>
      <Card rating={RATED} />
    </Widths>
  ),
};

export const Editing: Story = {
  render: () => (
    <Widths>
      <Card rating={RATED} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(card.getByRole('button', { name: 'Edit ratings' }));
    await waitFor(() =>
      expect(card.getByRole('heading', { name: 'How was order 1042?' })).toHaveFocus(),
    );
    await expect(card.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expect(card.queryByRole('button', { name: 'Skip' })).toBeNull();
    await expect(card.getByLabelText('Comment about Gimbap (optional)')).toHaveValue(
      'A bit cold when it came.',
    );
  },
};

export const Closed: Story = {
  render: () => (
    <Widths>
      <Card rating={{ ...RATED, editable: false }} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await expect(card.getByText('Ratings for this order closed on Nov 27.')).toBeVisible();
    await expect(card.queryByRole('button', { name: 'Edit ratings' })).toBeNull();
  },
};

export const ClosedMeanwhile: Story = {
  render: () => (
    <Widths>
      <Card
        rating={view()}
        client={{
          ...echo,
          rate: failing('RATING_NOT_OPEN', 'Ratings for this order closed on Nov 27.', {
            why: 'closed',
            closedOnWords: 'Nov 27',
          }),
        }}
      />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(card.getAllByRole('radio', { name: '5 stars, Great' })[0]!);
    await userEvent.click(card.getByRole('button', { name: 'Send ratings' }));
    const line = await card.findByText('Ratings for this order closed on Nov 27.');
    await waitFor(() => expect(line).toHaveFocus());
  },
};

export const Skipped: Story = {
  render: () => (
    <Widths>
      <Card rating={view()} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await userEvent.click(card.getByRole('button', { name: 'Skip' }));
    const again = await card.findByRole('button', { name: 'Rate this order' });
    await waitFor(() => expect(again).toHaveFocus());
  },
};

export const FoodOnly: Story = {
  render: () => (
    <Widths>
      <Card rating={view({ courier: null })} />
    </Widths>
  ),
};

export const Demo: Story = {
  render: () => (
    <Widths>
      <Card rating={view({ demo: true })} />
    </Widths>
  ),
  play: async ({ canvasElement }) => {
    const card = firstCard(canvasElement);
    await expect(card.getByText('Comments are turned off in the demo.')).toBeVisible();
    await expect(card.queryByRole('button', { name: /Add a comment/ })).toBeNull();
  },
};

const NOW = new Date('2026-11-21T00:30:00.000Z');

const rows = (
  <Providers>
    <div className="min-h-dvh bg-neutral-8 px-4 py-6 md:px-12 xl:px-[72px]">
      <ul className="mx-auto max-w-[1136px] space-y-3">
        <li>
          <OrderRow
            order={orderSummaryFixture({
              status: 'DELIVERED',
              statusWord: 'delivered',
              reorderable: true,
              rating: 'rate',
            })}
            now={NOW}
            timeZone="America/New_York"
          />
        </li>
        <li>
          <OrderRow
            order={orderSummaryFixture({
              id: '8b0a1c2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
              number: '1038',
              status: 'DELIVERED',
              statusWord: 'delivered',
              reorderable: true,
              rating: 'rated',
            })}
            now={NOW}
            timeZone="America/New_York"
          />
        </li>
      </ul>
    </div>
  </Providers>
);

/** "Rate" and "Order again" share the row's last line at 375 (design 2.13). */
export const OrdersListRows: Story = {
  render: () => rows,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Rate order 1042' })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}#rate`,
    );
    await expect(canvas.getAllByText(/· Rated/)[0]).toBeVisible();
  },
};

/** From 1280 they stack in the action column, "Rate" above "Order again". */
export const OrdersListRowsAt1280: Story = {
  ...OrdersListRows,
  globals: at('w1280'),
};

export const ReminderNotice: Story = {
  render: () => (
    <div className="w-[375px] bg-neutral-8 p-4">
      <OrderNoticeCard
        notice={{
          id: 'n1',
          orderId: ORDER_ID,
          orderNumber: '1042',
          status: 'rate',
          title: 'How was order 1042?',
          body: "Rate your Gimbap, Pad Thai and Luis's delivery. It takes ten seconds.",
          leftMs: 10_000,
        }}
        onDismiss={() => {}}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Rate order 1042' })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}#rate`,
    );
  },
};

export const FreshAt1024: Story = { ...Fresh, globals: at('w1024') };
export const FreshAt1440: Story = { ...Fresh, globals: at('w1440') };
export const RatedAt1440: Story = { ...Rated, globals: at('w1440') };
export const EditingAt1024: Story = { ...Editing, globals: at('w1024') };
