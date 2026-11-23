import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CancelPreview } from '@/server/modules/board/schema';
import type { BoardWriter } from '@/lib/data/board';
import {
  DISHES,
  fullCard,
  fullPreview,
  kitchenCard,
  kitchenPreview,
  seed,
  TZ,
} from '../board.fixtures';
import { SoldOutSheet } from '../sold-out';
import { CancelDialog } from './cancel-dialog';
import { HandoverDialog, MoveBackDialog } from './status-dialogs';

/*
 * The board's dialogs (F5 design 3) and the dish availability sheet (4.2), with the server's
 * answers already in the cache so they open as they would on the board.
 */

function WithData({ preview, children }: { preview?: CancelPreview; children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (preview) queryClient.setQueryData(['board', 'cancelPreview', preview.orderId], preview);
  queryClient.setQueryData(['board', 'dishes'], DISHES);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const meta = {
  title: 'Board/Dialogs',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;
// The sheet only writes after a change, which these stories never send.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const noWriter = {} as BoardWriter;
const common = {
  timeZone: TZ,
  offline: false,
  onClose: noop,
  onCloseFocus: () => false,
  onFinished: noop,
  onSignedOut: noop,
};

/** "Can't make it" on a paid card order (design 3.2), the kitchen's shape. */
export const CantMakeIt: Story = {
  render: () => (
    <WithData preview={kitchenPreview()}>
      <CancelDialog
        mode="refuse"
        card={kitchenCard(seed('S1101'))}
        current={kitchenCard(seed('S1101'))}
        canMarkSoldOut
        {...common}
      />
    </WithData>
  ),
};

/** Staff cancel after Accept, with the code field from the start (design 3.3, D31). */
export const CancelWithStepUp: Story = {
  render: () => (
    <WithData preview={fullPreview({ stepUpRequired: true, kitchenStarted: true })}>
      <CancelDialog
        mode="cancel"
        card={fullCard(seed('S1101'), { status: 'ACCEPTED', version: 4 })}
        current={fullCard(seed('S1101'), { status: 'ACCEPTED', version: 4 })}
        canMarkSoldOut={false}
        {...common}
      />
    </WithData>
  ),
};

/** Staff cancel of a cash order: nothing to refund. */
export const CancelCash: Story = {
  render: () => (
    <WithData
      preview={fullPreview({
        orderId: seed('S1102').id,
        number: 'S1102',
        status: 'PLACED',
        refund: { kind: 'none' },
        codeToRelease: null,
      })}
    >
      <CancelDialog
        mode="cancel"
        card={fullCard(seed('S1102'))}
        current={fullCard(seed('S1102'))}
        canMarkSoldOut
        {...common}
      />
    </WithData>
  ),
};

/** Move back to New: the customer can cancel again (design 3.5). */
export const MoveBack: Story = {
  render: () => (
    <WithData>
      <MoveBackDialog card={fullCard(seed('S1103'))} {...common} />
    </WithData>
  ),
};

/** Mark delivered on a cash order, with the cash tick (design 3.6). */
export const DeliverCash: Story = {
  render: () => (
    <WithData>
      <HandoverDialog
        step="deliver"
        card={fullCard(seed('S1106'), { status: 'PICKED_UP' })}
        {...common}
      />
    </WithData>
  ),
};

/** The dish availability sheet, sold-out dishes first (design 4.2). */
export const DishAvailability: Story = {
  render: () => (
    <WithData>
      <SoldOutSheet
        open
        onOpenChange={noop}
        canChange
        readOnly={false}
        offline={false}
        timeZone={TZ}
        writer={noWriter}
        syncRef={{ current: null }}
        onSignedOut={noop}
      />
    </WithData>
  ),
};

/** The demo admin sees the sheet with every button disabled. */
export const DishAvailabilityDemo: Story = {
  render: () => (
    <WithData>
      <SoldOutSheet
        open
        onOpenChange={noop}
        canChange={false}
        readOnly
        offline={false}
        timeZone={TZ}
        writer={noWriter}
        syncRef={{ current: null }}
        onSignedOut={noop}
      />
    </WithData>
  ),
};
