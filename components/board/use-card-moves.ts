'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { moveOrderAction, undoMoveAction } from '@/server/modules/board/actions';
import {
  type BoardCard,
  type BoardStatus,
  type ForwardMove,
  isBoardStatus,
} from '@/server/modules/board/schema';
import { PREVIOUS_STEP } from '@/server/modules/board/state';
import { DEMO_CANNOT_CHANGE, undoRefusedMessage } from '@/server/modules/board/text';
import { showBoardNotice } from '@/components/admin/board-notices';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { isOrderChangedDetails, undoMovedByName, withStatus } from '@/lib/board/model';
import {
  conflictText,
  movedAnnouncement,
  movedBackAnnouncement,
  unreachableText,
} from '@/lib/board/text';
import type { BoardWriter } from '@/lib/data/board';
import type { CardReason } from './card-parts';
import type { MoveProgress } from './card-actions';

/*
 * One-tap moves and Undo (F5 design 2.8, A4 to A8): the card moves at once (optimistic),
 * "Moving…" after 300 ms, then the Undo row for 10 seconds from the server's `undoUntil`. A
 * refusal puts the card back and says why on the card and in a notice; a conflict is calm.
 */

/** The reason block stays until the card changes again or 60 seconds pass. */
const REASON_MS = 60_000;

class Refused extends Error {
  constructor(readonly failure: ActionFailure) {
    super(failure.message);
  }
}

interface HeldReason {
  reason: CardReason;
  version: number;
}

export function useCardMoves({
  writer,
  serverNow,
  timeZone,
  capture,
  onSignedOut,
  onLeft,
}: {
  writer: BoardWriter;
  /** The server's time now, ISO, for the optimistic step time. */
  serverNow: () => string;
  timeZone: string;
  /** Flip positions before the board changes. */
  capture: () => void;
  onSignedOut: () => void;
  /** A refused move found the order gone from the board (cancelled meanwhile). */
  onLeft: (card: BoardCard, text: string) => void;
}) {
  const [progress, setProgress] = useState<Record<string, MoveProgress>>({});
  const [reasons, setReasons] = useState<Record<string, HeldReason>>({});
  const busy = useRef(new Set<string>());

  const setReason = useCallback((card: BoardCard, reason: CardReason, version: number) => {
    setReasons((current) => ({ ...current, [card.id]: { reason, version } }));
  }, []);

  // Reasons go after 60 seconds.
  useEffect(() => {
    const ids = Object.keys(reasons);
    if (ids.length === 0) return undefined;
    const timer = setTimeout(() => setReasons({}), REASON_MS);
    return () => clearTimeout(timer);
  }, [reasons]);

  /** Explains a refusal on the card and in a notice (design 2.8). */
  const explain = useCallback(
    (card: BoardCard, attempted: BoardStatus | null, failure: ActionFailure) => {
      if (failure.code === 'UNAUTHENTICATED') {
        onSignedOut();
        return;
      }
      if (failure.code === 'ORDER_CHANGED' && isOrderChangedDetails(failure.details)) {
        const details = failure.details;
        const text = conflictText(details, attempted, timeZone);
        const { status, version } = details.current;
        if (!isBoardStatus(status) || !writer.card(card.id)) {
          writer.remove([card.id]);
          onLeft(card, text);
          return;
        }
        // The card shows its true state where it really is (A5.1, A5.2).
        capture();
        writer.apply({
          orderId: card.id,
          status,
          version,
          at: details.lastChange?.at ?? serverNow(),
        });
        setReason(card, { tone: 'calm', text }, version);
        showBoardNotice(text);
        return;
      }
      if (failure.code === 'UNDO_NOT_ALLOWED') {
        const text = undoRefusedMessage(undoMovedByName(failure.details));
        setReason(card, { tone: 'calm', text }, writer.card(card.id)?.version ?? card.version);
        showBoardNotice(text);
        return;
      }
      if (failure.code === 'DEMO_READ_ONLY') {
        setReason(card, { tone: 'calm', text: DEMO_CANNOT_CHANGE }, card.version);
        showBoardNotice(DEMO_CANNOT_CHANGE);
        return;
      }
      const unreachable = failure.code === 'OFFLINE' || failure.code === 'TIMEOUT';
      const text = unreachable ? unreachableText(card.number) : failure.message;
      setReason(card, { tone: 'error', text }, writer.card(card.id)?.version ?? card.version);
      showBoardNotice(text, { variant: 'error' });
    },
    [capture, onLeft, onSignedOut, serverNow, setReason, timeZone, writer],
  );

  const run = useCallback(
    async (card: BoardCard, kind: 'moving' | 'undoing', work: () => Promise<void>) => {
      if (busy.current.has(card.id)) return;
      busy.current.add(card.id);
      setProgress((current) => ({ ...current, [card.id]: kind }));
      setReasons((current) => {
        if (!(card.id in current)) return current;
        const { [card.id]: _gone, ...rest } = current;
        return rest;
      });
      try {
        await work();
      } finally {
        busy.current.delete(card.id);
        setProgress((current) => {
          const { [card.id]: _done, ...rest } = current;
          return rest;
        });
      }
    },
    [],
  );

  /** Accept, Start cooking, Mark ready (A4.2). */
  const move = useCallback(
    (card: BoardCard, to: ForwardMove) =>
      run(card, 'moving', async () => {
        capture();
        announce(movedAnnouncement(card.number, to));
        try {
          await writer.optimistic(
            card.id,
            (draft) => {
              Object.assign(draft, withStatus(draft, to, draft.version, serverNow()));
            },
            async () => {
              const outcome = await callAction(() =>
                moveOrderAction({ orderId: card.id, to, expectedVersion: card.version }),
              );
              if (!outcome.ok) throw new Refused(outcome.error);
              const result = outcome.data;
              return {
                ...withStatus(card, result.status, result.version, result.at),
                undo: { eventId: result.eventId, type: result.status, until: result.undoUntil },
              };
            },
          );
        } catch (error) {
          capture();
          explain(card, to, error instanceof Refused ? error.failure : unknownFailure());
        }
      }),
    [capture, explain, run, serverNow, writer],
  );

  /** Undo the person's own move within 10 seconds (A8.1). */
  const undo = useCallback(
    (card: BoardCard) =>
      run(card, 'undoing', async () => {
        const back = PREVIOUS_STEP[card.status];
        if (!card.undo || !back || !isBoardStatus(back)) return;
        const eventId = card.undo.eventId;
        capture();
        announce(movedBackAnnouncement(card.number, back));
        try {
          await writer.optimistic(
            card.id,
            (draft) => {
              Object.assign(draft, withStatus(draft, back, draft.version, serverNow()));
            },
            async () => {
              const outcome = await callAction(() => undoMoveAction({ orderId: card.id, eventId }));
              if (!outcome.ok) throw new Refused(outcome.error);
              const result = outcome.data;
              if (!isBoardStatus(result.status)) return null;
              return withStatus(card, result.status, result.version, result.at);
            },
          );
        } catch (error) {
          capture();
          explain(card, null, error instanceof Refused ? error.failure : unknownFailure());
        }
      }),
    [capture, explain, run, serverNow, writer],
  );

  /** A reason only while the card still shows the version it was about. */
  const reasonFor = useCallback(
    (card: BoardCard): CardReason | null => {
      const held = reasons[card.id];
      return held && held.version === card.version ? held.reason : null;
    },
    [reasons],
  );

  return { move, undo, progress, reasonFor, explain };
}

function unknownFailure(): ActionFailure {
  return { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
}
