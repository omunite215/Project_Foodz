'use client';

import { Ban, Clock, Lock, type LucideIcon, SkipForward } from 'lucide-react';
import { useId } from 'react';
import type { StaffOrderFeedback, StaffRatingRow } from '@/server/modules/ratings/schema';
import {
  type ModerationChange,
  StaffRatingItem,
} from '@/components/partner-review/rating-moderation';
import {
  courierFeedbackName,
  dishLine,
  feedbackStateLine,
  notRatedLine,
} from '@/lib/admin/earnings-text';

/*
 * "Customer feedback" on an order (F9 design 3.16): what the customer rated, each dish once and
 * then the courier, with the comment, tags and the exclude or include action. SUPPORT and ADMIN
 * only; the kitchen's tablet never receives any of it. The timeline gains nothing.
 */

const STATE_ICONS: Partial<Record<StaffOrderFeedback['state'], LucideIcon>> = {
  open: Clock,
  skipped: SkipForward,
  closed: Lock,
  cancelled: Ban,
};

export function CustomerFeedbackSection({
  feedback,
  level,
  timeZone,
  now,
  offline,
  onChanged,
  onSignedOut,
}: {
  feedback: StaffOrderFeedback;
  level: 'h2' | 'h3';
  timeZone: string;
  now: Date;
  offline: boolean;
  /** After an exclusion or inclusion (or a race): the detail refreshes. */
  onChanged: (row: StaffRatingRow, change: ModerationChange | null) => void;
  onSignedOut: () => void;
}) {
  const id = useId();
  if (feedback.state === 'none') return null;
  const Heading = level;
  const line = feedbackStateLine(feedback, timeZone);
  const Icon = STATE_ICONS[feedback.state];
  // Partly rated while the window is open: the rest reads "not rated" (design 3.16).
  const windowOpen = feedback.closesAt !== null && Date.parse(feedback.closesAt) > now.getTime();

  return (
    <section aria-labelledby={id}>
      <Heading id={id} className="text-body-3 font-semibold text-neutral-1">
        Customer feedback
      </Heading>
      <div className="mt-3">
        {line ? (
          <p className="flex gap-2 text-body-4 text-neutral-2">
            {Icon ? <Icon className="mt-1 size-4 shrink-0 text-neutral-3" aria-hidden /> : null}
            {line}
          </p>
        ) : (
          <ul className="space-y-4">
            {feedback.dishes.map((dish) =>
              dish.rating ? (
                <li key={dish.menuItemId}>
                  <StaffRatingItem
                    row={dish.rating}
                    timeZone={timeZone}
                    offline={offline}
                    title={dishLine(dish.title, dish.quantity)}
                    withOrder={false}
                    onChanged={onChanged}
                    onSignedOut={onSignedOut}
                  />
                </li>
              ) : windowOpen ? (
                <li key={dish.menuItemId} className="text-body-5 text-neutral-3">
                  {notRatedLine(dish.title)}
                </li>
              ) : null,
            )}
            {feedback.courier ? (
              feedback.courier.rating ? (
                <li>
                  <StaffRatingItem
                    row={feedback.courier.rating}
                    timeZone={timeZone}
                    offline={offline}
                    title={courierFeedbackName(feedback.courier.name)}
                    withOrder={false}
                    onChanged={onChanged}
                    onSignedOut={onSignedOut}
                  />
                </li>
              ) : windowOpen ? (
                <li className="text-body-5 text-neutral-3">
                  {notRatedLine(courierFeedbackName(feedback.courier.name))}
                </li>
              ) : null
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}
