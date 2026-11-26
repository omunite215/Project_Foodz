'use client';

import { useRef } from 'react';
import {
  type BoardAbilities,
  type BoardCard,
  isBoardStatus,
  type StaffCancelResult,
} from '@/server/modules/board/schema';
import { withStatus } from '@/lib/board/model';
import type { BoardWriter } from '@/lib/data/board';
import { CancelDialog } from './cancel-dialog';
import { AssignCourierDialog, TakeOffCourierDialog } from './courier-dialogs';
import { HandoverDialog, MoveBackDialog } from './status-dialogs';

/*
 * The board's dialogs (F5 design 3) and what their success does to the board: the card leaves
 * (refused, cancelled, delivered) or moves (moved back, picked up), dishes ticked as sold out
 * join the strip, and focus lands on the next card or back on the moved one.
 */

export type DialogKind =
  | 'refuse'
  | 'cancel'
  | 'moveBack'
  | 'pickUp'
  | 'deliver'
  // F7 (design 2.7, 2.8).
  | 'assignCourier'
  | 'takeOffCourier'
  | 'chooseAnother';

export interface DialogState {
  kind: DialogKind;
  cardId: string;
  /** The card as it was when the dialog opened. */
  card: BoardCard;
  /** The button that opened it, for focus on close. */
  opener: HTMLElement | null;
}

export function BoardDialogs({
  dialog,
  current,
  can,
  timeZone,
  offline,
  writer,
  onSignedOut,
  onClose,
  focusAfter,
  onChain,
}: {
  dialog: DialogState | null;
  /** The board's copy of the dialog's order now; null once it left the board. */
  current: BoardCard | null;
  can: BoardAbilities;
  timeZone: string;
  offline: boolean;
  writer: BoardWriter;
  onSignedOut: () => void;
  onClose: () => void;
  /** Focus after a change: the next card when it left, or the card in its new column. */
  focusAfter: (card: BoardCard, next: BoardCard | null) => void;
  /** F7 (D23): "Choose another courier" opens the assign dialog once the take-off is done. */
  onChain?: (kind: DialogKind) => void;
}) {
  const finished = useRef(false);
  if (!dialog) return null;
  const { card } = dialog;

  const close = () => {
    onClose();
  };
  // Back to the opener when nothing changed; after a change, `focusAfter` has placed focus.
  const onCloseFocus = () => {
    if (finished.current) {
      finished.current = false;
      return true;
    }
    if (dialog.opener?.isConnected) {
      dialog.opener.focus();
      return true;
    }
    focusAfter(card, current);
    return true;
  };

  const leave = (result: StaffCancelResult) => {
    finished.current = true;
    writer.remove([card.id]);
    if (result.soldOut.length) {
      writer.updateMeta((meta) => ({
        ...meta,
        soldOut: [
          ...meta.soldOut,
          ...result.soldOut
            .filter((dish) => !meta.soldOut.some((item) => item.dishId === dish.dishId))
            .map((dish) => ({
              dishId: dish.dishId,
              title: dish.title,
              since: result.at,
              byName: null,
            })),
        ],
      }));
      for (const dish of result.soldOut) writer.markDish(dish.dishId, true);
    }
    onClose();
    focusAfter(card, null);
  };

  const common = {
    card,
    timeZone,
    offline,
    onClose: close,
    onCloseFocus,
    onSignedOut,
  };

  // F7: a courier change shows on the card as soon as the server has it.
  const courierDone = () => {
    void writer.refreshCouriers([card.id]).catch(() => undefined);
  };
  const courierFocus = () => {
    if (dialog.opener?.isConnected) {
      dialog.opener.focus();
      return true;
    }
    focusAfter(card, current);
    return true;
  };

  switch (dialog.kind) {
    case 'assignCourier':
      return (
        <AssignCourierDialog
          key={`${dialog.cardId}-assign`}
          {...common}
          readOnly={can.readOnly}
          onCloseFocus={courierFocus}
          onFinished={() => {
            courierDone();
            onClose();
          }}
        />
      );
    case 'takeOffCourier':
    case 'chooseAnother': {
      const courier = (current ?? card).courier;
      return (
        <TakeOffCourierDialog
          key={`${dialog.cardId}-take-off`}
          {...common}
          readOnly={can.readOnly}
          shortName={courier?.shortName ?? 'the courier'}
          expectedVersion={courier?.deliveryVersion ?? 0}
          chooseAnother={dialog.kind === 'chooseAnother'}
          onCloseFocus={courierFocus}
          onFinished={() => {
            courierDone();
            if (dialog.kind === 'chooseAnother' && onChain) onChain('assignCourier');
            else onClose();
          }}
        />
      );
    }
    case 'refuse':
    case 'cancel':
      return (
        <CancelDialog
          key={dialog.cardId}
          mode={dialog.kind}
          current={current}
          canMarkSoldOut={can.setAvailability}
          {...common}
          onFinished={({ result }) => leave(result)}
        />
      );
    case 'moveBack':
      return (
        <MoveBackDialog
          key={dialog.cardId}
          {...common}
          onFinished={({ result }) => {
            finished.current = true;
            if (isBoardStatus(result.status)) {
              const next = withStatus(card, result.status, result.version, result.at);
              writer.put(next);
              onClose();
              focusAfter(card, next);
            } else {
              writer.remove([card.id]);
              onClose();
              focusAfter(card, null);
            }
          }}
        />
      );
    case 'pickUp':
    case 'deliver':
    default:
      return (
        <HandoverDialog
          key={dialog.cardId}
          step={dialog.kind === 'pickUp' ? 'pickUp' : 'deliver'}
          {...common}
          onFinished={({ result }) => {
            finished.current = true;
            const view = writer.meta()?.view ?? 'full';
            // Picked up moves to Out for delivery (support and admin boards); delivered leaves.
            if (result.status === 'PICKED_UP' && view === 'full') {
              const next = withStatus(card, 'PICKED_UP', result.version, result.at);
              writer.put(next);
              onClose();
              focusAfter(card, next);
              return;
            }
            writer.remove([card.id]);
            onClose();
            focusAfter(card, null);
          }}
        />
      );
  }
}
