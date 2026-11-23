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
import { HandoverDialog, MoveBackDialog } from './status-dialogs';

/*
 * The board's dialogs (F5 design 3) and what their success does to the board: the card leaves
 * (refused, cancelled, delivered) or moves (moved back, picked up), dishes ticked as sold out
 * join the strip, and focus lands on the next card or back on the moved one.
 */

export type DialogKind = 'refuse' | 'cancel' | 'moveBack' | 'pickUp' | 'deliver';

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

  switch (dialog.kind) {
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
