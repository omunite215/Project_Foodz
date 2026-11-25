import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import type { CustomerTracking } from '@/server/modules/tracking/schema';
import { adoptTrackingView } from '@/lib/tracking/live-point';
import { stepsAt } from './orders.fixtures';
import {
  AtDoorBanner,
  CompactProgress,
  DeliveryCodeCard,
  TrackingArrivalRow,
  TrackingMapCard,
} from './tracking';

/*
 * The customer's live delivery (F8 design 1): the arrival row in each state, the code card
 * normal and highlighted, the at-the-door banner with the code, the compact progress row and
 * the map card (it loads OpenFreeMap tiles, or says the map is unavailable).
 */

const meta = {
  title: 'Orders/Tracking',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[375px] max-w-full space-y-4 bg-neutral-8 p-4 md:w-[600px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const AS_OF = '2026-11-21T00:42:00.000Z';
const minutesFrom = (minutes: number) =>
  new Date(Date.parse(AS_OF) + minutes * 60_000).toISOString();

const ROUTE: NonNullable<CustomerTracking['route']> = {
  geojson: {
    type: 'LineString',
    coordinates: [
      [-71.0502, 42.3561],
      [-71.0525, 42.358],
      [-71.0547, 42.36],
    ],
  },
  distanceM: 900,
  durationSec: 240,
  etaAt: minutesFrom(4),
  estimated: false,
};

const tracking = (patch: Partial<CustomerTracking> = {}): CustomerTracking => ({
  stage: 'delivering',
  courierPoint: { lat: 42.3561, lng: -71.0502, heading: 320, at: AS_OF },
  route: ROUTE,
  dropoffPoint: { lat: 42.36, lng: -71.0547 },
  almost: false,
  atDoor: false,
  code: '4821',
  ...patch,
});

// The stories' clock: the server's time is AS_OF, whatever the day is.
adoptTrackingView('o-1', tracking().courierPoint, AS_OF);

const row = (patch: Partial<CustomerTracking>, orderId = 'o-1') => (
  <div className="rounded-2xl border border-neutral-6 bg-white p-5">
    <TrackingArrivalRow
      orderId={orderId}
      tracking={tracking(patch)}
      courierFirst="Luis"
      asOf={AS_OF}
      timeZone="America/New_York"
      phone="(617) 555-0142"
    />
  </div>
);

export const ArrivalRows: Story = {
  render: () => (
    <>
      {row({})}
      {row({ almost: true })}
      {row({
        route: { ...ROUTE, etaAt: minutesFrom(-3) },
      })}
      {row(
        { courierPoint: { lat: 42.3561, lng: -71.0502, heading: null, at: minutesFrom(-3) } },
        'o-stale',
      )}
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Arriving in about 4 min · 7:46 pm')).toBeInTheDocument();
    await expect(canvas.getByText('Luis is almost there.')).toBeInTheDocument();
    await expect(canvas.getByText('Arriving soon')).toBeInTheDocument();
    await expect(
      canvas.getByText("We can't see Luis's location right now. Your order is still on its way."),
    ).toBeInTheDocument();
  },
};

export const CodeCard: Story = {
  render: () => (
    <>
      <DeliveryCodeCard code="4821" courierFirst="Luis" highlighted={false} />
      <DeliveryCodeCard code="4821" courierFirst="Luis" highlighted />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText('4, 8, 2, 1.')).toHaveLength(2);
  },
};

export const AtTheDoor: Story = {
  render: () => (
    <div className="h-[400px] overflow-auto bg-white px-6">
      <AtDoorBanner courierFirst="Luis" code="4821" phone="(617) 555-0142" live={false} />
      <p className="h-[600px] pt-4 text-body-4 text-neutral-3">The page scrolls under it.</p>
    </div>
  ),
};

export const CompactProgressRow: Story = {
  render: () => (
    <div className="rounded-2xl border border-neutral-6 bg-white p-5">
      <CompactProgress
        steps={stepsAt('pickedUp')}
        now={new Date(AS_OF)}
        timeZone="America/New_York"
      />
    </div>
  ),
};

export const MapCard: Story = {
  render: () => (
    <TrackingMapCard
      orderId="o-1"
      tracking={tracking()}
      courierFirst="Luis"
      vehicleWords="Scooter · 7KT 342"
      asOf={AS_OF}
      timeZone="America/New_York"
      headingId="track-title-story"
    />
  ),
};
