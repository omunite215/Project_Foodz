'use client';

import {
  BadgeCheck,
  Ban,
  CircleX,
  type LucideIcon,
  MessageSquareText,
  PencilLine,
  PowerOff,
  Send,
  Trash2,
  Undo2,
  UserRoundCheck,
} from 'lucide-react';
import { useState } from 'react';
import type { HistoryEntry, HistoryType } from '@/server/modules/partners/review-schema';
import { TimelineRow } from '@/components/board/detail/staff-timeline';
import { historyText, historyTime } from '@/lib/partner-review/text';

/*
 * The application's history (F6 design 8.8, A31.1): F5's timeline rows, oldest first, minutes
 * only (no "Show seconds", D36). A reapplication keeps the old entries above the new ones. The
 * demo admin sees each entry's kind and time, with names, texts and notes withheld (A29.3).
 */

const DISCS: Record<HistoryType, { icon: LucideIcon; className: string }> = {
  applied: { icon: Send, className: 'bg-neutral-4' },
  updated: { icon: PencilLine, className: 'bg-neutral-3' },
  'sent-back': { icon: MessageSquareText, className: 'bg-warning-strong' },
  fixed: { icon: PencilLine, className: 'bg-neutral-3' },
  approved: { icon: BadgeCheck, className: 'bg-brand-strong' },
  rejected: { icon: CircleX, className: 'bg-destructive' },
  reopened: { icon: Undo2, className: 'bg-neutral-3' },
  suspended: { icon: Ban, className: 'bg-destructive' },
  'taken-offline': { icon: PowerOff, className: 'bg-neutral-4' },
  reinstated: { icon: UserRoundCheck, className: 'bg-brand-strong' },
  'files-deleted': { icon: Trash2, className: 'bg-neutral-4' },
};

export function ApplicationHistory({
  entries,
  timeZone,
  headingId,
}: {
  entries: readonly HistoryEntry[];
  timeZone: string;
  headingId: string;
}) {
  // Entries present when the page opens don't fade in; later ones do.
  const [firstIds] = useState(() => new Set(entries.map((entry) => entry.id)));
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-neutral-6 bg-white p-5"
    >
      <h2 id={headingId} className="text-body-3 font-semibold text-neutral-1">
        History
      </h2>
      <ol aria-label="Application history" className="mt-4">
        {entries.map((entry, index) => {
          const disc = DISCS[entry.type];
          const words = historyText(entry);
          return (
            <TimelineRow
              key={entry.id}
              last={index === entries.length - 1}
              fresh={!firstIds.has(entry.id)}
              row={{
                id: entry.id,
                icon: disc.icon,
                discClassName: disc.className,
                sentence: words.sentence,
                details: words.details,
                blocks: words.blocks,
                at: entry.at,
                time: historyTime(entry.at, timeZone),
              }}
            />
          );
        })}
      </ol>
    </section>
  );
}
