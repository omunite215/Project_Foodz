import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import type { BoardCard } from '@/server/modules/board/schema';
import { Banner, BannerStack } from '@/components/admin/banners';
import { LiveChip, StoreChip } from '@/components/admin/status-chips';
import { DEMO_BANNER } from '@/lib/board/text';
import { Eye } from 'lucide-react';
import {
  ABILITIES,
  at,
  DISHES,
  fullCard,
  kitchenCard,
  kitchenCards,
  NOW,
  seed,
  TIMELINE,
  TZ,
} from './board.fixtures';
import {
  BackOnlineBanner,
  ConnectionBannerRow,
  HiddenByFiltersBanner,
  WaitingBanner,
} from './board-banners';
import { BoardColumn } from './board-column';
import { BoardEmpty } from './board-empty';
import { StaffTimeline } from './detail/staff-timeline';
import { OrderCard } from './order-card';
import { SoldOutStrip } from './sold-out';

/*
 * The order board's parts (F5 design 2): cards in every column and tone for each role, columns
 * in their states, the banners and the timeline, all from the story's fixtures at 7:30 pm.
 */

const meta = {
  title: 'Board/Order board',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const now = new Date(NOW);
const noop = () => undefined;

function Card({
  card,
  staff = 'kitchen',
  ...rest
}: {
  card: BoardCard;
  staff?: keyof typeof ABILITIES;
} & Partial<React.ComponentProps<typeof OrderCard>>) {
  return (
    <div className="w-[239px]">
      <OrderCard
        card={card}
        now={now}
        offset={0}
        timeZone={TZ}
        can={ABILITIES[staff]}
        progress={null}
        reason={null}
        blocked={staff === 'demo' ? 'demo' : null}
        highlight={null}
        onPrimary={noop}
        onMenu={noop}
        onUndo={noop}
        {...rest}
      />
    </div>
  );
}

/** Every fixture on the kitchen tablet: ok, amber and red, cash and card, notes as text. */
export const KitchenCards: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-3 bg-neutral-7 p-3">
      {kitchenCards().map((card) => (
        <Card key={card.id} card={card} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A2.9: the kitchen note is text, brackets and all.
    await expect(canvas.getByText(/<b>extra rice<\/b>/)).toBeInTheDocument();
    await expect(canvas.getByRole('article', { name: 'Order S1102' })).toHaveAttribute(
      'data-tone',
      'late',
    );
  },
};

/** Support and admin see amounts and flags; support has "Actions" and no primary. */
export const SupportAndAdmin: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-3 bg-neutral-7 p-3">
      <Card staff="support" card={fullCard(seed('S1101'))} />
      <Card
        staff="admin"
        card={fullCard(seed('S1107'), {
          payment: {
            method: 'card',
            status: 'PARTIALLY_REFUNDED',
            totalCents: 4630,
            refundedCents: 1200,
            dispute: 'OPEN',
            paidLate: true,
            flags: ['partlyRefunded', 'disputed', 'paidLate'],
          },
        })}
      />
      <Card
        staff="admin"
        card={fullCard(seed('S1106'), { status: 'PICKED_UP', pickedUpAt: at('19:18') })}
      />
    </div>
  ),
};

/** Moving, the Undo row, each reason block, the demo, offline, a sold-out dish, 8 lines. */
export const States: Story = {
  render: () => {
    const many = kitchenCard(seed('S1101'), {
      lines: Array.from({ length: 8 }, (_, index) => ({
        ...seed('S1101').lines[0]!,
        id: `line-${index}`,
        title: index === 3 ? 'Spicy Korean Fried Chicken With Extra Gochujang Glaze' : 'Gimbap',
        soldOut: index === 1,
      })),
      kitchenNote:
        'Please make it extra spicy, no sesame anywhere, and pack the sauce separately. The customer is allergic to peanuts, so keep everything well away from the peanut station. Thank you!',
    });
    return (
      <div className="flex flex-wrap items-start gap-3 bg-neutral-7 p-3">
        <Card card={kitchenCard(seed('S1103'))} progress="moving" />
        <Card
          card={kitchenCard(seed('S1104'), {
            undo: {
              eventId: seed('S1104').id,
              type: 'PREPARING',
              until: '2099-01-01T00:00:00.000Z',
            },
          })}
        />
        <Card
          card={kitchenCard(seed('S1103'))}
          reason={{ tone: 'calm', text: 'Already cooking · moved by Alex Kim at 7:41 pm' }}
        />
        <Card
          card={kitchenCard(seed('S1103'))}
          reason={{
            tone: 'error',
            text: "We couldn't reach the server, so order S1103 wasn't moved. Try again.",
          }}
        />
        <Card staff="demo" card={fullCard(seed('S1102'))} />
        <Card card={kitchenCard(seed('S1102'))} blocked="offline" />
        <Card card={many} />
      </div>
    );
  },
};

const count = (shown: number, total = shown, late = 0, filtered = false) => ({
  shown,
  total,
  late,
  filtered,
});

/** A column with cards and a late chip, an empty one, a filtered one and a collapsed strip. */
export const Columns: Story = {
  render: () => (
    <div className="grid h-[640px] grid-cols-[repeat(3,239px)_3.5rem] gap-3">
      <BoardColumn
        column="preparing"
        count={count(2, 2, 1)}
        collapsed={false}
        collapsible
        hiddenOnPhone={false}
        tabPanel={false}
        newIds={[]}
        empty={null}
        onToggle={noop}
        onShowNew={noop}
      >
        {kitchenCards()
          .filter((card) => card.status === 'PREPARING')
          .map((card) => (
            <li key={card.id}>
              <Card card={card} />
            </li>
          ))}
      </BoardColumn>
      <BoardColumn
        column="accepted"
        count={count(0)}
        collapsed={false}
        collapsible
        hiddenOnPhone={false}
        tabPanel={false}
        newIds={[]}
        empty="column"
        onToggle={noop}
        onShowNew={noop}
      >
        {null}
      </BoardColumn>
      <BoardColumn
        column="ready"
        count={count(1, 2, 1, true)}
        collapsed={false}
        collapsible
        hiddenOnPhone={false}
        tabPanel={false}
        newIds={[]}
        empty={null}
        onToggle={noop}
        onShowNew={noop}
      >
        <li>
          <Card card={kitchenCard(seed('S1107'))} />
        </li>
      </BoardColumn>
      <BoardColumn
        column="outForDelivery"
        count={count(1)}
        collapsed
        collapsible
        hiddenOnPhone={false}
        tabPanel={false}
        newIds={[]}
        empty={null}
        onToggle={noop}
        onShowNew={noop}
      >
        {null}
      </BoardColumn>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('heading', { name: 'Preparing, 2 orders, 1 late' }),
    ).toBeVisible();
    await expect(canvas.getByText('Nothing here')).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Expand Out for delivery column, 1 order' }),
    ).toHaveAttribute('aria-expanded', 'false');
  },
};

/** The banner stack in order, the chips and the sold-out strip (design 1.4, 1.5, 4.4). */
export const BannersAndChips: Story = {
  render: () => (
    <div className="w-[992px] space-y-4">
      <div className="flex flex-wrap gap-2">
        <StoreChip store={{ isOpen: true, label: 'Open · closes 11 pm' }} />
        <StoreChip store={{ isOpen: false, label: 'Closed · opens 11 am tomorrow' }} />
        <LiveChip state="live" />
        <LiveChip state="reconnecting" />
        <LiveChip state="notLive" />
        <LiveChip state="offline" />
        <LiveChip state="signedOut" />
      </div>
      <BannerStack className="px-0">
        <Banner variant="warning" icon={Eye} announceOnShow={false}>
          {DEMO_BANNER}
        </Banner>
        <ConnectionBannerRow banner="paused" lastUpdate={at('19:42')} timeZone={TZ} />
        <ConnectionBannerRow banner="outOfDate" lastUpdate={null} timeZone={TZ} />
        <ConnectionBannerRow banner="noRealtime" lastUpdate={null} timeZone={TZ} />
        <ConnectionBannerRow banner="offline" lastUpdate={null} timeZone={TZ} />
        <BackOnlineBanner changed={2} onDismiss={noop} />
        <WaitingBanner
          text="Order 1042 has waited 6 minutes. Accept it, or tell the customer we can't make it."
          action="Show order 1042"
          onShow={noop}
        />
        <HiddenByFiltersBanner count={1} onShow={noop} />
      </BannerStack>
      <SoldOutStrip
        dishes={DISHES.filter((dish) => !dish.available).map((dish) => ({
          dishId: dish.dishId,
          title: dish.title,
          since: dish.soldOutSince,
          byName: dish.soldOutByName,
        }))}
        canManage
        onManage={noop}
      />
    </div>
  ),
};

/** The empty board and "No matching orders" (design 2.13). */
export const Empty: Story = {
  render: () => (
    <div className="w-[720px] space-y-6">
      <BoardEmpty kind="board" soundOn={false} onTurnOnSound={noop} onClearFilters={noop} />
      <BoardEmpty kind="filtered" soundOn onTurnOnSound={noop} onClearFilters={noop} />
    </div>
  ),
};

/** Every timeline event, with "Show seconds" (design 5.3). */
export const Timeline: Story = {
  render: () => (
    <div className="w-[432px] bg-white p-6">
      <StaffTimeline entries={TIMELINE} now={now} timeZone={TZ} />
    </div>
  ),
};
