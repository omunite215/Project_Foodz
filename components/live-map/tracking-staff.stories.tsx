import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  AttentionItem,
  DeliveryLine,
  MapState,
  OpsMapCourier,
  OpsMapSnapshot,
  StaffTrackingDetail,
} from '@/server/modules/tracking/schema';
import { DeliveryLineView } from '@/components/board/courier-parts';
import { TrackingDetail } from '@/components/board/detail/tracking-detail';
import { StaffShellProvider } from '@/components/admin/staff-shell-context';
import { StuckBanners } from '@/components/board/stuck-banners';
import { LiveMapPage } from './live-map-page';

/*
 * F8's staff parts (design 3): the Out-for-delivery line in each state at card and wide widths,
 * the stuck-delivery banners (one and stacked), the detail's tracking block and the live map
 * at the snapshot's states.
 */

const meta = {
  title: 'Admin/Tracking',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const AS_OF = '2026-11-21T00:46:00.000Z';
const ago = (seconds: number) => new Date(Date.parse(AS_OF) - seconds * 1000).toISOString();

const LINES: DeliveryLine[] = [
  {
    state: 'onTheWay',
    tone: 'neutral',
    icon: 'truck',
    words: 'Luis M. · 0.9 km to go · arriving 7:46 pm',
    spoken: 'Luis M., 0.9 km to go, arriving 7:46 pm',
  },
  {
    state: 'almost',
    tone: 'positive',
    icon: 'pin',
    words: 'Luis M. · arriving now',
    spoken: 'Luis M., arriving now',
  },
  {
    state: 'noLocation',
    tone: 'amber',
    icon: 'signal-off',
    words: 'Luis M. · no location for 3 min',
    spoken: 'Luis M., no location for 3 min',
  },
  {
    state: 'noAnswer',
    tone: 'red',
    icon: 'door',
    words: "Luis M. · Priya isn't answering · 6 min",
    spoken: "Luis M., Priya isn't answering, 6 min",
  },
  {
    state: 'locked',
    tone: 'red',
    icon: 'lock',
    words: 'Luis M. · code locked',
    spoken: 'Luis M., code locked',
  },
  {
    state: 'problem',
    tone: 'amber',
    icon: 'alert',
    words: "Luis M. · problem: can't find the address",
    spoken: "Luis M., problem: can't find the address",
  },
];

export const OutForDeliveryLines: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6 bg-neutral-8 p-4">
      {[239, 400].map((width) => (
        <div key={width} style={{ width }} className="rounded-xl bg-white p-3">
          {LINES.map((line) => (
            <DeliveryLineView key={line.state} line={line} vehicleWords="Scooter · 7KT 342" />
          ))}
        </div>
      ))}
    </div>
  ),
};

const ATTENTION: AttentionItem[] = [
  {
    orderId: '0193a000-0000-7000-8000-000000000101',
    orderNumber: '1042',
    kind: 'no-answer',
    since: ago(360),
    minutes: 6,
    words: "Order 1042: Priya isn't answering. Luis has waited 6 minutes.",
  },
  {
    orderId: '0193a000-0000-7000-8000-000000000102',
    orderNumber: '1043',
    kind: 'locked',
    since: ago(200),
    minutes: 3,
    words: 'Order 1043: the delivery code is locked after 5 wrong tries.',
  },
  {
    orderId: '0193a000-0000-7000-8000-000000000103',
    orderNumber: '1044',
    kind: 'problem',
    since: ago(100),
    minutes: 1,
    words: "Order 1044: Grace can't find the address.",
  },
  {
    orderId: '0193a000-0000-7000-8000-000000000104',
    orderNumber: '1045',
    kind: 'no-location',
    since: ago(700),
    minutes: 11,
    words: 'Order 1045: no location from Diego for 10 minutes. Call him.',
  },
];

export const StuckDeliveryBanners: Story = {
  render: () => (
    <div className="max-w-3xl space-y-3 bg-white p-4">
      {ATTENTION.map((item) => (
        <StuckBanners key={item.orderId} items={[item]} onOpen={() => undefined} />
      ))}
      <StuckBanners items={ATTENTION} onOpen={() => undefined} />
    </div>
  ),
};

const DETAIL: StaffTrackingDetail = {
  steps: {
    assignedAt: ago(360),
    atKitchenAt: ago(300),
    pickedUpAt: ago(240),
    deliveredAt: null,
    noAnswerSince: ago(320),
    codeLockedAt: null,
    problem: 'no-answer',
  },
  point: { lat: 42.3598, lng: -71.0545, at: ago(12), freshness: 'live' },
  route: null,
  dropoffPoint: { lat: 42.36, lng: -71.0547 },
  etaAt: AS_OF,
  estimated: false,
  late: true,
};

export const DetailTracking: Story = {
  render: () => (
    <div className="w-[480px] max-w-full bg-white p-6">
      <TrackingDetail
        tracking={DETAIL}
        orderNumber="1042"
        courierName="Luis Moreno"
        courierId="0193a000-0000-7000-8000-0000000000a1"
        courierFirst="Luis"
        timeZone="America/New_York"
        serverNowMs={Date.parse(AS_OF)}
        level="h4"
        stuck={['confirmHandover', 'askToWait', 'cancelUnreachable']}
        readOnly={false}
        offline={false}
        asking={false}
        onStuck={() => undefined}
      />
    </div>
  ),
};

function courier(
  index: number,
  fullName: string,
  state: MapState,
  words: string,
  [lat, lng]: [number, number],
  age: number,
): OpsMapCourier {
  const [first = '', last = ''] = fullName.split(' ');
  return {
    partnerId: `0193a000-0000-7000-8000-0000000000a${index}`,
    fullName,
    shortName: `${first} ${last.charAt(0)}.`,
    vehicle: 'SCOOTER',
    vehicleWords: 'Scooter · 7KT 342',
    plate: '7KT 342',
    state,
    words,
    orderId: state === 'free' ? null : `0193a000-0000-7000-8000-00000000010${index}`,
    orderNumber: state === 'free' ? null : String(1042 + index),
    point: { lat, lng },
    heading: null,
    at: ago(age),
    freshness: 'live',
    phone: { e164: '+16175550171', display: '(617) 555-0171' },
  };
}

const SNAPSHOT: OpsMapSnapshot = {
  asOf: AS_OF,
  pool: 'REAL',
  couriers: [
    courier(0, 'Luis Moreno', 'delivering', 'Delivering 1042', [42.358, -71.053], 12),
    courier(1, 'Grace Okafor', 'toKitchen', 'To kitchen · 1043', [42.352, -71.049], 20),
    courier(2, 'Diego Paz', 'noAnswer', 'No answer · 1044', [42.361, -71.057], 8),
    courier(3, 'Ana Ruiz', 'free', 'Free', [42.35, -71.044], 70),
    courier(4, 'Sam Lee', 'locked', 'Code locked · 1045', [42.355, -71.06], 200),
  ],
  deliveries: [
    {
      orderId: '0193a000-0000-7000-8000-000000000100',
      number: '1042',
      courierShortName: 'Luis M.',
      stateWords: 'Delivering',
      etaAt: AS_OF,
      lateMinutes: 8,
      dropoffPoint: { lat: 42.36, lng: -71.0547 },
      customerFirstName: 'Priya',
      areaWords: 'Downtown',
    },
  ],
  readyWithoutCourier: [
    { orderId: '0193a000-0000-7000-8000-000000000201', number: '1046', readyAt: ago(360) },
  ],
  demoRun: null,
  attention: ATTENTION.slice(0, 2),
  kitchen: { lat: 42.3505, lng: -71.045 },
};

function WithQuery({ children, demo = false }: { children: ReactNode; demo?: boolean }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <StaffShellProvider
        value={{
          frame: 'sidebar',
          user: {
            name: demo ? 'Dana Demo' : 'Morgan Diaz',
            role: demo ? 'admin' : 'support',
            isDemo: demo,
          },
          screens: ['orderBoard', 'liveMap', 'partners'],
          readOnly: demo,
          sessionExpiresAt: null,
          timeZone: 'America/New_York',
        }}
      >
        {children}
      </StaffShellProvider>
    </QueryClientProvider>
  );
}

export const LiveMap: Story = {
  render: () => (
    <WithQuery>
      <div className="h-[800px]">
        <LiveMapPage
          initial={SNAPSHOT}
          timeZone="America/New_York"
          initialSelection={null}
          initialTab={null}
        />
      </div>
    </WithQuery>
  ),
};

export const LiveMapDemo: Story = {
  render: () => (
    <WithQuery demo>
      <div className="h-[800px]">
        <LiveMapPage
          initial={{
            ...SNAPSHOT,
            pool: 'DEMO',
            demoRun: {
              running: false,
              orderNumber: null,
              endsAt: null,
              runsLeft: 0,
              nextAt: ago(-900),
            },
          }}
          timeZone="America/New_York"
          initialSelection={{ kind: 'courier', id: '0193a000-0000-7000-8000-0000000000a3' }}
          initialTab="couriers"
        />
      </div>
    </WithQuery>
  ),
};
